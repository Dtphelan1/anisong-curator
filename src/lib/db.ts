import Dexie, { type EntityTable } from 'dexie';
import type { Show, ThemeLookup } from '../types';
import type { ThemeCache } from './themes';
import type { MatchResult } from './matching';
import type { ParseResult, PlaylistRow, SortDetection } from './playlistImport';
import type { AddedRecord } from './dedupe';

export type DecisionValue = 'keep' | 'skip' | 'later';
export interface Decision {
  key: string;
  decision: DecisionValue;
  /** Chosen Apple Music track when kept. */
  trackId: number | null;
  decidedAt: number;
}

/** An imported copy of the playlist: Music.app export, pasted rows, or the Anisong Export Playlist shortcut's text. */
export interface PlaylistSnapshot {
  name: string;
  rows: PlaylistRow[];
  importedAt: number;
  /** export: Mac export file · pasted: ⌘C rows · shortcut: Anisong Export Playlist (iPhone). */
  format: 'export' | 'pasted' | 'shortcut';
  warnings: string[];
  /**
   * Rows are in playlist order, so the tail means "most recently added".
   * False for shortcut text (order unverified) and for exports sorted by a
   * column. Snapshots saved before this field existed read as true.
   */
  ordered: boolean;
  /** False when the artists can't be trusted (the shortcut's lists didn't line up). Absent = true. */
  artistsKnown?: boolean;
  /** Why it's unordered, when an export was sorted by a column. */
  sortedBy?: SortDetection | null;
}

/** Build a snapshot from a parse. The shortcut text names its playlist; otherwise `fallbackName`. */
export function snapshotFromParse(parsed: ParseResult, fallbackName: string, now = Date.now()): PlaylistSnapshot {
  return {
    name: parsed.playlistName?.trim() || fallbackName.trim() || 'Playlist',
    rows: parsed.rows,
    importedAt: now,
    format: parsed.format === 'shortcut' ? 'shortcut' : parsed.format === 'pasted' ? 'pasted' : 'export',
    warnings: parsed.warnings,
    ordered: parsed.ordered,
    artistsKnown: parsed.artistsKnown,
    sortedBy: parsed.sortedBy ?? null,
  };
}

export const SNAPSHOT_SOURCE: Record<PlaylistSnapshot['format'], string> = {
  export: 'Mac export',
  shortcut: 'iPhone shortcut',
  pasted: 'pasted rows',
};

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
  /** Add log (docs/SPEC.md, "Duplicate prevention"): songs the user confirmed adding via the shortcut. */
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
  const s = await database.playlistSnapshots.orderBy('importedAt').last();
  // Pre-`ordered` snapshots were all Music.app exports or pasted rows.
  return s ? { ...s, ordered: s.ordered ?? true } : null;
}

export async function saveSnapshot(s: PlaylistSnapshot, database: CuratorDB = db): Promise<void> {
  await database.playlistSnapshots.put(s);
}

export async function deleteSnapshot(name: string, database: CuratorDB = db): Promise<void> {
  await database.playlistSnapshots.delete(name);
}
