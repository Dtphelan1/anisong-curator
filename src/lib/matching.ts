import type { Theme } from '../types';
import { lookup as itunesLookup, parseAppleMusicUrl, searchSongs, type ItunesTrack } from './itunes';
import { DEFAULT_PREFS, planSearches, rankTracks, scoreTrack, THRESHOLD, type Flag, type MatchPrefs, type ScoredTrack, type ThemeContext } from './matcher';

export type MatchMethod = 'animethemes-link' | 'search' | 'manual' | 'none';

export interface Candidate {
  track: ItunesTrack;
  score: number;
  flags: Flag[];
  titleSim: number;
  artistSim: number;
}

export interface MatchResult {
  /** themeKey(): one match per song, shared by every show that uses it. */
  key: string;
  country: string;
  candidates: Candidate[];
  chosenId: number | null;
  score: number | null;
  method: MatchMethod;
  /** iTunes requests spent (budget accounting). */
  requests: number;
  matchedAt: number;
  /** User picked/pasted the track: never auto-replace. */
  userPicked: boolean;
}

export function themeKey(t: Pick<Theme, 'songId' | 'anilistId' | 'slug'>): string {
  return t.songId ? `song:${t.songId}` : `${t.anilistId}:${t.slug}`;
}

export interface MatchDeps {
  search?: typeof searchSongs;
  lookup?: typeof itunesLookup;
  now?: () => number;
}

const KEEP = 6;
const toCandidate = (s: ScoredTrack): Candidate => ({ track: s.track, score: s.score, flags: s.flags, titleSim: s.titleSim, artistSim: s.artistSim });

function result(ctx: ThemeContext, country: string, pool: Candidate[], method: MatchMethod, requests: number, now: number, forcedScore?: number): MatchResult {
  const candidates = [...pool].sort((a, b) => b.score - a.score).slice(0, KEEP);
  const best = candidates[0];
  return {
    key: themeKey(ctx.theme),
    country,
    candidates,
    chosenId: best?.track.trackId ?? null,
    score: best ? forcedScore ?? best.score : null,
    method: best ? method : 'none',
    requests,
    matchedAt: now,
    userPicked: false,
  };
}

/**
 * Resolve themes that carry an AnimeThemes Apple Music link. All song and
 * album ids go into ONE lookup call (plus one JP re-lookup for albums whose
 * localized track names don't match). Curated song links are trusted.
 */
export async function matchLinked(
  ctxs: ThemeContext[],
  country: string,
  prefs: MatchPrefs = DEFAULT_PREFS,
  { lookup = itunesLookup, now = Date.now }: MatchDeps = {},
): Promise<Map<string, MatchResult>> {
  const out = new Map<string, MatchResult>();
  const linked = ctxs
    .map((ctx) => ({ ctx, ref: ctx.theme.appleMusicUrl ? parseAppleMusicUrl(ctx.theme.appleMusicUrl) : null }))
    .filter((x): x is { ctx: ThemeContext; ref: NonNullable<typeof x.ref> } => !!x.ref);
  if (!linked.length) return out;

  const ids = [...new Set(linked.map((l) => l.ref.id))];
  const local = await lookup(ids, country);
  let requests = 1;
  const byTrack = new Map(local.map((t) => [t.trackId, t]));
  const byAlbum = (tracks: ItunesTrack[], albumId: number) => tracks.filter((t) => t.collectionId === albumId);

  const retryInJp: typeof linked = [];
  for (const l of linked) {
    if (l.ref.kind === 'song') {
      const t = byTrack.get(l.ref.id);
      if (!t) continue; // not available in this storefront → falls back to search
      const s = scoreTrack(l.ctx, t, prefs);
      out.set(themeKey(l.ctx.theme), result(l.ctx, country, [toCandidate(s)], 'animethemes-link', requests, now(), Math.max(s.score, 0.95)));
    } else {
      const ranked = rankTracks(l.ctx, byAlbum(local, l.ref.id), prefs);
      const best = ranked[0];
      if (best && best.titleSim >= 0.5) {
        out.set(themeKey(l.ctx.theme), result(l.ctx, country, ranked.map(toCandidate), 'animethemes-link', requests, now(), Math.max(best.score, 0.85)));
      } else if (ranked.length) {
        retryInJp.push(l); // localized (often translated) names; JP has native titles
      }
    }
  }

  if (retryInJp.length && country !== 'jp') {
    const jp = await lookup([...new Set(retryInJp.map((l) => l.ref.id))], 'jp');
    requests++;
    for (const l of retryInJp) {
      // Score on JP names, but present the user's-storefront track.
      const ranked = byAlbum(local, l.ref.id)
        .map((t) => scoreTrack(l.ctx, t, prefs, jp))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (!best) continue;
      const trusted = best.titleSim >= 0.5 || ranked.length <= 2 ? Math.max(best.score, 0.85) : best.score;
      out.set(themeKey(l.ctx.theme), result(l.ctx, country, ranked.map(toCandidate), 'animethemes-link', requests, now(), trusted));
    }
  }
  return out;
}

/**
 * Search plan for one theme: stop once a candidate is confident (see
 * goodEnough). JP-store hits are scored on their native names and then
 * checked for availability in the user's store (ids are global).
 */
export async function matchBySearch(
  ctx: ThemeContext,
  country: string,
  prefs: MatchPrefs = DEFAULT_PREFS,
  { search = searchSongs, lookup = itunesLookup, now = Date.now }: MatchDeps = {},
): Promise<MatchResult> {
  const pool = new Map<number, Candidate>();
  let requests = 0;
  const add = (c: Candidate) => {
    const prev = pool.get(c.track.trackId);
    if (!prev || c.score > prev.score) pool.set(c.track.trackId, c);
  };
  // Stop early only on a confident match. A strong title with the wrong
  // artist is usually a cover, so keep looking for the original.
  const goodEnough = () => [...pool.values()].some((c) => c.score >= THRESHOLD.auto || (c.score >= THRESHOLD.check && c.artistSim >= 0.6));

  for (const step of planSearches(ctx.theme, country, ctx.animeTitles)) {
    const found = await search(step.term, step.country);
    requests++;
    const ranked = rankTracks(ctx, found, prefs);
    if (step.country === country) {
      ranked.forEach((s) => add(toCandidate(s)));
    } else {
      // Ids are global: look the foreign hits up in the user's store and score
      // them on both names. Take iTunes' own relevance order too, because a
      // romaji-only theme scores ~0 against a JP-script listing.
      const ids = [...new Set([
        ...found.slice(0, 4).map((t) => t.trackId),
        ...ranked.filter((s) => s.score >= THRESHOLD.check * 0.8).map((s) => s.track.trackId),
      ])].slice(0, 6);
      if (ids.length) {
        const local = await lookup(ids, country);
        requests++;
        for (const t of local) add(toCandidate(scoreTrack(ctx, t, prefs, found)));
      }
    }
    if (goodEnough()) break;
  }
  return result(ctx, country, [...pool.values()], 'search', requests, now());
}

/** A user-chosen track (pasted link or manual search pick). */
export function manualResult(ctx: ThemeContext, country: string, track: ItunesTrack, prev: MatchResult | undefined, prefs?: MatchPrefs, now = Date.now()): MatchResult {
  const s = scoreTrack(ctx, track, prefs);
  const others = (prev?.candidates ?? []).filter((c) => c.track.trackId !== track.trackId);
  return {
    key: themeKey(ctx.theme),
    country,
    candidates: [toCandidate(s), ...others].slice(0, KEEP),
    chosenId: track.trackId,
    score: 1,
    method: 'manual',
    requests: (prev?.requests ?? 0) + 1,
    matchedAt: now,
    userPicked: true,
  };
}
