/**
 * The playlist library (docs/SPEC.md, "Playlist library"): the one playlist
 * as a set of songs that persist across imports, each linked to what the app
 * knows about it (show, OP/ED, Apple Music track).
 *
 * This file is pure: identity, the import diff, positions, appending the
 * app's own adds, and linking. The Dexie adapter is playlistStore.ts; React
 * hooks are usePlaylistLibrary.ts.
 *
 * Order: an ordered import (a Mac export in playlist order) sets every
 * position. An unordered one (Anisong Export Playlist, a sorted export) keeps
 * the stored order and appends its new songs at the end. Songs confirmed with
 * "Yes, mark as added" are appended at once and keep that place until an
 * ordered import shows where they really are.
 */
import type { Show } from '../types';
import { coreTitle, normalize } from './matcher';
import { findDuplicate, indexRows, type DupIndex } from './dedupe';
import type { ParseResult, PlaylistRow, SortDetection } from './playlistImport';
import type { RowMapping, ThemeIndex } from './tailInference';
import { mapRow } from './tailInference';
import { themeKey } from './matching';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Bump to relink every cached (non-manual) link. */
export const LINKER_VERSION = 1;
/** A link at or above this confidence counts for duplicate checks and coverage. */
export const LINK_TRUSTED = 0.8;
/** A playlist synced longer ago than this is "out of date" (4 weeks). */
export const STALE_MS = 28 * 24 * 3600 * 1000;

/** One theme a song is linked to. anilistId/slug are null until the linker resolves a bare key (from the add log). */
export interface LinkHit {
  themeKey: string;
  anilistId: number | null;
  slug: string | null;
}

export type LinkVia = 'add-log' | 'exact' | 'fuzzy' | 'manual';

export type ItemLink =
  | { state: 'linked'; via: LinkVia; hits: LinkHit[]; confidence: number; at: number; v: number }
  | { state: 'unlinked'; nearest: (LinkHit & { confidence: number }) | null; at: number; v: number; manual?: boolean };

export type ImportFormat = 'export' | 'pasted' | 'shortcut';

/** One song in the playlist, as the app has come to know it. */
export interface PlaylistItem {
  /** Stable across imports (renames keep it). */
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number | null;
  /** Sort key: playlist order, then appended adds. Dense 0…n-1 after each change. */
  position: number;
  /** 'app' = appended by "Yes, mark as added" and not yet seen in an import. */
  origin: 'import' | 'app';
  firstSeenAt: number;
  /** Apple Music track id, when known (from the add log). */
  trackId: number | null;
  /** Add-log batch that put it there. */
  addedBatch: string | null;
  addedAt: number | null;
  /** null: not linked yet. */
  link: ItemLink | null;
  /** Denormalized from link hits, for "songs of this show". */
  anilistIds: number[];
}

export interface ImportEvent {
  id: string;
  at: number;
  format: ImportFormat;
  /** This import's rows were in playlist order. */
  ordered: boolean;
  /** The stored order is playlist order (an ordered import set it), not import order. */
  orderIsPlaylist: boolean;
  artistsKnown: boolean;
  sortedBy: SortDetection | null;
  warnings: string[];
  rowCount: number;
  diff: DiffCounts;
}

export interface DiffCounts {
  new: number;
  missing: number;
  unchanged: number;
  renamed: number;
  addsConfirmed: number;
  addsUnseen: number;
}

/** The one playlist (a singleton in `meta`, key 'playlist'). */
export interface PlaylistMeta {
  name: string;
  syncedAt: number | null;
  lastImport: ImportEvent | null;
}

export interface Renamed {
  item: PlaylistItem;
  from: { title: string; artist: string };
}

export interface ImportPreview {
  event: ImportEvent;
  /** The playlist name the input names (shortcut text), if any. */
  playlistName: string | null;
  /** The full library after this import, in position order. */
  next: PlaylistItem[];
  added: PlaylistItem[];
  missing: PlaylistItem[];
  renamed: Renamed[];
  /** App adds now seen in the playlist. */
  confirmed: PlaylistItem[];
  /** App adds still not seen ("added, not seen"); they stay appended. */
  unseen: PlaylistItem[];
  /** True when this import replaced the stored order. */
  orderReplaced: boolean;
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/** Same recording: within ±3 s, or a duration unknown on either side. */
const SAME_LENGTH_MS = 3000;

/** normalize(core title) | normalize(artist): what a row is, before durations. */
export function nameKey(title: string, artist: string, withArtist = true): string {
  return `${normalize(coreTitle(title)) || normalize(title)}|${withArtist ? normalize(artist) : ''}`;
}

const sameLength = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) <= SAME_LENGTH_MS;

/* ------------------------------------------------------------------ */
/* Import diff                                                         */
/* ------------------------------------------------------------------ */

export interface PlanOptions {
  now?: number;
  /** Id for the import event (tests pass a fixed one). */
  importId?: string;
  /** The previous import, to know whether the kept order is playlist order. */
  prev?: ImportEvent | null;
}

function newItem(row: PlaylistRow, id: string, now: number): PlaylistItem {
  return {
    id, title: row.title, artist: row.artist, album: row.album, durationMs: row.durationMs,
    position: row.position, origin: 'import', firstSeenAt: now,
    trackId: null, addedBatch: null, addedAt: null, link: null, anilistIds: [],
  };
}

/** Pair each row with at most one candidate, greedily in row order: same name key, closest length. */
function pairByName<T extends { title: string; artist: string; durationMs: number | null }>(
  rows: PlaylistRow[], pool: T[], withArtist: boolean,
): { pairs: [PlaylistRow, T][]; rows: PlaylistRow[]; pool: T[] } {
  const byKey = new Map<string, T[]>();
  for (const p of pool) {
    const k = nameKey(p.title, p.artist, withArtist);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const pairs: [PlaylistRow, T][] = [];
  const left: PlaylistRow[] = [];
  for (const r of rows) {
    const list = byKey.get(nameKey(r.title, r.artist, withArtist));
    let best = -1, bestDelta = Infinity;
    list?.forEach((p, i) => {
      if (!sameLength(p.durationMs, r.durationMs)) return;
      const d = p.durationMs === null || r.durationMs === null ? SAME_LENGTH_MS : Math.abs(p.durationMs - r.durationMs);
      if (d < bestDelta) { best = i; bestDelta = d; }
    });
    if (best >= 0) pairs.push([r, list!.splice(best, 1)[0]!]);
    else left.push(r);
  }
  const used = new Set(pairs.map(([, p]) => p));
  return { pairs, rows: left, pool: pool.filter((p) => !used.has(p)) };
}

/** Pair leftovers by the duplicate matcher (translations, store renames). `accept` picks the tiers that count. */
function pairByMatcher<T extends PlaylistItem>(
  rows: PlaylistRow[], pool: T[], artistsKnown: boolean, accept: (tier: string, delta: number | null) => boolean,
): { pairs: [PlaylistRow, T][]; rows: PlaylistRow[]; pool: T[] } {
  if (!rows.length || !pool.length) return { pairs: [], rows, pool };
  // Index the rows, query with each pooled item: each item takes its best row.
  const idx: DupIndex = indexRows(rows.map((r, i) => ({ ...r, position: i })), { artistsKnown });
  const taken = new Set<number>();
  const pairs: [PlaylistRow, T][] = [];
  const left: T[] = [];
  for (const p of pool) {
    const m = findDuplicate(idx, { title: p.title, artist: artistsKnown ? p.artist : '', durationMs: p.durationMs });
    if (m && !taken.has(m.row.position) && accept(m.tier, m.durationDeltaMs)) {
      taken.add(m.row.position);
      pairs.push([rows[m.row.position]!, p]);
    } else left.push(p);
  }
  return { pairs, rows: rows.filter((_, i) => !taken.has(i)), pool: left };
}

/**
 * Diff an import against the stored library. Nothing is written: commit the
 * preview's `next` to apply it.
 *
 * 1. Same name and length → unchanged (keeps id, link, and add-log data).
 * 2. App adds (origin 'app') seen in the import → confirmed: they become
 *    imported rows and keep their track id and add-log link.
 * 3. Leftover stored × leftover rows at duplicate tier → renamed (keeps the link).
 * 4. Remaining rows → new; remaining stored rows → missing (dropped);
 *    remaining app adds stay appended ("added, not seen").
 */
export function planImport(stored: PlaylistItem[], parsed: ParseResult, { now = Date.now(), importId = `imp${now.toString(36)}`, prev = null }: PlanOptions = {}): ImportPreview {
  const format: ImportFormat = parsed.format === 'shortcut' ? 'shortcut' : parsed.format === 'pasted' ? 'pasted' : 'export';
  const artistsKnown = parsed.artistsKnown !== false;
  const rows = parsed.rows;
  const sorted = [...stored].sort((a, b) => a.position - b.position);
  const imported = sorted.filter((i) => i.origin === 'import');
  const appAdds = sorted.filter((i) => i.origin === 'app');

  // 1. Unchanged.
  const s1 = pairByName(rows, imported, artistsKnown);
  // 2. App adds seen in the import: by name first, then the matcher (store names differ a little).
  const s2a = pairByName(s1.rows, appAdds, artistsKnown);
  const s2b = pairByMatcher(s2a.rows, s2a.pool, artistsKnown, (tier) => tier === 'duplicate' || tier === 'likely-duplicate');
  // 3. Renamed: only confident pairs, and only when artists can be trusted.
  const s3 = artistsKnown
    ? pairByMatcher(s2b.rows, s1.pool, true, (tier, d) => tier === 'duplicate' || (tier === 'likely-duplicate' && d !== null && d <= SAME_LENGTH_MS))
    : { pairs: [] as [PlaylistRow, PlaylistItem][], rows: s2b.rows, pool: s1.pool };

  const rowItem = new Map<PlaylistRow, PlaylistItem>();
  const take = (r: PlaylistRow, base: PlaylistItem, patch: Partial<PlaylistItem> = {}) => {
    rowItem.set(r, {
      ...base,
      title: r.title,
      artist: artistsKnown ? r.artist : base.artist,
      album: r.album || base.album,
      durationMs: r.durationMs ?? base.durationMs,
      origin: 'import',
      ...patch,
    });
  };
  for (const [r, it] of s1.pairs) take(r, it);
  const confirmed: PlaylistItem[] = [];
  for (const [r, it] of [...s2a.pairs, ...s2b.pairs]) { take(r, it); confirmed.push(rowItem.get(r)!); }
  const renamed: Renamed[] = [];
  for (const [r, it] of s3.pairs) {
    take(r, it);
    renamed.push({ item: rowItem.get(r)!, from: { title: it.title, artist: it.artist } });
  }
  const added: PlaylistItem[] = s3.rows.map((r, i) => {
    const it = newItem(r, `${importId}:${i}`, now);
    if (!artistsKnown) it.artist = '';
    rowItem.set(r, it);
    return it;
  });
  const missing = s3.pool;
  const unseen = s2b.pool;

  // Positions.
  const orderReplaced = parsed.ordered || imported.length === 0;
  let next: PlaylistItem[];
  if (orderReplaced) {
    // Row order is the order; adds not seen yet stay at the end.
    next = [...rows.map((r) => rowItem.get(r)!), ...unseen];
  } else {
    // Keep the stored order for known songs; new rows go to the end, in row order.
    const kept = sorted.filter((it) => it.origin === 'app' ? true : !missing.includes(it));
    const updated = new Map([...rowItem.values()].map((it) => [it.id, it]));
    next = [...kept.map((it) => updated.get(it.id) ?? it), ...added];
  }
  next = next.map((it, i) => ({ ...it, position: i }));

  const event: ImportEvent = {
    id: importId, at: now, format, ordered: parsed.ordered,
    orderIsPlaylist: orderReplaced ? parsed.ordered : !!prev?.orderIsPlaylist,
    artistsKnown, sortedBy: parsed.sortedBy ?? null, warnings: parsed.warnings, rowCount: rows.length,
    diff: {
      new: added.length, missing: missing.length, unchanged: s1.pairs.length, renamed: renamed.length,
      addsConfirmed: confirmed.length, addsUnseen: unseen.length,
    },
  };
  return { event, playlistName: parsed.playlistName, next, added, missing, renamed, confirmed, unseen, orderReplaced };
}

/* ------------------------------------------------------------------ */
/* Appending the app's own adds                                        */
/* ------------------------------------------------------------------ */

export interface AppAdd {
  /** themeKey of the reviewed song. */
  key: string;
  trackId: number;
  title: string;
  artist: string;
  durationMs: number | null;
  anilistId?: number | null;
  slug?: string | null;
}

/** Parse "anilistId:slug" keys; "song:N" keys need the theme index. */
export function hitFromKey(key: string, anilistId: number | null = null, slug: string | null = null): LinkHit {
  const m = key.match(/^(\d+):(.+)$/);
  return { themeKey: key, anilistId: anilistId ?? (m ? Number(m[1]) : null), slug: slug ?? (m ? m[2]! : null) };
}

/** "Yes, mark as added": the batch goes to the end, in its order (watch order). */
export function appendAdds(items: PlaylistItem[], adds: AppAdd[], batchId: string, now = Date.now()): PlaylistItem[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const appended = adds.map<PlaylistItem>((a, i) => {
    const hit = hitFromKey(a.key, a.anilistId ?? null, a.slug ?? null);
    return {
      id: `${batchId}:${i}`, title: a.title, artist: a.artist, album: '', durationMs: a.durationMs,
      position: sorted.length + i, origin: 'app', firstSeenAt: now,
      trackId: a.trackId, addedBatch: batchId, addedAt: now,
      link: { state: 'linked', via: 'add-log', hits: [hit], confidence: 1, at: now, v: LINKER_VERSION },
      anilistIds: hit.anilistId !== null ? [hit.anilistId] : [],
    };
  });
  return [...sorted, ...appended].map((it, i) => ({ ...it, position: i }));
}

/** Undo "mark as added": drop that batch's adds not yet seen in an import. */
export function removeAdds(items: PlaylistItem[], batchId: string): PlaylistItem[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .filter((it) => !(it.origin === 'app' && it.addedBatch === batchId))
    .map((it, i) => ({ ...it, position: i }));
}

/* ------------------------------------------------------------------ */
/* Linking                                                             */
/* ------------------------------------------------------------------ */

export type LinkScope = 'new' | 'unlinked' | 'all';

/** Does this item need the linker, for this scope? Manual links never do. */
export const isManual = (link: ItemLink | null) => !!link && (link.state === 'linked' ? link.via === 'manual' : !!link.manual);

export function needsLink(it: PlaylistItem, scope: LinkScope): boolean {
  if (isManual(it.link)) return false;
  if (!it.link) return true;
  if (it.link.v < LINKER_VERSION) return true;
  if (it.link.state === 'linked' && it.link.via === 'add-log') return it.link.hits.some((h) => h.anilistId === null);
  if (scope === 'all') return true;
  return scope === 'unlinked' && it.link.state === 'unlinked';
}

const asRow = (it: PlaylistItem): PlaylistRow => ({ position: it.position + 1, title: it.title, artist: it.artist, album: it.album, durationMs: it.durationMs });

/** Every show using a theme key (a song shared by several shows links to each). */
function hitsOfKey(index: ThemeIndex, key: string): LinkHit[] {
  const es = index.byKey.get(key) ?? [];
  if (!es.length) return [hitFromKey(key)];
  return [...new Map(es.map((e) => {
    const { show, theme } = index.entries[e]!;
    return [show.anilistId, { themeKey: key, anilistId: show.anilistId, slug: theme.slug }] as const;
  })).values()];
}

export function idsOf(link: ItemLink | null): number[] {
  if (!link || link.state !== 'linked') return [];
  return [...new Set(link.hits.map((h) => h.anilistId).filter((x): x is number => x !== null))];
}

/**
 * Link one item: add-log links get their show filled in; others go through
 * mapRow (exact via reviewed matches, else fuzzy against every theme).
 */
export function linkItem(it: PlaylistItem, index: ThemeIndex, exact: Map<string, string[]>, now = Date.now()): PlaylistItem {
  if (isManual(it.link)) return it;
  if (it.link?.state === 'linked' && it.link.via === 'add-log') {
    const hits = it.link.hits.flatMap((h) => (h.anilistId === null ? hitsOfKey(index, h.themeKey) : [h]));
    const link: ItemLink = { ...it.link, hits, v: LINKER_VERSION };
    return { ...it, link, anilistIds: idsOf(link) };
  }
  const m: RowMapping = mapRow(asRow(it), index, exact);
  const toHit = (h: { show: Show; theme: Parameters<typeof themeKey>[0] & { slug: string } }): LinkHit =>
    ({ themeKey: themeKey(h.theme), anilistId: h.show.anilistId, slug: h.theme.slug });
  let link: ItemLink;
  if (m.hits.length) {
    const best = m.hits[0]!;
    const hits = [...new Map(m.hits.map((h) => [`${h.show.anilistId}:${h.theme.slug}`, toHit(h)])).values()];
    link = { state: 'linked', via: best.method === 'exact' ? 'exact' : 'fuzzy', hits, confidence: Math.round(best.confidence * 1000) / 1000, at: now, v: LINKER_VERSION };
  } else {
    const n = m.nearest;
    link = { state: 'unlinked', nearest: n ? { ...toHit(n), confidence: Math.round(n.confidence * 1000) / 1000 } : null, at: now, v: LINKER_VERSION };
  }
  return { ...it, link, anilistIds: idsOf(link) };
}

/** A manual link (or unlink, with null). */
export function setManualLink(it: PlaylistItem, hit: LinkHit | null, now = Date.now()): PlaylistItem {
  const link: ItemLink = hit
    ? { state: 'linked', via: 'manual', hits: [hit], confidence: 1, at: now, v: LINKER_VERSION }
    // An explicit unlink is also the user's word: keep the linker off it.
    : { state: 'unlinked', nearest: null, at: now, v: LINKER_VERSION, manual: true };
  return { ...it, link, anilistIds: idsOf(link) };
}

/* ------------------------------------------------------------------ */
/* Reading the library                                                 */
/* ------------------------------------------------------------------ */

export interface LinkProgress {
  phase: 'themes' | 'linking';
  done: number;
  total: number;
}

export interface PlaylistStatus {
  name: string;
  rowCount: number;
  syncedAt: number | null;
  /** The stored order is playlist order (from an ordered import). */
  ordered: boolean;
  source: ImportFormat | null;
  stale: boolean;
  linked: number;
  unlinked: number;
  /** Not linked yet (linker hasn't run on them). */
  pending: number;
  /** App adds not yet seen in an import. */
  pendingAdds: number;
  linking: LinkProgress | null;
  lastImport: ImportEvent | null;
}

export function computeStatus(meta: PlaylistMeta | null, items: PlaylistItem[], linking: LinkProgress | null, now = Date.now()): PlaylistStatus | null {
  if (!meta && !items.length) return null;
  const syncedAt = meta?.syncedAt ?? null;
  return {
    name: meta?.name ?? 'Playlist',
    rowCount: items.length,
    syncedAt,
    ordered: !!meta?.lastImport?.orderIsPlaylist,
    source: meta?.lastImport?.format ?? null,
    stale: syncedAt === null || now - syncedAt > STALE_MS,
    linked: items.filter((i) => i.link?.state === 'linked').length,
    unlinked: items.filter((i) => i.link?.state === 'unlinked').length,
    pending: items.filter((i) => !i.link).length,
    pendingAdds: items.filter((i) => i.origin === 'app').length,
    linking,
    lastImport: meta?.lastImport ?? null,
  };
}

/** Trusted theme keys of an item, for duplicate checks. */
export function trustedKeys(it: PlaylistItem): string[] {
  return it.link?.state === 'linked' && it.link.confidence >= LINK_TRUSTED ? it.link.hits.map((h) => h.themeKey) : [];
}

/** Items as playlist rows (1-based positions), carrying trusted theme keys. */
export function itemsAsRows(items: PlaylistItem[], { includeAppAdds = false } = {}): PlaylistRow[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .filter((it) => includeAppAdds || it.origin === 'import')
    .map((it, i) => ({ position: i + 1, title: it.title, artist: it.artist, album: it.album, durationMs: it.durationMs, themeKeys: trustedKeys(it) }));
}

export interface Coverage {
  /** Distinct OP/ED/inserts of the show linked in the playlist. */
  inPlaylist: number;
  /** OP/EDs the show has, when its themes are known. */
  total: number | null;
}

/** Per-show coverage: linked songs vs the show's known OP/EDs. */
export function coverage(items: PlaylistItem[], themeCounts: Map<number, number>): Map<number, Coverage> {
  const linked = new Map<number, Set<string>>();
  for (const it of items) {
    if (it.link?.state !== 'linked' || it.link.confidence < LINK_TRUSTED) continue;
    for (const h of it.link.hits) {
      if (h.anilistId === null) continue;
      const s = linked.get(h.anilistId) ?? new Set<string>();
      s.add(h.slug ?? h.themeKey);
      linked.set(h.anilistId, s);
    }
  }
  const out = new Map<number, Coverage>();
  for (const id of new Set([...linked.keys(), ...themeCounts.keys()])) {
    out.set(id, { inPlaylist: linked.get(id)?.size ?? 0, total: themeCounts.get(id) ?? null });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Suggest last show                                                   */
/* ------------------------------------------------------------------ */

export interface LastShowSuggestion {
  anilistId: number;
  /** e.g. 'Linked: "Idol" (OP1), #333' */
  evidence: string;
  /** With an ordered playlist: the show of the last linked song, when it disagrees. */
  tailAnilistId: number | null;
  /** Songs of this show in the playlist. */
  support: number;
}

/** Watch-order key: completion date, else last list update. Higher = more recent. */
export function watchKey(s: Show): number {
  const c = s.completedAt;
  if (c?.year) return c.year * 10_000 + (c.month ?? 0) * 100 + (c.day ?? 0);
  if (s.updatedAt) {
    const d = new Date(s.updatedAt * 1000);
    return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  return -Infinity;
}

/**
 * "The last show in your playlist": the most recently watched show with a
 * trusted linked song. Works from any import, ordered or not. With an
 * ordered playlist, also reports the show of the last linked row when it
 * points elsewhere (a cross-check, as the old tail view did).
 */
export function suggestLastShow(items: PlaylistItem[], shows: Show[], ordered = false): LastShowSuggestion | null {
  const byId = new Map(shows.filter((s) => s.status !== 'PLANNING').map((s) => [s.anilistId, s]));
  const sorted = [...items].sort((a, b) => a.position - b.position);
  let best: { show: Show; item: PlaylistItem; slug: string | null } | null = null;
  const support = new Map<number, number>();
  for (const it of sorted) {
    if (it.link?.state !== 'linked' || it.link.confidence < LINK_TRUSTED) continue;
    for (const h of it.link.hits) {
      const show = h.anilistId !== null ? byId.get(h.anilistId) : undefined;
      if (!show) continue;
      support.set(show.anilistId, (support.get(show.anilistId) ?? 0) + 1);
      if (!best || watchKey(show) > watchKey(best.show)) best = { show, item: it, slug: h.slug };
    }
  }
  if (!best) return null;
  let tailAnilistId: number | null = null;
  if (ordered) {
    const last = [...sorted].reverse().find((it) => it.origin === 'import' && it.link?.state === 'linked' && it.link.confidence >= LINK_TRUSTED && it.anilistIds.some((id) => byId.has(id)));
    const id = last?.anilistIds.find((x) => byId.has(x)) ?? null;
    if (id !== null && id !== best.show.anilistId) tailAnilistId = id;
  }
  return {
    anilistId: best.show.anilistId,
    evidence: `“${best.item.title}”${best.slug ? ` (${best.slug})` : ''}, #${best.item.position + 1}`,
    tailAnilistId,
    support: support.get(best.show.anilistId) ?? 0,
  };
}
