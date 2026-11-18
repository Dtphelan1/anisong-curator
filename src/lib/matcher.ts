import type { Theme } from '../types';
import type { ItunesTrack } from './itunes';

/* ------------------------------------------------------------------ */
/* Normalization & similarity                                          */
/* ------------------------------------------------------------------ */

/** Parenthetical / dash suffixes that describe a version, not the song. */
const VERSION_SUFFIX =
  /\s*(?:[(\[（【〔][^)\]）】〕]*[)\]）】〕]|\s[-–—~～]\s.*$|[-–—~～][^-–—~～]*(?:ver(?:sion)?\.?|edit|size|mix|take)[^-–—~～]*[-–—~～]?$)/gi;
const FEAT = /\s*(?:\bfeat\.?|\bft\.?|\bfeaturing\b)\s.*$/i;

/** NFKC + lowercase + strip punctuation; keeps letters/digits of any script. */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Title without version descriptors: "Gurenge (TV Version)" → "gurenge". */
export function coreTitle(s: string): string {
  const stripped = s.normalize('NFKC').replace(FEAT, '').replace(VERSION_SUFFIX, '').trim();
  return normalize(stripped || s);
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, '');
  if (t.length < 2) return t ? [t] : [];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice on character bigrams, whitespace-insensitive (works for CJK). */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a.replace(/\s+/g, '') === b.replace(/\s+/g, '')) return 1;
  const A = bigrams(a), B = bigrams(b);
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const n = counts.get(g);
    if (n) { hits++; counts.set(g, n - 1); }
  }
  return (2 * hits) / (A.length + B.length);
}

export function similarity(a: string, b: string): number {
  return dice(normalize(a), normalize(b));
}

/** Split "A & B, C feat. D" into artists. */
export function splitArtists(s: string): string[] {
  return s
    .split(/\s*(?:,|&|、|・|\/|\bx\b|×|\bfeat\.?|\bft\.?|\band\b|\bwith\b)\s*/i)
    .map((x) => x.replace(/\(cv[.:][^)]*\)/i, '').trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Version flags                                                       */
/* ------------------------------------------------------------------ */

export type Flag = 'tv' | 'instrumental' | 'karaoke' | 'live' | 'firstTake' | 'remix' | 'acoustic' | 'cover' | 'altVersion' | 'soundtrack';

const FLAG_PATTERNS: [Flag, RegExp][] = [
  ['tv', /\btv\s*(?:size|ver(?:sion)?\.?|edit|mix)\b|tvサイズ|tv\s*size|anime\s*(?:size|ver(?:sion)?)/i],
  ['instrumental', /instrumental|off\s*vocal|inst\.?\)|カラオケ\s*ver|backing\s*track/i],
  ['karaoke', /karaoke|カラオケ|originally performed|in the style of/i],
  ['live', /\blive\b|ライブ/i],
  ['firstTake', /first\s*take/i],
  ['remix', /remix|\bmix\)|リミックス/i],
  ['acoustic', /acoustic|unplugged|アコースティック/i],
  // Cover factories title tracks 'X (From "Anime")'; official releases don't.
  ['cover', /\bcover\b|カバー|[(\[]\s*(?:from|as heard in|inspired by)\s+["“'‘]/i],
  ['altVersion', /\bver(?:sion)?\.?\b|\bedit\b|ver\.|バージョン|～.*ver/i],
];

export function trackFlags(t: Pick<ItunesTrack, 'trackName' | 'collectionName'>): Flag[] {
  const name = t.trackName;
  const flags = new Set<Flag>();
  for (const [flag, re] of FLAG_PATTERNS) if (re.test(name)) flags.add(flag);
  // Karaoke compilations often say it only in the album name.
  if (/karaoke|カラオケ|instrumental|piano|orgel|オルゴール|music box|lullaby/i.test(t.collectionName)) {
    flags.add(/karaoke|カラオケ/i.test(t.collectionName) ? 'karaoke' : 'cover');
  }
  // Score albums often hold same-named composer tracks, not the vocal theme.
  if (/soundtrack|\bost\b|サウンドトラック|サントラ/i.test(t.collectionName)) flags.add('soundtrack');
  if (flags.size > 1) flags.delete('altVersion');
  return [...flags];
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface MatchPrefs {
  /** Prefer TV-size cuts over full versions. */
  preferTvSize: boolean;
}
export const DEFAULT_PREFS: MatchPrefs = { preferTvSize: false };

export interface ScoredTrack {
  track: ItunesTrack;
  score: number;
  titleSim: number;
  artistSim: number;
  flags: Flag[];
}

const PENALTY: Record<Flag, number> = {
  tv: 0.08, instrumental: 0.5, karaoke: 0.6, live: 0.15, firstTake: 0.12, remix: 0.2, acoustic: 0.15, cover: 0.45, altVersion: 0.04, soundtrack: 0.12,
};

export interface ThemeContext {
  theme: Theme;
  /** Anime titles, used for the album-name bonus. */
  animeTitles: string[];
}

/**
 * Score a track against a theme. `variants` are the same track (same id) as
 * named by other storefronts, e.g. the JP and US listings: similarity takes
 * the best name, and version flags are the union, so a cover can't hide
 * behind a storefront whose name omits "(From …)".
 */
export function scoreTrack({ theme, animeTitles }: ThemeContext, track: ItunesTrack, prefs: MatchPrefs = DEFAULT_PREFS, variants: ItunesTrack[] = []): ScoredTrack {
  const named = [track, ...variants.filter((v) => v.trackId === track.trackId && v !== track)];
  const titles = [theme.songTitle, theme.songTitleNative].filter((x): x is string => !!x);
  const titleSim = Math.max(0, ...named.flatMap((n) => titles.map((t) => dice(coreTitle(t), coreTitle(n.trackName)))));

  const themeArtists = [...theme.artists, ...theme.artistsNative].map(normalize).filter(Boolean);
  let artistSim = 0;
  for (const n of named) {
    const trackArtists = splitArtists(n.artistName).map(normalize);
    const trackArtistFull = normalize(n.artistName);
    for (const a of themeArtists) {
      if (trackArtistFull.includes(a) && a.length >= 2) artistSim = Math.max(artistSim, 0.95);
      for (const b of trackArtists) artistSim = Math.max(artistSim, dice(a, b));
    }
  }
  // No artist info on the theme: neither reward nor punish.
  if (!themeArtists.length) artistSim = 0.5;

  const albumBonus = named.some((n) => {
    const album = normalize(n.collectionName);
    return animeTitles.some((t) => { const a = normalize(t); return a.length >= 3 && album.includes(a); }) ||
      /\b(?:opening|ending|op|ed)\b|主題歌|オープニング|エンディング/i.test(n.collectionName);
  }) ? 1 : 0;

  const flags = [...new Set(named.flatMap((n) => trackFlags(n)))];
  if (flags.length > 1) flags.splice(flags.indexOf('altVersion') >>> 0, flags.includes('altVersion') ? 1 : 0);
  let penalty = 0;
  for (const f of flags) {
    if (f === 'tv' && prefs.preferTvSize) continue;
    penalty += PENALTY[f];
  }
  if (prefs.preferTvSize && !flags.includes('tv')) penalty += 0.05;
  if (track.isStreamable === false) penalty += 0.3;

  let score = 0.62 * titleSim + 0.3 * artistSim + 0.08 * albumBonus - penalty;
  // A weak title match can't be rescued by artist/album alone.
  if (titleSim < 0.5) score *= 0.5;
  return { track, score: Math.max(0, Math.min(1, score)), titleSim, artistSim, flags };
}

export function rankTracks(ctx: ThemeContext, tracks: ItunesTrack[], prefs?: MatchPrefs): ScoredTrack[] {
  const seen = new Set<number>();
  return tracks
    .filter((t) => (seen.has(t.trackId) ? false : (seen.add(t.trackId), true)))
    .map((t) => scoreTrack(ctx, t, prefs))
    .sort((a, b) => b.score - a.score || (b.track.trackTimeMillis ?? 0) - (a.track.trackTimeMillis ?? 0));
}

export const THRESHOLD = { auto: 0.8, check: 0.55 } as const;
export type Confidence = 'high' | 'check' | 'low' | 'none';
export function confidenceOf(score: number | null): Confidence {
  if (score === null) return 'none';
  if (score >= THRESHOLD.auto) return 'high';
  if (score >= THRESHOLD.check) return 'check';
  return 'low';
}

/* ------------------------------------------------------------------ */
/* Query planning                                                      */
/* ------------------------------------------------------------------ */

export interface SearchStep {
  term: string;
  country: string;
}

/**
 * Searches to try, in order, stopping once the best score clears `check`.
 * Cheap first: romaji title + artist in the user's store; title alone;
 * then native title (+ native artist) in the JP store, whose ids are global;
 * then the native title alone there, since a romaji artist name (all most
 * themes have) can sink a JP search: "来れ恋・至れ愛 Rentarou Family" finds
 * nothing, "来れ恋・至れ愛" finds the single first.
 */
export function planSearches(theme: Theme, country: string, animeTitles: string[] = []): SearchStep[] {
  const steps: SearchStep[] = [];
  const title = theme.songTitle ? theme.songTitle.replace(FEAT, '').trim() : null;
  const artist = theme.artists[0];
  if (title && artist) steps.push({ term: `${title} ${artist}`, country });
  if (title) steps.push({ term: title, country });
  // No artist on record: the anime title is the next best disambiguator.
  if (title && !artist && animeTitles[0]) steps.push({ term: `${title} ${animeTitles[0]}`, country });
  const native = theme.songTitleNative;
  if (native) {
    steps.push({ term: [native, theme.artistsNative[0] ?? artist].filter(Boolean).join(' '), country: 'jp' });
    steps.push({ term: native, country: 'jp' });
  } else if (title && country !== 'jp' && artist) steps.push({ term: `${title} ${artist}`, country: 'jp' });
  const seen = new Set<string>();
  return steps.filter((s) => { const k = `${s.country}|${normalize(s.term)}`; return seen.has(k) ? false : (seen.add(k), true); });
}
