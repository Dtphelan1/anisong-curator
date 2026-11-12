/**
 * The playlist library's storage and linking runner (Dexie). The rules live
 * in playlistLibrary.ts; this file reads and writes them.
 */
import type { Show, ThemeLookup } from '../types';
import { db as defaultDb, loadShows, PLAYLIST_META, themeCache, type CuratorDB, type PlaylistUndo } from './db';
import { parsePlaylist, type ParseResult } from './playlistImport';
import {
  appendAdds, computeStatus, linkItem, needsLink, planImport, removeAdds, setManualLink,
  type AppAdd, type ImportEvent, type ImportPreview, type LinkHit, type LinkProgress, type LinkScope,
  type PlaylistItem, type PlaylistMeta, type PlaylistStatus,
} from './playlistLibrary';
import { buildThemeIndex, exactKeys, type ThemeIndex } from './tailInference';
import { fetchFromJikan, resolveThemes } from './themes';

/* ------------------------------------------------------------------ */
/* Linking progress: one run at a time, observable                     */
/* ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();
let progress: LinkProgress | null = null;
let lastError: string | null = null;
const emit = () => listeners.forEach((l) => l());

export const linkingState = {
  get: () => progress,
  error: () => lastError,
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
};
function setProgress(p: LinkProgress | null) { progress = p; emit(); }

/* ------------------------------------------------------------------ */
/* Theme index over the whole AniList list                             */
/* ------------------------------------------------------------------ */

let indexCache: { sig: string; index: ThemeIndex; lookups: Map<number, ThemeLookup> } | null = null;

export interface ThemeIndexOptions {
  jikan?: boolean;
  onProgress?: (p: LinkProgress) => void;
  database?: CuratorDB;
}

/**
 * Themes for every show on the list (not PLANNING): one batched AnimeThemes
 * call per 50 shows, cached. Only found lookups are cached here, so the
 * songs step still runs its own fallback for shows it looks up later.
 * Jikan is off unless asked (it costs a request per show).
 */
export async function themeIndexFor(shows: Show[], { jikan = false, onProgress, database = defaultDb }: ThemeIndexOptions = {}): Promise<{ index: ThemeIndex; lookups: Map<number, ThemeLookup> }> {
  const list = shows.filter((s) => s.status !== 'PLANNING');
  const cache = themeCache(database);
  const { lookups } = await resolveThemes(list, {
    cache: { get: cache.get, put: (l) => (l.status === 'found' ? cache.put(l) : Promise.resolve()) },
    jikan: jikan ? fetchFromJikan : async () => [],
    onProgress: (p) => onProgress?.({ phase: 'themes', done: p.done, total: p.total }),
  });
  const sig = `${list.length}:${[...lookups.values()].reduce((n, l) => n + l.fetchedAt + l.themes.length, 0)}`;
  if (indexCache?.sig === sig) return indexCache;
  const index = buildThemeIndex(list, (s) => lookups.get(s.anilistId)?.themes ?? []);
  indexCache = { sig, index, lookups };
  return indexCache;
}

/* ------------------------------------------------------------------ */
/* The store                                                           */
/* ------------------------------------------------------------------ */

export interface LinkOptions {
  scope?: LinkScope;
  /** Also ask MyAnimeList (Jikan) for shows AnimeThemes lacks. */
  jikan?: boolean;
}

export interface PlaylistLibrary {
  meta(): Promise<PlaylistMeta | null>;
  items(): Promise<PlaylistItem[]>;
  status(): Promise<PlaylistStatus | null>;
  /** Parse and diff against the stored library. Writes nothing. */
  preview(input: string | ArrayBuffer | ParseResult): Promise<ImportPreview>;
  /** Apply a preview (keeps the previous library for undo), then link the new songs in the background. */
  commit(p: ImportPreview, fallbackName?: string): Promise<ImportEvent>;
  /** Put back the library as it was before the last import. */
  undoLastImport(): Promise<boolean>;
  canUndo(): Promise<boolean>;
  /** Link songs to themes (tiers: add log, reviewed matches, names). Progress via linkingState. */
  link(opts?: LinkOptions): Promise<void>;
  /** Link in memory (for a preview, before saving). */
  linkPreview(items: PlaylistItem[], onProgress?: (p: LinkProgress) => void): Promise<PlaylistItem[]>;
  setLink(itemId: string, hit: LinkHit | null): Promise<void>;
  /** "Yes, mark as added": append the batch. */
  appendAdds(adds: AppAdd[], batchId: string): Promise<void>;
  removeAdds(batchId: string): Promise<void>;
  clear(): Promise<void>;
}

const sortItems = (items: PlaylistItem[]) => items.sort((a, b) => a.position - b.position);

export function playlistStore(database: CuratorDB = defaultDb): PlaylistLibrary {
  const getMeta = async () => ((await database.meta.get(PLAYLIST_META))?.value as PlaylistMeta | undefined) ?? null;
  const getItems = async () => sortItems(await database.playlistItems.toArray());
  const putMeta = (m: PlaylistMeta) => database.meta.put({ key: PLAYLIST_META, value: m });

  async function replaceItems(items: PlaylistItem[]) {
    await database.playlistItems.clear();
    await database.playlistItems.bulkPut(items);
  }

  let running: Promise<void> | null = null;
  let again: LinkOptions | null = null;

  async function linkOnce({ scope = 'new', jikan = false }: LinkOptions): Promise<void> {
    const shows = (await loadShows(database)).shows;
    if (!shows.length) return;
    const todo = (await getItems()).filter((it) => needsLink(it, scope));
    if (!todo.length) return;
    setProgress({ phase: 'themes', done: 0, total: shows.length });
    const { index } = await themeIndexFor(shows, { jikan, database, onProgress: setProgress });
    const exact = exactKeys(await database.matches.toArray());
    const CHUNK = 40;
    for (let i = 0; i < todo.length; i += CHUNK) {
      setProgress({ phase: 'linking', done: i, total: todo.length });
      const chunk = todo.slice(i, i + CHUNK);
      const linked = chunk.map((it) => linkItem(it, index, exact));
      await database.transaction('rw', database.playlistItems, async () => {
        for (const it of linked) {
          // Skip items changed meanwhile (a manual link, a re-import).
          const cur = await database.playlistItems.get(it.id);
          const before = chunk.find((c) => c.id === it.id)!;
          if (cur && JSON.stringify(cur.link) === JSON.stringify(before.link)) await database.playlistItems.put({ ...cur, link: it.link, anilistIds: it.anilistIds });
        }
      });
      // Let the page breathe between chunks.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const lib: PlaylistLibrary = {
    meta: getMeta,
    items: getItems,
    async status() { return computeStatus(await getMeta(), await getItems(), progress); },

    async preview(input) {
      const parsed = typeof input === 'string' || input instanceof ArrayBuffer ? parsePlaylist(input) : input;
      return planImport(await getItems(), parsed, { prev: (await getMeta())?.lastImport ?? null });
    },

    async commit(p, fallbackName = '') {
      const now = Date.now();
      await database.transaction('rw', database.playlistItems, database.playlistImports, database.meta, async () => {
        const prevMeta = await getMeta();
        const prevItems = await getItems();
        await database.playlistImports.clear();
        await database.playlistImports.put({ id: p.event.id, at: now, items: prevItems, meta: prevMeta } satisfies PlaylistUndo);
        await replaceItems(p.next);
        await putMeta({ name: p.playlistName?.trim() || prevMeta?.name || fallbackName.trim(), syncedAt: now, lastImport: p.event });
      });
      void lib.link({ scope: 'new' });
      return p.event;
    },

    async canUndo() { return (await database.playlistImports.count()) > 0; },

    async undoLastImport() {
      let done = false;
      await database.transaction('rw', database.playlistItems, database.playlistImports, database.meta, async () => {
        const u = await database.playlistImports.orderBy('at').last();
        if (!u) return;
        await replaceItems(u.items);
        if (u.meta) await putMeta(u.meta);
        else await database.meta.delete(PLAYLIST_META);
        await database.playlistImports.clear();
        done = true;
      });
      return done;
    },

    async link(opts = {}) {
      if (running) {
        again = { scope: widen(again?.scope, opts.scope ?? 'new'), jikan: !!(again?.jikan || opts.jikan) };
        return running;
      }
      running = (async () => {
        lastError = null;
        try {
          let next: LinkOptions | null = opts;
          while (next) {
            const cur: LinkOptions = next;
            again = null;
            await linkOnce(cur);
            next = again;
          }
        } catch (e) {
          lastError = (e as Error).message;
        } finally {
          running = null;
          setProgress(null);
        }
      })();
      return running;
    },

    async linkPreview(items, onProgress) {
      const shows = (await loadShows(database)).shows;
      if (!shows.length) return items;
      const { index } = await themeIndexFor(shows, { database, onProgress });
      const exact = exactKeys(await database.matches.toArray());
      const out: PlaylistItem[] = [];
      const todo = items.filter((it) => needsLink(it, 'new')).length;
      let done = 0;
      for (const it of items) {
        if (needsLink(it, 'new')) {
          out.push(linkItem(it, index, exact));
          if (++done % 40 === 0) { onProgress?.({ phase: 'linking', done, total: todo }); await new Promise((r) => setTimeout(r, 0)); }
        } else out.push(it);
      }
      onProgress?.({ phase: 'linking', done: todo, total: todo });
      return out;
    },

    async setLink(itemId, hit) {
      await database.transaction('rw', database.playlistItems, async () => {
        const it = await database.playlistItems.get(itemId);
        if (it) await database.playlistItems.put(setManualLink(it, hit));
      });
    },

    async appendAdds(adds, batchId) {
      await database.transaction('rw', database.playlistItems, database.meta, async () => {
        await replaceItems(appendAdds(await getItems(), adds, batchId));
        if (!(await getMeta())) await putMeta({ name: '', syncedAt: null, lastImport: null });
      });
      void lib.link({ scope: 'new' });
    },

    async removeAdds(batchId) {
      await database.transaction('rw', database.playlistItems, async () => {
        await replaceItems(removeAdds(await getItems(), batchId));
      });
    },

    async clear() {
      await database.transaction('rw', database.playlistItems, database.playlistImports, database.meta, async () => {
        await database.playlistItems.clear();
        await database.playlistImports.clear();
        await database.meta.delete(PLAYLIST_META);
      });
    },
  };
  return lib;
}

const RANK: Record<LinkScope, number> = { new: 0, unlinked: 1, all: 2 };
const widen = (a: LinkScope | undefined, b: LinkScope): LinkScope => (a && RANK[a] > RANK[b] ? a : b);

/** The app's library (default database). */
export const playlistLibrary = playlistStore();
