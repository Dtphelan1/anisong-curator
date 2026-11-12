import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CuratorDB, deleteSnapshot, loadLatestSnapshot, saveSnapshot, snapshotFromParse, type PlaylistSnapshot } from './db';
import { parsePlaylist } from './playlistImport';

describe('playlist snapshots (schema v3)', () => {
  it('stores snapshots by name and loads the latest; v2 tables are untouched', async () => {
    const db = new CuratorDB('test-v3');
    expect(db.verno).toBe(4);
    expect(db.tables.map((t) => t.name).sort()).toEqual(['added', 'decisions', 'matches', 'meta', 'playlistSnapshots', 'shows', 'themeLookups']);
    expect(await loadLatestSnapshot(db)).toBeNull();
    const rows = [{ position: 1, title: 'Gurenge', artist: 'LiSA', album: 'Gurenge - EP', durationMs: 238_000 }];
    await saveSnapshot({ name: 'Anisongs', rows, importedAt: 1, format: 'export', warnings: [], ordered: true }, db);
    await saveSnapshot({ name: 'Pasted rows', rows: [], importedAt: 2, format: 'pasted', warnings: [], ordered: true }, db);
    expect((await loadLatestSnapshot(db))?.name).toBe('Pasted rows');
    await saveSnapshot({ name: 'Anisongs', rows, importedAt: 3, format: 'export', warnings: [], ordered: true }, db);
    expect(await loadLatestSnapshot(db)).toMatchObject({ name: 'Anisongs', rows });
    await deleteSnapshot('Anisongs', db);
    expect((await loadLatestSnapshot(db))?.name).toBe('Pasted rows');
    db.close();
  });
});

describe('snapshots from a parse', () => {
  it('names a shortcut snapshot after its playlist, keeps it unordered, and replaces the same name on sync', async () => {
    const db = new CuratorDB(`test-sync-${Math.random()}`);
    const text = (titles: string) => `anisong-playlist v1\n🔥 AniSong MegaMix\n---titles---\n${titles}\n---artists---\n${titles.split('\n').map(() => 'LiSA').join('\n')}\n`;
    const a = snapshotFromParse(parsePlaylist(text('Gurenge')), 'ignored', 1);
    expect(a).toMatchObject({ name: '🔥 AniSong MegaMix', format: 'shortcut', ordered: false, artistsKnown: true });
    await saveSnapshot(a, db);
    await saveSnapshot(snapshotFromParse(parsePlaylist(text('Gurenge\nHomura')), 'ignored', 2), db);
    expect(await db.playlistSnapshots.count()).toBe(1);
    expect((await loadLatestSnapshot(db))?.rows.map((r) => r.title)).toEqual(['Gurenge', 'Homura']);
    expect(snapshotFromParse(parsePlaylist('Gurenge\t3:58\tLiSA'), 'My list')).toMatchObject({ name: 'My list', format: 'pasted', ordered: true });
    db.close();
  });

  it('reads snapshots saved before `ordered` existed as ordered', async () => {
    const db = new CuratorDB(`test-legacy-${Math.random()}`);
    const legacy = { name: 'Old', rows: [], importedAt: 1, format: 'export', warnings: [] } as unknown as PlaylistSnapshot;
    await db.playlistSnapshots.put(legacy);
    expect((await loadLatestSnapshot(db))?.ordered).toBe(true);
    db.close();
  });
});

describe('add log (schema v4)', () => {
  it('records batches and deletes one batch on undo', async () => {
    const db = new CuratorDB(`test-added-${Math.random()}`);
    const rec = (trackId: number, batchId: string) => ({ trackId, title: `t${trackId}`, artist: 'a', durationMs: null, key: `k${trackId}`, batchId, addedAt: trackId });
    await db.added.bulkAdd([rec(1, 'b1'), rec(2, 'b1'), rec(3, 'b2')]);
    expect(await db.added.where('trackId').equals(2).count()).toBe(1);
    await db.added.where('batchId').equals('b1').delete();
    expect((await db.added.toArray()).map((r) => r.trackId)).toEqual([3]);
    db.close();
  });
});
