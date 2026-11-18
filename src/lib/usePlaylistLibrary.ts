/**
 * React hooks over the playlist library: live status, items, coverage per
 * show, the "last show" suggestion, and a snapshot view for screens written
 * for snapshots.
 */
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Show, ThemeLookup } from '../types';
import { displayTitle } from './anilist';
import { db, PLAYLIST_META, snapshotFromLibrary, type PlaylistSnapshot } from './db';
import {
  computeStatus, coverage, needsLink, suggestLastShow,
  type Coverage, type LastShowSuggestion, type LinkHit, type PlaylistItem, type PlaylistMeta, type PlaylistStatus,
} from './playlistLibrary';
import { linkingState, playlistLibrary, type PlaylistLibrary } from './playlistStore';
import { themeLabel } from './themeLabel';

function useLive<T>(query: () => Promise<T>, initial: T, deps: unknown[] = []): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setV, error: () => undefined });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

const EMPTY: PlaylistItem[] = [];

export function usePlaylistItems(): PlaylistItem[] {
  return useLive(async () => (await db.playlistItems.toArray()).sort((a, b) => a.position - b.position), EMPTY);
}

export function usePlaylistMeta(): PlaylistMeta | null {
  return useLive(async () => ((await db.meta.get(PLAYLIST_META))?.value as PlaylistMeta | undefined) ?? null, null);
}

export function useLinking() {
  const progress = useSyncExternalStore(linkingState.subscribe, linkingState.get);
  return { progress, error: linkingState.error() };
}

/** Pending links are filled in the background whenever the library has some (once per change). */
let autoKey = '';

/**
 * The library: live status and items, plus the API. Starts linking in the
 * background when songs aren't linked yet (and the AniList list is loaded).
 */
export function usePlaylistLibrary(): { status: PlaylistStatus | null; items: PlaylistItem[]; meta: PlaylistMeta | null; lib: PlaylistLibrary } {
  const items = usePlaylistItems();
  const meta = usePlaylistMeta();
  const { progress } = useLinking();
  const status = useMemo(() => computeStatus(meta, items, progress), [meta, items, progress]);
  const pending = items.filter((i) => needsLink(i, 'new')).length;
  useEffect(() => {
    const key = `${items.length}:${pending}`;
    if (!pending || progress || key === autoKey) return;
    autoKey = key;
    void playlistLibrary.link({ scope: 'new' });
  }, [items.length, pending, progress]);
  return { status, items, meta, lib: playlistLibrary };
}

/** The library as a snapshot (live): imported songs with their trusted theme keys. */
export function usePlaylistSnapshot(): PlaylistSnapshot | null {
  const items = usePlaylistItems();
  const meta = usePlaylistMeta();
  return useMemo(() => (meta ? snapshotFromLibrary(meta, items) : null), [meta, items]);
}

/** The cached AniList list (no fetching). */
export function useCachedShows(): Show[] {
  return useLive(() => db.shows.toArray(), [] as Show[]);
}

/** Cached theme lookups (no fetching). */
export function useThemeLookups(): Map<number, ThemeLookup> {
  const list = useLive(() => db.themeLookups.toArray(), [] as ThemeLookup[]);
  return useMemo(() => new Map(list.map((l) => [l.anilistId, l])), [list]);
}

/** Per show: songs in the playlist vs its known OP/EDs ("2/3 in playlist"). Keyed by AniList id. */
export function useCoverage(): Map<number, Coverage> {
  const items = usePlaylistItems();
  const lookups = useThemeLookups();
  return useMemo(() => {
    const counts = new Map<number, number>();
    for (const [id, l] of lookups) counts.set(id, l.themes.filter((t) => t.kind !== 'IN').length);
    return coverage(items, counts);
  }, [items, lookups]);
}

/** "Your playlist ends with…": the most recently watched show with a song in the playlist. */
export function useLastShowSuggestion(shows: Show[]): LastShowSuggestion | null {
  const items = usePlaylistItems();
  const meta = usePlaylistMeta();
  return useMemo(() => suggestLastShow(items, shows, !!meta?.lastImport?.orderIsPlaylist), [items, shows, meta]);
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** "OP2" → "Opening 2". */
export function slugLabel(slug: string | null): string {
  if (!slug) return '';
  const m = slug.match(/^(OP|ED|IN)(\d*)/i);
  if (!m) return slug;
  const kind = m[1]!.toUpperCase() as 'OP' | 'ED' | 'IN';
  return themeLabel({ kind, sequence: Number(m[2]) || 0, slug });
}

/** "Oshi no Ko · Ending 1", or the bare key when the show isn't known. */
export function hitLabel(hit: LinkHit, shows: Map<number, Show>): string {
  const show = hit.anilistId !== null ? shows.get(hit.anilistId) : undefined;
  if (!show) return hit.slug ? slugLabel(hit.slug) : 'a song not on your list';
  return `${displayTitle(show)} · ${slugLabel(hit.slug)}`;
}
