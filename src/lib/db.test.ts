import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { CuratorDB, deleteSnapshot, loadLatestSnapshot, migrateToLibrary, saveSnapshot, snapshotFromParse, type PlaylistSnapshot } from './db';
import { parsePlaylist } from './playlistImport';
import { playlistStore } from './playlistStore';

const uid = () => Math.random().toString(36).slice(2);
const snap = (rows: PlaylistSnapshot['rows'], p: Partial<PlaylistSnapshot> = {}): PlaylistSnapshot =>
  ({ name: 'Anisongs', rows, importedAt: 1, format: 'export', warnings: [], ordered: true, ...p });
const GURENGE = { position: 1, title: 'Gurenge', artist: 'LiSA', album: 'Gurenge - EP', durationMs: 238_000 };
const IDOL = { position: 2, title: 'Idol', artist: 'YOASOBI', album: 'Idol - Single', durationMs: 213_000 };

describe('schema v5', () => {
  it('has the playlist library tables; older tables are untouched', async () => {
    const db = new CuratorDB(`test-v5-${uid()}`);
    expect(db.verno).toBe(5);
    expect(db.tables.map((t) => t.name).sort()).toEqual(['added', 'decisions', 'matches', 'meta', 'playlistImports', 'playlistItems', 'playlistSnapshots', 'shows', 'themeLookups']);
    db.close();
  });

  it('migrates v4: replays the latest snapshot and the add log into the library', async () => {
    const name = `test-mig-${uid()}`;
    const v4 = new Dexie(name);
    v4.version(1).stores({ shows: 'anilistId, status', themeLookups: 'anilistId, status, fetchedAt', meta: 'key' });
    v4.version(2).stores({ matches: 'key, country, matchedAt', decisions: 'key, decision, decidedAt' });
    v4.version(3).stores({ playlistSnapshots: 'name, importedAt' });
    v4.version(4).stores({ added: '++id, trackId, batchId, addedAt' });
    await v4.table('playlistSnapshots').bulkPut([snap([GURENGE], { name: 'Old', importedAt: 1 }), snap([GURENGE, IDOL], { importedAt: 5 })]);
    // One add the snapshot contains (Idol), one it doesn't (added after it).
    await v4.table('added').bulkAdd([
      { trackId: 7, title: 'Idol', artist: 'YOASOBI', durationMs: 213_000, key: '150672:OP1', batchId: 'b1', addedAt: 3 },
      { trackId: 8, title: 'Mephisto', artist: 'QUEEN BEE', durationMs: 237_000, key: '150672:ED1', batchId: 'b2', addedAt: 9 },
    ]);
    v4.close();

    const db = new CuratorDB(name);
    const items = await playlistStore(db).items();
    expect(items.map((i) => [i.title, i.origin])).toEqual([['Gurenge', 'import'], ['Idol', 'import'], ['Mephisto', 'app']]);
    expect(items[1]).toMatchObject({ trackId: 7, addedBatch: 'b1', anilistIds: [150672] });
    const s = await loadLatestSnapshot(db);
    expect(s).toMatchObject({ name: 'Anisongs', importedAt: 5, format: 'export', ordered: true });
    expect(s!.rows.map((r) => r.title)).toEqual(['Gurenge', 'Idol']);
    expect(s!.rows[1]!.themeKeys).toEqual(['150672:OP1']);
    db.close();
  });

  it('migrateToLibrary with no snapshot keeps the adds, appended', () => {
    const { items, meta } = migrateToLibrary(null, [{ trackId: 1, title: 'a', artist: 'b', durationMs: null, key: '1:OP1', batchId: 'b', addedAt: 1 }]);
    expect(items).toHaveLength(1);
    expect(meta).toMatchObject({ syncedAt: null, lastImport: null });
  });
});

describe('snapshots as a view of the library', () => {
  it('saving imports into the one playlist; loading reads it back; deleting forgets it', async () => {
    const db = new CuratorDB(`test-snap-${uid()}`);
    expect(await loadLatestSnapshot(db)).toBeNull();
    await saveSnapshot(snap([GURENGE]), db);
    expect(await loadLatestSnapshot(db)).toMatchObject({ name: 'Anisongs', rows: [{ title: 'Gurenge', position: 1 }] });
    await saveSnapshot(snap([GURENGE, IDOL], { name: 'Other name' }), db);
    expect((await loadLatestSnapshot(db))!.rows.map((r) => r.title)).toEqual(['Gurenge', 'Idol']);
    await deleteSnapshot('Anisongs', db);
    expect(await loadLatestSnapshot(db)).toBeNull();
    db.close();
  });

  it('names a shortcut snapshot after its playlist and keeps it unordered', async () => {
    const db = new CuratorDB(`test-sync-${uid()}`);
    const text = (titles: string) => `anisong-playlist v1\n🔥 AniSong MegaMix\n---titles---\n${titles}\n---artists---\n${titles.split('\n').map(() => 'LiSA').join('\n')}\n`;
    const a = snapshotFromParse(parsePlaylist(text('Gurenge')), 'ignored', 1);
    expect(a).toMatchObject({ name: '🔥 AniSong MegaMix', format: 'shortcut', ordered: false, artistsKnown: true });
    await saveSnapshot(a, db);
    await saveSnapshot(snapshotFromParse(parsePlaylist(text('Gurenge\nHomura')), 'ignored', 2), db);
    expect(await loadLatestSnapshot(db)).toMatchObject({ name: '🔥 AniSong MegaMix', ordered: false });
    expect((await loadLatestSnapshot(db))?.rows.map((r) => r.title)).toEqual(['Gurenge', 'Homura']);
    expect(snapshotFromParse(parsePlaylist('Gurenge\t3:58\tLiSA'), 'My list')).toMatchObject({ name: 'My list', format: 'pasted', ordered: true });
    db.close();
  });
});

describe('playlist store', () => {
  it('commit keeps the previous library for one undo', async () => {
    const db = new CuratorDB(`test-undo-${uid()}`);
    const lib = playlistStore(db);
    await lib.commit(await lib.preview('Gurenge\t3:58\tLiSA'), 'Mix');
    await lib.commit(await lib.preview('Gurenge\t3:58\tLiSA\nIdol\t3:33\tYOASOBI'), 'Mix');
    expect((await lib.items()).map((i) => i.title)).toEqual(['Gurenge', 'Idol']);
    expect(await lib.undoLastImport()).toBe(true);
    expect((await lib.items()).map((i) => i.title)).toEqual(['Gurenge']);
    expect(await lib.canUndo()).toBe(false);
    expect(await lib.status()).toMatchObject({ name: 'Mix', rowCount: 1 });
    db.close();
  });

  it('appends and removes the app adds of a batch; manual links stick', async () => {
    const db = new CuratorDB(`test-adds-${uid()}`);
    const lib = playlistStore(db);
    await lib.commit(await lib.preview('Gurenge\t3:58\tLiSA'), 'Mix');
    await lib.appendAdds([{ key: '1:OP1', trackId: 5, title: 'Idol', artist: 'YOASOBI', durationMs: null }], 'b1');
    expect((await lib.items()).map((i) => [i.title, i.origin])).toEqual([['Gurenge', 'import'], ['Idol', 'app']]);
    expect(await lib.status()).toMatchObject({ pendingAdds: 1 });
    const g = (await lib.items())[0]!;
    await lib.setLink(g.id, { themeKey: 'song:1', anilistId: 101922, slug: 'OP1' });
    expect((await lib.items())[0]!.link).toMatchObject({ via: 'manual' });
    await lib.removeAdds('b1');
    expect((await lib.items()).map((i) => i.title)).toEqual(['Gurenge']);
    db.close();
  });
});

describe('add log (schema v4)', () => {
  it('records batches and deletes one batch on undo', async () => {
    const db = new CuratorDB(`test-added-${uid()}`);
    const rec = (trackId: number, batchId: string) => ({ trackId, title: `t${trackId}`, artist: 'a', durationMs: null, key: `k${trackId}`, batchId, addedAt: trackId });
    await db.added.bulkAdd([rec(1, 'b1'), rec(2, 'b1'), rec(3, 'b2')]);
    expect(await db.added.where('trackId').equals(2).count()).toBe(1);
    await db.added.where('batchId').equals('b1').delete();
    expect((await db.added.toArray()).map((r) => r.trackId)).toEqual([3]);
    db.close();
  });
});
