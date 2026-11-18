import Dexie, { type EntityTable } from 'dexie';
import type { Show, ThemeLookup } from '../types';
import type { ThemeCache } from './themes';
import type { MatchResult } from './matching';
import type { ParseResult, PlaylistRow, SortDetection } from './playlistImport';
import type { AddedRecord } from './dedupe';
import { appendAdds, itemsAsRows, planImport, type PlaylistItem, type PlaylistMeta } from './playlistLibrary';

export type DecisionValue = 'keep' | 'skip' | 'later';
export interface Decision {
  key: string;
  decision: DecisionValue;
  /** Chosen Apple Music track when kept. */
  trackId: number | null;
  decidedAt: number;
  /** Kept even though it looks like it's already in the playlist ("add anyway"). */
  addAnyway?: boolean;
}

/**
 * An imported copy of the playlist: Music.app export, pasted rows, or the
 * Anisong Export Playlist shortcut's text. Since v5 this is a read-only view
 * of the playlist library (`loadLatestSnapshot`); the `playlistSnapshots`
 * table is kept, unused, for one version as a rollback.
 */
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
  /** The playlist library (docs/SPEC.md, "Playlist library"): one row per song in the playlist. */
  playlistItems!: EntityTable<PlaylistItem, 'id'>;
  /** The library before the last import, for Undo sync (one kept). */
  playlistImports!: EntityTable<PlaylistUndo, 'id'>;

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
    // v5: the playlist library. Replays the latest snapshot and the add log.
    this.version(5).stores({
      playlistItems: 'id, position, origin, *anilistIds, addedBatch',
      playlistImports: 'id, at',
    }).upgrade(async (tx) => {
      const snaps = (await tx.table('playlistSnapshots').toArray()) as PlaylistSnapshot[];
      const latest = snaps.sort((a, b) => a.importedAt - b.importedAt).at(-1) ?? null;
      const added = (await tx.table('added').toArray()) as AddedRecord[];
      const { items, meta } = migrateToLibrary(latest, added);
      if (items.length) await tx.table('playlistItems').bulkPut(items);
      if (meta) await tx.table('meta').put({ key: PLAYLIST_META, value: meta });
    });
  }
}

/** The library before an import, for Undo sync. */
export interface PlaylistUndo {
  id: string;
  at: number;
  items: PlaylistItem[];
  meta: PlaylistMeta | null;
}

/** Key of the PlaylistMeta singleton in `meta`. */
export const PLAYLIST_META = 'playlist';

/** A stored snapshot as a parse, so it can go through the normal import path. */
export function snapshotAsParse(s: PlaylistSnapshot): ParseResult {
  return {
    rows: s.rows, warnings: s.warnings, format: s.format, guessed: false, header: null, encoding: 'text',
    mapping: { title: null, artist: null, album: null, time: null }, playlistName: s.name,
    ordered: s.ordered ?? true, artistsKnown: s.artistsKnown !== false, sortedBy: s.sortedBy ?? null,
  };
}

/**
 * v4 → v5: the add log's batches are appended (oldest first), then the
 * latest snapshot is imported on top, which confirms the adds it contains.
 */
export function migrateToLibrary(latest: PlaylistSnapshot | null, added: AddedRecord[]): { items: PlaylistItem[]; meta: PlaylistMeta | null } {
  let items: PlaylistItem[] = [];
  const batches = new Map<string, AddedRecord[]>();
  for (const r of [...added].sort((a, b) => a.addedAt - b.addedAt)) batches.set(r.batchId, [...(batches.get(r.batchId) ?? []), r]);
  for (const [batchId, recs] of batches) items = appendAdds(items, recs, batchId, recs[0]!.addedAt);
  if (!latest) return { items, meta: items.length ? { name: '', syncedAt: null, lastImport: null } : null };
  const p = planImport(items, snapshotAsParse(latest), { now: latest.importedAt, importId: 'migrated' });
  return { items: p.next, meta: { name: latest.name, syncedAt: latest.importedAt, lastImport: p.event } };
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

/**
 * The playlist as a snapshot, built from the library: imported songs in
 * playlist order, carrying their trusted theme keys. App adds not yet seen
 * in an import are left out (the add log covers them). Kept so screens
 * written for snapshots work unchanged.
 */
export async function loadLatestSnapshot(database: CuratorDB = db): Promise<PlaylistSnapshot | null> {
  const meta = (await database.meta.get(PLAYLIST_META))?.value as PlaylistMeta | undefined;
  if (!meta?.lastImport) return null;
  const items = await database.playlistItems.toArray();
  return snapshotFromLibrary(meta, items);
}

export function snapshotFromLibrary(meta: PlaylistMeta, items: PlaylistItem[]): PlaylistSnapshot | null {
  const ev = meta.lastImport;
  if (!ev) return null;
  return {
    name: meta.name || 'Playlist',
    rows: itemsAsRows(items),
    importedAt: meta.syncedAt ?? ev.at,
    format: ev.format,
    warnings: ev.warnings,
    ordered: ev.orderIsPlaylist,
    artistsKnown: ev.artistsKnown,
    sortedBy: ev.sortedBy,
  };
}

/** Import a snapshot into the library (the one playlist): a sync without preview. */
export async function saveSnapshot(s: PlaylistSnapshot, database: CuratorDB = db): Promise<void> {
  const { playlistStore } = await import('./playlistStore');
  const store = playlistStore(database);
  await store.commit(await store.preview(snapshotAsParse(s)), s.name);
}

/** Forget the playlist (the library and its undo; the add log stays). */
export async function deleteSnapshot(_name: string, database: CuratorDB = db): Promise<void> {
  const { playlistStore } = await import('./playlistStore');
  await playlistStore(database).clear();
}
