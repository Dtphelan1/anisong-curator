import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CuratorDB, deleteSnapshot, loadLatestSnapshot, saveSnapshot } from './db';

describe('playlist snapshots (schema v3)', () => {
  it('stores snapshots by name and loads the latest; v2 tables are untouched', async () => {
    const db = new CuratorDB('test-v3');
    expect(db.verno).toBe(3);
    expect(db.tables.map((t) => t.name).sort()).toEqual(['decisions', 'matches', 'meta', 'playlistSnapshots', 'shows', 'themeLookups']);
    expect(await loadLatestSnapshot(db)).toBeNull();
    const rows = [{ position: 1, title: 'Gurenge', artist: 'LiSA', album: 'Gurenge - EP', durationMs: 238_000 }];
    await saveSnapshot({ name: 'Anisongs', rows, importedAt: 1, format: 'export', warnings: [] }, db);
    await saveSnapshot({ name: 'Pasted rows', rows: [], importedAt: 2, format: 'pasted', warnings: [] }, db);
    expect((await loadLatestSnapshot(db))?.name).toBe('Pasted rows');
    await saveSnapshot({ name: 'Anisongs', rows, importedAt: 3, format: 'export', warnings: [] }, db);
    expect(await loadLatestSnapshot(db)).toMatchObject({ name: 'Anisongs', rows });
    await deleteSnapshot('Anisongs', db);
    expect((await loadLatestSnapshot(db))?.name).toBe('Pasted rows');
    db.close();
  });
});
