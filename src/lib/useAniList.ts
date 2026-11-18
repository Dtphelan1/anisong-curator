import { useCallback, useEffect, useRef, useState } from 'react';
import type { Show } from '../types';
import { fetchAnimeList } from './anilist';
import { loadShows, saveShows } from './db';
import { LIST_HINT_KEY } from './settings';

/** A list older than this is refreshed in the background when the app opens. */
export const LIST_STALE_MS = 12 * 3_600_000;

export interface AniListState {
  shows: Show[];
  /** Whose list is cached, and when it was fetched. */
  user: string | null;
  loadedAt: number | null;
  /** The cache has been read (so an empty list means "none yet"). */
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** The last load failed because the list is private. */
  isPrivate: boolean;
  /** Shows that became Completed in the last refresh. */
  newlyFinished: number;
}

/** Ids completed in `next` that weren't completed in `prev`. */
export function newlyCompleted(prev: Show[], next: Show[]): number {
  if (!prev.length) return 0;
  const done = new Set(prev.filter((s) => s.status === 'COMPLETED').map((s) => s.anilistId));
  return next.filter((s) => s.status === 'COMPLETED' && !done.has(s.anilistId)).length;
}

/**
 * The AniList list: read from IndexedDB at once, refreshed in the background
 * when stale, and reloadable on demand (e.g. a new username in setup).
 */
export function useAniList(userName: string, token: string | null) {
  const [state, setState] = useState<AniListState>({
    shows: [], user: null, loadedAt: null, ready: false, loading: false, error: null, isPrivate: false, newlyFinished: 0,
  });
  const current = useRef(state);
  current.current = state;

  const load = useCallback(async (name = userName) => {
    const user = name.trim();
    if (!user) { setState((s) => ({ ...s, error: 'Enter your AniList username.' })); return false; }
    setState((s) => ({ ...s, loading: true, error: null, isPrivate: false }));
    try {
      const list = await fetchAnimeList(user, token);
      await saveShows(list, user);
      try { localStorage.setItem(LIST_HINT_KEY, '1'); } catch { /* private mode */ }
      const prev = current.current;
      const newlyFinished = prev.user === user ? newlyCompleted(prev.shows, list) : 0;
      setState((s) => ({ ...s, shows: list, user, loadedAt: Date.now(), loading: false, newlyFinished }));
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      setState((s) => ({ ...s, loading: false, error: msg, isPrivate: /private/i.test(msg) }));
      return false;
    }
  }, [userName, token]);

  // Cached list first; then refresh it if it's stale.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadShows().then(({ shows, user, at }) => {
      setState((s) => ({ ...s, shows, user, loadedAt: at, ready: true }));
      if (shows.length) { try { localStorage.setItem(LIST_HINT_KEY, '1'); } catch { /* private mode */ } }
      const name = userName.trim();
      if (name && shows.length && (user !== name || !at || Date.now() - at > LIST_STALE_MS)) void load(name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, load };
}
