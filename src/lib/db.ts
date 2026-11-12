import Dexie, { type EntityTable } from 'dexie';
import type { Show, ThemeLookup } from '../types';
import type { ThemeCache } from './themes';
import type { MatchResult } from './matching';
import type { PlaylistRow } from './playlistImport';
import type { AddedRecord } from './dedupe';

export type DecisionValue = 'keep' | 'skip' | 'later';
export interface Decision {
  key: string;
  decision: DecisionValue;
  /** Chosen Apple Music track when kept. */
  trackId: number | null;
  decidedAt: number;
}

/** An imported copy of the playlist (Music.app export or pasted rows), in playlist order. */
export interface PlaylistSnapshot {
  name: string;
  rows: PlaylistRow[];
  importedAt: number;
  format: 'export' | 'pasted';
  warnings: string[];
}

/**
 * IndexedDB via Dexie. Everything here is a rebuildable cache, except
 * (from M5 on) decisions and the run cursor.
 */
export class CuratorDB extends Dexie {
  shows!: EntityTable<Show, 'anilistId'>;
  themeLookups!: EntityTable<ThemeLookup, 'anilistId'>;
  meta!: EntityTable<{ key: string; value: unknown }, 'key'>;
  matches!: EntityTable<MatchResult, 'key'>;
  decisions!: EntityTable<Decision, 'key'>;
  playlistSnapshots!: EntityTable<PlaylistSnapshot, 'name'>;
  /** Add log (SPEC §9.4): songs the user confirmed adding via the shortcut. */
  added!: EntityTable<AddedRecord & { id?: number }, 'id'>;

  constructor(name = 'anisong-curator') {
    super(name);
    this.version(1).stores({
      shows: 'anilistId, status',
      themeLookups: 'anilistId, status, fetchedAt',
      meta: 'key',
    });
    // v2 (M3): Apple catalog matches and keep/skip decisions, keyed by themeKey().
    this.version(2).stores({
      matches: 'key, country, matchedAt',
      decisions: 'key, decision, decidedAt',
    });
    // v3 (M6): imported playlist snapshots, for tail inference and duplicate checks.
    this.version(3).stores({
      playlistSnapshots: 'name, importedAt',
    });
    // v4: add log for duplicate prevention.
    this.version(4).stores({
      added: '++id, trackId, batchId, addedAt',
    });
  }
}

export const db = new CuratorDB();

export function themeCache(database: CuratorDB = db): ThemeCache {
  return {
    get: (id) => database.themeLookups.get(id),
    put: async (l) => { await database.themeLookups.put(l); },
  };
}

/** Replace the cached list wholesale; AniList is the source of truth. */
export async function saveShows(shows: Show[], loadedFor: string, database: CuratorDB = db): Promise<void> {
  await database.transaction('rw', database.shows, database.meta, async () => {
    await database.shows.clear();
    await database.shows.bulkPut(shows);
    await database.meta.put({ key: 'listLoaded', value: { user: loadedFor, at: Date.now() } });
  });
}

export async function loadShows(database: CuratorDB = db): Promise<{ shows: Show[]; user: string | null; at: number | null }> {
  const shows = await database.shows.toArray();
  const meta = (await database.meta.get('listLoaded'))?.value as { user: string; at: number } | undefined;
  return { shows, user: meta?.user ?? null, at: meta?.at ?? null };
}

/** The most recently imported snapshot (the app works with one playlist). */
export async function loadLatestSnapshot(database: CuratorDB = db): Promise<PlaylistSnapshot | null> {
  return (await database.playlistSnapshots.orderBy('importedAt').last()) ?? null;
}

export async function saveSnapshot(s: PlaylistSnapshot, database: CuratorDB = db): Promise<void> {
  await database.playlistSnapshots.put(s);
}

export async function deleteSnapshot(name: string, database: CuratorDB = db): Promise<void> {
  await database.playlistSnapshots.delete(name);
}
