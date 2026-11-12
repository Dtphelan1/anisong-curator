import type { Theme } from '../types';
import type { PlaylistRow } from './playlistImport';
import { coreTitle, dice, normalize, splitArtists, trackFlags, type Flag } from './matcher';

/**
 * Duplicate prevention for the kept-list export (docs/SPEC.md, "Duplicate
 * prevention"). App-side only:
 * a kept song is scored against the playlist snapshot and the add log, and
 * held back when it is likely already there. Pure: the UI passes in the
 * indexes, the add log and the user's "add anyway" overrides.
 */

export interface ExportItem {
  /** themeKey of the reviewed song. */
  key: string;
  trackId: number;
  title: string;
  artist: string;
  durationMs: number | null;
  url: string;
  /** e.g. "Demon Slayer OP1" — for display only. */
  label: string;
  /** Other names for the song: the theme's romaji and native titles. */
  altTitles?: string[];
  /** Other names for the artist: the theme's artists, romaji and native. */
  altArtists?: string[];
}

/** One song the app recorded as added ("I added these"). */
export interface AddedRecord {
  trackId: number;
  title: string;
  artist: string;
  durationMs: number | null;
  key: string;
  batchId: string;
  addedAt: number;
}

/* ------------------------------------------------------------------ */
/* Likelihood matching                                                 */
/* ------------------------------------------------------------------ */

/**
 * - duplicate: the same recording (title and artist agree, duration within ±3 s or unknown).
 * - likely-duplicate: probably the same song, not certain (looser names, unknown artist, a few seconds off).
 * - other-version: the same song in another cut (TV size vs full, live, remix, ≥ 20 s apart).
 */
export type DupTier = 'duplicate' | 'likely-duplicate' | 'other-version';
export const TIER_RANK: Record<DupTier, number> = { duplicate: 3, 'likely-duplicate': 2, 'other-version': 1 };

/**
 * Thresholds, tuned on dedupe.test.ts (real AnimeThemes/iTunes names):
 * - Title: Dice on bigrams of the core title (version suffixes stripped),
 *   best over the catalog name and the theme's romaji/native titles. 0.9
 *   ≈ the same title up to a character ("Kori"/"Koori"); 0.75 still allows
 *   a word's spelling to differ; translations only meet via alt titles.
 * - Artist: best over the catalog artist and the theme's artists, against
 *   each artist split out of the row; one name inside the other counts 0.95
 *   ("LiSA" in "FictionJunction & LiSA"). Below 0.6 it's another artist: a
 *   cover, or an unrelated song with the same title.
 */
export const DUP = {
  titleDuplicate: 0.9,
  artistDuplicate: 0.8,
  titleLikely: 0.75,
  artistLikely: 0.6,
  titleVersion: 0.8,
  /** ±3 s: the same recording across storefronts/encodes. */
  sameDurationMs: 3000,
  /** ≥ 20 s apart: another cut (TV size ≈ 90 s, full ≈ 4 min). */
  otherCutMs: 20_000,
  /** Containment of one artist name in the other. */
  artistContained: 0.95,
} as const;

/** Flags that mean a different cut of the same song (not "cover"/"alt version"). */
const CUT_FLAGS: Flag[] = ['tv', 'instrumental', 'karaoke', 'live', 'firstTake', 'remix', 'acoustic'];
/** Cheap pre-check: every CUT_FLAGS pattern needs one of these. Most titles have none. */
const MAYBE_CUT = /size|ver|edit|mix|inst|vocal|karaoke|perform|style|live|take|acoustic|unplugged|カラオケ|ライブ|リミックス|アコースティック|サイズ|backing|anime/i;
const cutFlags = (title: string) =>
  MAYBE_CUT.test(title) ? trackFlags({ trackName: title, collectionName: '' }).filter((f) => CUT_FLAGS.includes(f)).sort().join(',') : '';

const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const compact = (s: string) => s.replace(/\s+/g, '');

/** Bigram multiset of the compact core title, as dice() counts it. */
interface Grams { counts: Map<string, number>; total: number }
function grams(core: string): Grams {
  const t = compact(core);
  const counts = new Map<string, number>();
  const add = (g: string) => counts.set(g, (counts.get(g) ?? 0) + 1);
  if (t.length === 1) add(t);
  for (let i = 0; i < t.length - 1; i++) add(t.slice(i, i + 2));
  return { counts, total: t.length === 1 ? 1 : Math.max(0, t.length - 1) };
}

/** Is `part` a whole word (or, for CJK, a substring) of `full`? Both normalized. */
function contains(full: string, part: string): boolean {
  if (compact(part).length < 2 || !full) return false;
  return CJK.test(part) ? full.includes(part) : ` ${full} `.includes(` ${part} `);
}

interface PreparedArtists { full: string[]; parts: string[] }
function prepareArtists(names: string[]): PreparedArtists {
  const full = [...new Set(names.map(normalize).filter(Boolean))];
  const parts = [...new Set(names.flatMap((n) => splitArtists(n)).map(normalize).filter(Boolean))];
  return { full, parts };
}

/** Best artist similarity, or null when either side has none. */
function artistSimilarity(a: PreparedArtists, b: PreparedArtists): number | null {
  if (!a.parts.length || !b.parts.length) return null;
  let best = 0;
  for (const x of a.parts) for (const y of b.parts) best = Math.max(best, dice(x, y));
  if (best >= DUP.artistContained) return best;
  for (const x of a.parts) if (b.full.some((f) => contains(f, x))) return DUP.artistContained;
  for (const y of b.parts) if (a.full.some((f) => contains(f, y))) return DUP.artistContained;
  return best;
}

interface PreparedRow {
  row: PlaylistRow;
  core: string;
  /** Bigram count (multiset size) of the core title. */
  grams: number;
  artists: PreparedArtists;
  cut: string;
}

export interface DupIndex {
  rows: PreparedRow[];
  /** bigram of the compact core title → [row index, count] pairs, flattened. */
  postings: Map<string, number[]>;
  /** False when the snapshot's artists can't be trusted (mismatched shortcut lists). */
  artistsKnown: boolean;
  size: number;
}

/** Index rows once (the whole snapshot, ~2,000 rows); lookups score only rows sharing title bigrams. */
export function indexRows(rows: PlaylistRow[], { artistsKnown = true }: { artistsKnown?: boolean } = {}): DupIndex {
  const prepared: PreparedRow[] = [];
  const postings = new Map<string, number[]>();
  for (const row of rows) {
    const core = coreTitle(row.title);
    if (!compact(core)) continue;
    const g = grams(core);
    const i = prepared.length;
    prepared.push({ row, core, grams: g.total, artists: prepareArtists(artistsKnown && row.artist ? [row.artist] : []), cut: cutFlags(row.title) });
    for (const [gram, n] of g.counts) { const p = postings.get(gram); p ? p.push(i, n) : postings.set(gram, [i, n]); }
  }
  return { rows: prepared, postings, artistsKnown, size: rows.length };
}

/** What we know about a song to check. */
export interface DupQuery {
  title: string;
  artist: string;
  durationMs: number | null;
  altTitles?: string[];
  altArtists?: string[];
}

export interface DupMatch {
  row: PlaylistRow;
  tier: DupTier;
  /** 0–1, for ranking and display. */
  score: number;
  titleSim: number;
  /** null: unknown (no artist on one side). */
  artistSim: number | null;
  durationDeltaMs: number | null;
}

/** No tier is possible below this title similarity. */
const MIN_TITLE = Math.min(DUP.titleLikely, DUP.titleVersion);

/** Classify one pair. Exported for tests and thresholds tuning. */
export function classify(titleSim: number, artistSim: number | null, durationDeltaMs: number | null, cutDiffers: boolean): DupTier | null {
  if (titleSim < MIN_TITLE) return null;
  const otherCut = cutDiffers || (durationDeltaMs !== null && durationDeltaMs >= DUP.otherCutMs);
  const sameLength = durationDeltaMs === null || durationDeltaMs <= DUP.sameDurationMs;
  if (artistSim === null) {
    // Title alone is weak evidence ("Again" by anyone): at most likely, and only when nothing contradicts it.
    return titleSim >= DUP.titleDuplicate && !otherCut && sameLength ? 'likely-duplicate' : null;
  }
  if (artistSim < DUP.artistLikely) return null; // cover, or an unrelated song with the same title
  if (otherCut) return titleSim >= DUP.titleVersion ? 'other-version' : null;
  if (titleSim >= DUP.titleDuplicate && artistSim >= DUP.artistDuplicate && sameLength) return 'duplicate';
  return 'likely-duplicate';
}

/** Prepared query, reusable across indexes. */
interface PreparedQuery {
  cores: string[];
  grams: Grams[];
  artists: PreparedArtists;
  cut: string;
  durationMs: number | null;
}

function prepareQuery(q: DupQuery): PreparedQuery {
  const cores = [...new Set([q.title, ...(q.altTitles ?? [])].filter(Boolean).map(coreTitle).filter((c) => compact(c)))];
  // The theme's artists name the original performers. A track that says it's
  // a cover ('Again (From "…")', karaoke) is by someone else: use its own artist only.
  const isCover = trackFlags({ trackName: q.title, collectionName: '' }).some((f) => f === 'cover' || f === 'karaoke');
  return {
    cores,
    grams: cores.map(grams),
    artists: prepareArtists([q.artist, ...(isCover ? [] : q.altArtists ?? [])].filter(Boolean)),
    cut: cutFlags(q.title),
    durationMs: q.durationMs,
  };
}

/**
 * Title similarity straight from the postings: summing min(count) over shared
 * bigrams is exactly dice() on the core titles, so only rows that share a
 * bigram are touched and nothing is re-tokenized. Returns row → best
 * similarity over the query's titles, for rows that can reach a tier.
 */
function titleCandidates(idx: DupIndex, q: PreparedQuery): Map<number, number> {
  const out = new Map<number, number>();
  const hits = new Float64Array(idx.rows.length);
  const touched: number[] = [];
  for (const g of q.grams) {
    for (const [gram, qn] of g.counts) {
      const p = idx.postings.get(gram);
      if (!p) continue;
      for (let k = 0; k < p.length; k += 2) {
        const i = p[k]!;
        if (hits[i] === 0) touched.push(i);
        hits[i] = hits[i]! + Math.min(qn, p[k + 1]!);
      }
    }
    for (const i of touched) {
      const sim = (2 * hits[i]!) / (g.total + idx.rows[i]!.grams);
      if (sim >= MIN_TITLE && sim > (out.get(i) ?? 0)) out.set(i, sim);
      hits[i] = 0;
    }
    touched.length = 0;
  }
  return out;
}

function better(a: DupMatch | null, b: DupMatch): boolean {
  return !a || TIER_RANK[b.tier] > TIER_RANK[a.tier] || (b.tier === a.tier && b.score > a.score);
}

function findPrepared(idx: DupIndex, q: PreparedQuery): DupMatch | null {
  let best: DupMatch | null = null;
  for (const [i, titleSim] of titleCandidates(idx, q)) {
    const r = idx.rows[i]!;
    const artistSim = artistSimilarity(q.artists, r.artists);
    const durationDeltaMs = q.durationMs !== null && r.row.durationMs !== null ? Math.abs(q.durationMs - r.row.durationMs) : null;
    const tier = classify(titleSim, artistSim, durationDeltaMs, q.cut !== r.cut);
    if (!tier) continue;
    const dur = durationDeltaMs === null ? 0.5 : durationDeltaMs <= DUP.sameDurationMs ? 1 : 0;
    const score = 0.6 * titleSim + 0.3 * (artistSim ?? 0.5) + 0.1 * dur;
    const m: DupMatch = { row: r.row, tier, score: Math.round(score * 1000) / 1000, titleSim, artistSim, durationDeltaMs };
    if (better(best, m)) best = m;
  }
  return best;
}

/** The most likely row this song duplicates, or null. */
export function findDuplicate(idx: DupIndex, q: DupQuery): DupMatch | null {
  return findPrepared(idx, prepareQuery(q));
}

/** The theme's names, as alt titles/artists for a query. */
export function themeNames(theme: Pick<Theme, 'songTitle' | 'songTitleNative' | 'artists' | 'artistsNative'>): Pick<ExportItem, 'altTitles' | 'altArtists'> {
  return {
    altTitles: [theme.songTitle, theme.songTitleNative].filter((x): x is string => !!x),
    altArtists: [...theme.artists, ...theme.artistsNative].filter(Boolean),
  };
}

/** A track's name in another storefront (e.g. JP: 勇者 for "Yuusha"). null: not sold there. */
export type StoreName = { title: string; artist: string } | null;

/** Fold another storefront's name for the track into the alt titles/artists. */
export function withStoreName<T extends { altTitles?: string[]; altArtists?: string[] }>(q: T, name: StoreName | undefined): T {
  if (!name) return q;
  return { ...q, altTitles: [...(q.altTitles ?? []), name.title], altArtists: [...(q.altArtists ?? []), name.artist] };
}

/* ------------------------------------------------------------------ */
/* Both sources: playlist snapshot and add log                         */
/* ------------------------------------------------------------------ */

/** Add-log records as playlist rows, so the same matcher covers both sources. */
export function addedAsRows(added: AddedRecord[]): PlaylistRow[] {
  return added.map((a, i) => ({ position: i + 1, title: a.title, artist: a.artist, album: '', durationMs: a.durationMs }));
}

export interface DupSources {
  playlist?: DupIndex | null;
  added?: AddedRecord[];
  /** Prebuilt index of `added` (else built on the fly). */
  addedIndex?: DupIndex | null;
}

export interface DupHit extends DupMatch {
  source: 'playlist' | 'added';
  /** The add-log record has the same trackId. */
  sameTrack?: boolean;
}

/** Best hit across the add log (trackId first) and the snapshot; the stronger tier wins, the add log on ties. */
export function checkSources(q: DupQuery & { trackId?: number }, { playlist = null, added = [], addedIndex }: DupSources): DupHit | null {
  const byId = q.trackId !== undefined ? added.find((a) => a.trackId === q.trackId) : undefined;
  if (byId) {
    const row = addedAsRows([byId])[0]!;
    return { source: 'added', sameTrack: true, row, tier: 'duplicate', score: 1, titleSim: 1, artistSim: 1, durationDeltaMs: 0 };
  }
  const pq = prepareQuery(q);
  const logIdx = addedIndex ?? (added.length ? indexRows(addedAsRows(added)) : null);
  const log = logIdx && findPrepared(logIdx, pq);
  const pl = playlist && findPrepared(playlist, pq);
  if (log && (!pl || TIER_RANK[log.tier] >= TIER_RANK[pl.tier])) return { ...log, source: 'added' };
  return pl ? { ...pl, source: 'playlist' } : null;
}

/* ------------------------------------------------------------------ */
/* Export plan                                                         */
/* ------------------------------------------------------------------ */

export type HoldReason = 'repeat-in-batch' | 'already-added' | 'in-playlist' | 'likely-in-playlist' | 'other-version';

export interface Held {
  item: ExportItem;
  reason: HoldReason;
  /** Human-readable: what it collided with. */
  detail: string;
  /** Can the user override with "add anyway"? (Repeats can't.) */
  overridable: boolean;
  /** The likelihood match behind the hold (absent for repeats in the batch). */
  hit?: DupHit;
}

export interface ExportPlan {
  add: ExportItem[];
  held: Held[];
}

export const REASON_LABEL: Record<HoldReason, string> = {
  'repeat-in-batch': 'listed twice',
  'already-added': 'already added by the app',
  'in-playlist': 'already in playlist',
  'likely-in-playlist': 'likely in playlist',
  'other-version': 'other version in playlist',
};

export const TIER_LABEL: Record<DupTier, string> = {
  duplicate: 'already in playlist',
  'likely-duplicate': 'likely in playlist',
  'other-version': 'other version in playlist',
};

const nameKey = (title: string, artist: string) => `${normalize(title)}|${normalize(artist)}`;
const describe = (r: { title: string; artist: string }) => (r.artist ? `${r.title} — ${r.artist}` : r.title);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function holdFor(hit: DupHit): Omit<Held, 'item' | 'overridable'> {
  const why = hit.sameTrack ? 'same track' : `${hit.tier === 'duplicate' ? '' : `${hit.tier === 'other-version' ? 'other version' : 'likely'}, `}${pct(hit.score)}`;
  if (hit.source === 'added') {
    return hit.tier === 'other-version'
      ? { reason: 'other-version', detail: `added earlier: ${describe(hit.row)} (${why})`, hit }
      : { reason: 'already-added', detail: hit.sameTrack ? 'same track' : `${describe(hit.row)} (${why})`, hit };
  }
  const reason: HoldReason = hit.tier === 'duplicate' ? 'in-playlist' : hit.tier === 'likely-duplicate' ? 'likely-in-playlist' : 'other-version';
  return { reason, detail: `#${hit.row.position}: ${describe(hit.row)} (${why})`, hit };
}

export function planExport(
  items: ExportItem[],
  { playlist = null, added = [], overrides = new Set<string>() }: { playlist?: DupIndex | null; added?: AddedRecord[]; overrides?: Set<string> } = {},
): ExportPlan {
  const addedIndex = added.length ? indexRows(addedAsRows(added)) : null;
  const seenIds = new Set<number>();
  const seenNames = new Map<string, ExportItem>();
  const add: ExportItem[] = [];
  const held: Held[] = [];

  for (const item of items) {
    const name = nameKey(item.title, item.artist);
    const first = seenIds.has(item.trackId) ? add.find((a) => a.trackId === item.trackId) : seenNames.get(name);
    if (first) {
      held.push({ item, reason: 'repeat-in-batch', detail: `same song as ${first.label}`, overridable: false });
      continue;
    }
    const hit = checkSources(item, { playlist, added, addedIndex });
    if (hit && !overrides.has(item.key)) {
      held.push({ item, ...holdFor(hit), overridable: true });
      continue;
    }
    seenIds.add(item.trackId);
    seenNames.set(name, item);
    add.push(item);
  }
  return { add, held };
}

/**
 * Shortcut format: `Title | Artist | URL`, one song per line. The add
 * shortcut only extracts the URLs; the names are for reading. A literal
 * " | " inside a name is replaced with " / " to keep the columns readable.
 */
export function shortcutLine(item: Pick<ExportItem, 'title' | 'artist' | 'url'>): string {
  const clean = (s: string) => s.replace(/\s*\|\s*/g, ' / ').replace(/[\r\n]+/g, ' ').trim();
  return `${clean(item.title)} | ${clean(item.artist)} | ${item.url}`;
}
