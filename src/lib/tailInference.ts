/**
 * V2 (SPEC §9.5): map the playlist tail onto shows and suggest the bound,
 * plus the snapshot duplicate check (§9.4).
 *
 * Name-to-name matching only: playlist rows (title, artist, album) are scored
 * against every theme of every listed show with the catalog matcher's
 * scoreTrack(). No iTunes queries. Cached catalog matches give exact hits.
 */
import type { Show, Theme } from '../types';
import { displayTitle } from './anilist';
import type { ItunesTrack } from './itunes';
import { coreTitle, normalize, scoreTrack, THRESHOLD, type ThemeContext } from './matcher';
import { themeKey, type MatchResult } from './matching';
import type { OrderedShow } from './ordering';
import type { PlaylistRow } from './playlistImport';

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const TAIL_DEFAULT = 30;
/** Minimum confidence for a row → theme mapping. */
export const ACCEPT = 0.6;
/** Added when the row's title or album names the show ("… Opening Theme"). */
export const MENTION_BONUS = 0.1;
/** Below this title similarity scoreTrack halves the score, so no theme can pass ACCEPT. */
const MIN_TITLE_SIM = 0.5;

/* ------------------------------------------------------------------ */
/* Show titles                                                         */
/* ------------------------------------------------------------------ */

const SEASON_SUFFIX =
  /\s*(?:season\s*\d+|\d+(?:st|nd|rd|th)\s+season|(?:part|cour)\s*\d+|final\s+season|第\s*[\d一二三四五六七八九十]+\s*(?:期|シーズン|クール)|\b(?:ii|iii|iv|v|vi)\b|\d+)\s*$/i;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/**
 * Titles a track name or album might mention: the AniList titles plus their
 * stems without season markers or subtitles, normalized. "Hell's Paradise
 * Season 2" → "hell s paradise season 2", "hell s paradise".
 */
export function titleStems(show: Pick<Show, 'title'>): string[] {
  const raw = [show.title.english, show.title.romaji, show.title.native, displayTitle(show)].filter((x): x is string => !!x);
  const out = new Set<string>();
  for (const t of raw) {
    const clean = t.replace(/[【】[\]「」『』]/g, ' ').trim();
    const forms = [clean, clean.replace(SEASON_SUFFIX, ''), clean.split(/\s*[:：]\s*|\s+[-–—]\s+/)[0] ?? ''];
    for (const f of forms) {
      let n = normalize(f);
      // Peel repeated suffixes: "x 2nd season part 2".
      for (let i = 0; i < 3; i++) { const m = n.replace(SEASON_SUFFIX, '').trim(); if (m === n) break; n = m; }
      const compactLen = n.replace(/\s+/g, '').length;
      if (n && (CJK.test(n) ? compactLen >= 2 : compactLen >= 4)) out.add(n);
    }
  }
  return [...out];
}

function mentions(haystack: string, stems: string[]): boolean {
  if (!haystack) return false;
  const padded = ` ${haystack} `;
  return stems.some((s) => (CJK.test(s) ? haystack.includes(s) : padded.includes(` ${s} `)));
}

/* ------------------------------------------------------------------ */
/* Theme index                                                         */
/* ------------------------------------------------------------------ */

interface Entry {
  show: Show;
  theme: Theme;
  ctx: ThemeContext;
  stems: string[];
  key: string;
}

interface Variant {
  entry: number;
  compact: string;
  len: number;
}

export interface ThemeIndex {
  entries: Entry[];
  variants: Variant[];
  /** bigram → [variant, count] postings: the prefilter. */
  grams: Map<string, [number, number][]>;
  byKey: Map<string, number[]>;
}

/** Same bigrams as matcher.dice(): whitespace removed; one-char strings are one gram. */
function gramCounts(compact: string): Map<string, number> {
  const m = new Map<string, number>();
  if (compact.length < 2) { if (compact) m.set(compact, 1); return m; }
  for (let i = 0; i < compact.length - 1; i++) { const g = compact.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
const compactTitle = (s: string) => coreTitle(s).replace(/\s+/g, '');

/** Index every theme of every show (IN themes included: some are in playlists too). */
export function buildThemeIndex(shows: Show[], themesFor: (s: Show) => Theme[]): ThemeIndex {
  const entries: Entry[] = [];
  const variants: Variant[] = [];
  const grams = new Map<string, [number, number][]>();
  const byKey = new Map<string, number[]>();
  for (const show of shows) {
    const stems = titleStems(show);
    for (const theme of themesFor(show)) {
      const e = entries.length;
      const key = themeKey(theme);
      entries.push({ show, theme, ctx: { theme, animeTitles: stems }, stems, key });
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
      const titles = new Set([theme.songTitle, theme.songTitleNative].filter((x): x is string => !!x).map(compactTitle).filter(Boolean));
      for (const compact of titles) {
        const v = variants.length;
        const counts = gramCounts(compact);
        let len = 0;
        for (const [g, c] of counts) { len += c; const p = grams.get(g); p ? p.push([v, c]) : grams.set(g, [[v, c]]); }
        variants.push({ entry: e, compact, len });
      }
    }
  }
  return { entries, variants, grams, byKey };
}

/** Entries whose title could reach MIN_TITLE_SIM: exact multiset Dice via the postings. */
function prefilter(index: ThemeIndex, title: string): number[] {
  const compact = compactTitle(title);
  if (!compact) return [];
  const counts = gramCounts(compact);
  let len = 0;
  const hits = new Map<number, number>();
  for (const [g, c] of counts) {
    len += c;
    for (const [v, vc] of index.grams.get(g) ?? []) hits.set(v, (hits.get(v) ?? 0) + Math.min(c, vc));
  }
  const out = new Set<number>();
  for (const [v, h] of hits) {
    const variant = index.variants[v]!;
    const sim = variant.compact === compact ? 1 : (2 * h) / (len + variant.len);
    if (sim >= MIN_TITLE_SIM - 1e-9) out.add(variant.entry);
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

const FEAT_IN_TITLE = /[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/gi;

/** A playlist row in the shape scoreTrack expects. Featured artists named in the title count as artists. */
export function rowAsTrack(row: PlaylistRow): ItunesTrack {
  const featured = [...row.title.matchAll(FEAT_IN_TITLE)].map((m) => m[1]!.trim());
  return {
    trackId: -row.position,
    trackName: row.title,
    artistName: [row.artist, ...featured].filter(Boolean).join(', '),
    collectionName: row.album,
    collectionId: 0,
    trackTimeMillis: row.durationMs,
    previewUrl: null,
    trackViewUrl: '',
    artworkUrl100: null,
    isStreamable: null,
    country: '',
    trackNumber: null,
    trackCount: null,
    releaseDate: null,
  };
}

const nameKey = (title: string, artist: string) => `${normalize(title)}|${normalize(artist)}`;

/** normalized "title|artist" of each cached match's chosen track → theme keys. */
export function exactKeys(matches: Iterable<MatchResult>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of matches) {
    const t = m.candidates.find((c) => c.track.trackId === m.chosenId)?.track;
    if (!t) continue;
    const k = nameKey(t.trackName, t.artistName);
    out.set(k, [...new Set([...(out.get(k) ?? []), m.key])]);
  }
  return out;
}

export interface ThemeHit {
  show: Show;
  theme: Theme;
  confidence: number;
  method: 'exact' | 'fuzzy';
  titleSim: number;
  artistSim: number;
  mentionsShow: boolean;
}

export interface RowMapping {
  row: PlaylistRow;
  /** Accepted hits tied for best (usually one; a song shared by several shows gives more). */
  hits: ThemeHit[];
  /** Best rejected candidate, for display ("closest: …"). */
  nearest: ThemeHit | null;
}

/** Map one row: exact via cached matches, else fuzzy over the prefiltered themes. */
export function mapRow(row: PlaylistRow, index: ThemeIndex, exact: Map<string, string[]> = new Map()): RowMapping {
  const exactThemes = (exact.get(nameKey(row.title, row.artist)) ?? []).flatMap((k) => index.byKey.get(k) ?? []);
  if (exactThemes.length) {
    const hits = [...new Set(exactThemes)].map((e) => {
      const { show, theme } = index.entries[e]!;
      return { show, theme, confidence: 1, method: 'exact' as const, titleSim: 1, artistSim: 1, mentionsShow: false };
    });
    return { row, hits, nearest: null };
  }

  const track = rowAsTrack(row);
  const hay = `${normalize(row.title)} ${normalize(row.album)}`.trim();
  const scored: ThemeHit[] = prefilter(index, row.title).map((e) => {
    const { show, theme, ctx, stems } = index.entries[e]!;
    const s = scoreTrack(ctx, track);
    const mentionsShow = mentions(hay, stems);
    const confidence = Math.min(1, s.score + (mentionsShow ? MENTION_BONUS : 0));
    return { show, theme, confidence, method: 'fuzzy', titleSim: s.titleSim, artistSim: s.artistSim, mentionsShow };
  });
  scored.sort((a, b) => b.confidence - a.confidence);
  // A title-only match ("Personal" by someone else) is not evidence: need the
  // artist, or the show named in the title/album.
  const accepted = scored.filter((h) => h.confidence >= ACCEPT && (h.artistSim >= 0.6 || h.mentionsShow));
  const best = accepted[0];
  if (!best) return { row, hits: [], nearest: scored[0] ?? null };
  return { row, hits: accepted.filter((h) => h.confidence >= best.confidence - 1e-9), nearest: null };
}

/* ------------------------------------------------------------------ */
/* Bound suggestion                                                    */
/* ------------------------------------------------------------------ */

export interface TailRow extends RowMapping {
  /** The hit used for the bound: among ties, the earliest in the current order (conservative). */
  pick: ThemeHit | null;
  /** Index of pick.show in `ordered`, or null if the show is filtered out (e.g. dropped hidden). */
  orderIndex: number | null;
}

export interface BoundSuggestion {
  show: Show;
  hit: ThemeHit;
  orderIndex: number;
  /** Playlist position of the row that set it. */
  rowPosition: number;
  /** Tail rows mapped to this show. */
  support: number;
  /** One row only, below the "confident" threshold: double-check it. */
  weak: boolean;
}

export interface TailInference {
  tail: TailRow[];
  suggestion: BoundSuggestion | null;
  mapped: number;
  unmatched: number;
  /** Mapped to a show that the current filters exclude from the order. */
  excluded: number;
}

export interface InferOptions {
  rows: PlaylistRow[];
  index: ThemeIndex;
  /** orderShows() output: the current sort order. */
  ordered: OrderedShow[];
  direction: 'asc' | 'desc';
  matches?: Iterable<MatchResult>;
  n?: number;
}

/**
 * Map the last `n` rows and suggest the mapped show that is most recent in
 * the current sort order. Not simply the show of the last row: playlist
 * order and watch order disagree whenever songs were added out of order.
 */
export function inferTail({ rows, index, ordered, direction, matches = [], n = TAIL_DEFAULT }: InferOptions): TailInference {
  const exact = exactKeys(matches);
  const pos = new Map(ordered.map((o, i) => [o.show.anilistId, i]));
  const recency = (i: number) => (direction === 'asc' ? i : ordered.length - 1 - i);

  const tail: TailRow[] = rows.slice(-Math.max(1, n)).map((row) => {
    const m = mapRow(row, index, exact);
    const inOrder = m.hits.filter((h) => pos.has(h.show.anilistId));
    const pick = inOrder.length
      ? inOrder.reduce((a, b) => (recency(pos.get(b.show.anilistId)!) < recency(pos.get(a.show.anilistId)!) ? b : a))
      : m.hits[0] ?? null;
    return { ...m, pick, orderIndex: pick && pos.has(pick.show.anilistId) ? pos.get(pick.show.anilistId)! : null };
  });

  let best: TailRow | null = null;
  for (const r of tail) {
    if (!r.pick || r.orderIndex === null) continue;
    if (!best || recency(r.orderIndex) > recency(best.orderIndex!) ||
      (r.orderIndex === best.orderIndex && r.pick.confidence > best.pick!.confidence)) best = r;
  }
  const support = best ? tail.filter((r) => r.pick?.show.anilistId === best!.pick!.show.anilistId).length : 0;
  const suggestion: BoundSuggestion | null = best && best.pick && best.orderIndex !== null
    ? { show: best.pick.show, hit: best.pick, orderIndex: best.orderIndex, rowPosition: best.row.position, support, weak: support === 1 && best.pick.confidence < THRESHOLD.auto }
    : null;

  return {
    tail,
    suggestion,
    mapped: tail.filter((r) => r.pick).length,
    unmatched: tail.filter((r) => !r.pick).length,
    excluded: tail.filter((r) => r.pick && r.orderIndex === null).length,
  };
}

/* ------------------------------------------------------------------ */
/* Already in the playlist (§9.4)                                      */
/* ------------------------------------------------------------------ */

export const DURATION_TOLERANCE_MS = 3000;

export interface PlaylistIndex {
  exact: Map<string, PlaylistRow[]>;
  core: Map<string, PlaylistRow[]>;
  size: number;
}

const coreKey = (title: string, artist: string) => `${coreTitle(title)}|${normalize(artist)}`;
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };

/** Index the WHOLE snapshot (not just the tail) once; lookups are O(1). */
export function indexPlaylist(rows: PlaylistRow[]): PlaylistIndex {
  const exact = new Map<string, PlaylistRow[]>();
  const core = new Map<string, PlaylistRow[]>();
  for (const r of rows) {
    push(exact, nameKey(r.title, r.artist), r);
    push(core, coreKey(r.title, r.artist), r);
  }
  return { exact, core, size: rows.length };
}

export interface InPlaylist {
  /** duplicate: same title + artist, duration within ±3 s (or unknown). version: same song, other cut/duration. */
  kind: 'duplicate' | 'version';
  row: PlaylistRow;
}

export function findInPlaylist(idx: PlaylistIndex, t: Pick<ItunesTrack, 'trackName' | 'artistName' | 'trackTimeMillis'>): InPlaylist | null {
  const near = (r: PlaylistRow) => r.durationMs === null || t.trackTimeMillis === null || Math.abs(r.durationMs - t.trackTimeMillis) <= DURATION_TOLERANCE_MS;
  const same = idx.exact.get(nameKey(t.trackName, t.artistName));
  if (same?.length) {
    const dup = same.find(near);
    return dup ? { kind: 'duplicate', row: dup } : { kind: 'version', row: same[0]! };
  }
  const sameCore = idx.core.get(coreKey(t.trackName, t.artistName));
  return sameCore?.length ? { kind: 'version', row: sameCore[0]! } : null;
}

/** The chosen track of a match, if any. */
export function chosenTrack(m: MatchResult | undefined): ItunesTrack | undefined {
  return m?.candidates.find((c) => c.track.trackId === m.chosenId)?.track;
}
