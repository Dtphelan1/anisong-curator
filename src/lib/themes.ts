import type { Show, Theme, ThemeKind, ThemeLookup } from '../types';
import { HttpError, limitedFetch, limiters } from './rateLimit';
import { skipsJikan } from './mediaFormat';

/* ------------------------------------------------------------------ */
/* AnimeThemes (GraphQL)                                               */
/* ------------------------------------------------------------------ */
/*
 * The REST/JSON:API at api.animethemes.moe is deprecated (and was returning
 * 503 for every request on 2026-11-11). The GraphQL API has a purpose-built,
 * natively batched lookup by external id. 100 ids per call verified working;
 * we use 50 for headroom under the query-complexity limit (200).
 * Note: the docs call it `filterAnimeByExternalSite`; the live schema says
 * `findAnimeByExternalSite`.
 */

export const ANIMETHEMES_GRAPHQL = 'https://graphql.animethemes.moe/';
export const ANIMETHEMES_BATCH = 50;

export const ANIMETHEMES_QUERY = /* GraphQL */ `
  query ($id: [Int!]) {
    findAnimeByExternalSite(site: ANILIST, id: $id) {
      resources { nodes { site externalId } }
      animethemes {
        type sequence slug
        song {
          id
          title { romaji native }
          performances { as artist { ... on Artist { name { main native } } } }
          resources { nodes { site link } }
        }
        animethemeentries { episodes version }
      }
    }
  }
`;

export interface AtGqlResponse {
  data?: {
    findAnimeByExternalSite?: {
      resources: { nodes: { site: string; externalId: number | null }[] };
      animethemes: {
        type: string;
        sequence: number | null;
        slug: string;
        song: {
          id: number;
          title: { romaji: string | null; native: string | null };
          performances: { as: string | null; artist: { name?: { main: string | null; native?: string | null } } | null }[];
          resources: { nodes: { site: string; link: string }[] };
        } | null;
        animethemeentries: { episodes: string | null; version: number }[];
      }[];
    }[] | null;
  };
  errors?: { message: string }[];
}

const KINDS: ThemeKind[] = ['OP', 'ED', 'IN'];

/** Map a findAnimeByExternalSite response onto the requested AniList ids. */
export function mapAnimeThemes(body: AtGqlResponse, requested: number[]): Map<number, Theme[]> {
  const want = new Set(requested);
  const out = new Map<number, Theme[]>();
  for (const a of body.data?.findAnimeByExternalSite ?? []) {
    const ids = a.resources.nodes
      .filter((r) => r.site === 'ANILIST' && r.externalId !== null && want.has(r.externalId))
      .map((r) => r.externalId as number);
    for (const anilistId of ids) {
      const themes = a.animethemes.map<Theme>((t) => {
        const song = t.song;
        const links = Object.fromEntries((song?.resources.nodes ?? []).map((r) => [r.site, r.link]));
        // Group members can appear as separate performances; dedupe names.
        const artists = [...new Set((song?.performances ?? []).map((p) => p.artist?.name?.main).filter((n): n is string => !!n))];
        const artistsNative = [...new Set((song?.performances ?? []).map((p) => p.artist?.name?.native).filter((n): n is string => !!n && !artists.includes(n)))];
        const episodes = t.animethemeentries.map((e) => e.episodes).filter(Boolean).join(', ') || null;
        return {
          slug: t.slug,
          anilistId,
          kind: (KINDS.includes(t.type as ThemeKind) ? t.type : 'IN') as ThemeKind,
          sequence: t.sequence ?? 1,
          songId: song?.id ?? null,
          songTitle: song?.title.romaji ?? null,
          songTitleNative: song?.title.native && song.title.native !== song.title.romaji ? song.title.native : null,
          artists,
          artistsNative,
          episodes,
          appleMusicUrl: links.APPLE_MUSIC ?? null,
          source: 'animethemes',
        };
      });
      out.set(anilistId, [...(out.get(anilistId) ?? []), ...themes]);
    }
  }
  return out;
}

export async function fetchFromAnimeThemes(
  ids: number[],
  { batchSize = ANIMETHEMES_BATCH, fetchImpl = fetch }: { batchSize?: number; fetchImpl?: typeof fetch } = {},
): Promise<Map<number, Theme[]>> {
  const found = new Map<number, Theme[]>();
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const res = await limitedFetch(
      limiters.animethemes,
      ANIMETHEMES_GRAPHQL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: ANIMETHEMES_QUERY, variables: { id: slice } }),
      },
      // A 50-id batch normally answers in 1–3 s.
      { fetchImpl, timeoutMs: 30_000 },
    );
    const body = (await res.json()) as AtGqlResponse;
    if (body.errors?.length) throw new Error(`AnimeThemes: ${body.errors.map((e) => e.message).join('; ')}`);
    for (const [k, v] of mapAnimeThemes(body, slice)) found.set(k, v);
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Jikan fallback                                                      */
/* ------------------------------------------------------------------ */

const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

export interface ParsedJikanTheme {
  sequence: number | null;
  title: string;
  titleNative: string | null;
  artists: string[];
  episodes: string | null;
}

/**
 * Parse MAL theme strings such as:
 *   1: "Gurenge" by LiSA (eps 1-19)
 *   "Kaikai Kitan" by Eve (eps 1-13)
 *   #2: "Ai no Supreme! (愛のシュプリーム!)" by fhána (eps 1-12)
 *   "Fuwa Fuwa Time" by Yui Hirasawa (CV: Aki Toyosaki) (eps 1-13)
 */
export function parseJikanTheme(raw: string): ParsedJikanTheme | null {
  const m = raw.match(/^\s*(?:#?(\d+)\s*:\s*)?["“](.+)["”]\s+by\s+(.+?)\s*$/i);
  if (!m) return null;
  const [, seq, rawTitle = '', rest = ''] = m;

  let artistPart = rest;
  let episodes: string | null = null;
  const ep = artistPart.match(/\s*\((?:eps?|episodes?)\.?\s*([^)]*)\)\s*$/i);
  if (ep) {
    episodes = ep[1]?.trim() || null;
    artistPart = artistPart.slice(0, ep.index).trim();
  }

  let title = rawTitle.trim();
  let titleNative: string | null = null;
  const native = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (native && JAPANESE.test(native[2] ?? '') && native[1]) {
    title = native[1].trim();
    titleNative = (native[2] ?? '').trim();
  } else if (JAPANESE.test(title)) {
    titleNative = title;
  }

  // Split collaborators, but keep "(CV: ...)" attached to its artist.
  const artists = artistPart
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|×)\s*(?![^()]*\))/i)
    .map((a) => a.trim())
    .filter(Boolean);

  return { sequence: seq ? Number(seq) : null, title, titleNative, artists, episodes };
}

export function jikanToThemes(anilistId: number, data: { openings?: string[]; endings?: string[] }): Theme[] {
  const out: Theme[] = [];
  const add = (kind: 'OP' | 'ED', list: string[] = []) =>
    list.forEach((raw, i) => {
      const p = parseJikanTheme(raw);
      if (!p) return;
      const sequence = p.sequence ?? i + 1;
      out.push({
        slug: `${kind}${sequence}`,
        anilistId,
        kind,
        sequence,
        songId: null,
        songTitle: p.title,
        songTitleNative: p.titleNative,
        artists: p.artists,
        artistsNative: [],
        episodes: p.episodes,
        appleMusicUrl: null,
        source: 'jikan',
      });
    });
  add('OP', data.openings);
  add('ED', data.endings);
  return out;
}

export async function fetchFromJikan(anilistId: number, idMal: number, fetchImpl: typeof fetch = fetch): Promise<Theme[]> {
  try {
    // Jikan is a best-effort fallback: answer quickly or not at all. (On
    // 2026-11-12 it accepted connections and reset them after ~10 s.)
    const res = await limitedFetch(limiters.jikan, `https://api.jikan.moe/v4/anime/${idMal}/themes`, undefined, { fetchImpl, timeoutMs: 8_000, retries: 1 });
    const body = (await res.json()) as { data?: { openings?: string[]; endings?: string[] } };
    return jikanToThemes(anilistId, body.data ?? {});
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return [];
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Resolution with caching                                             */
/* ------------------------------------------------------------------ */

export interface ThemeCache {
  get(anilistId: number): Promise<ThemeLookup | undefined>;
  put(lookup: ThemeLookup): Promise<void>;
}

const DAY = 86_400_000;
/** Negative results and still-airing shows are re-checked after this. */
export const RECHECK_AFTER = 7 * DAY;
/** A negative result that a source couldn't confirm is re-checked after this. */
export const RECHECK_INCOMPLETE = DAY;

/** Can this cached lookup be reused? */
export function isFresh(lookup: ThemeLookup, show: Show, now: number): boolean {
  const age = now - lookup.fetchedAt;
  if (lookup.status === 'none') return age < (lookup.incomplete ? RECHECK_INCOMPLETE : RECHECK_AFTER);
  // Airing shows gain new OP/EDs mid-season; finished shows are stable.
  if (show.airingStatus && show.airingStatus !== 'FINISHED') return age < RECHECK_AFTER;
  return true;
}

export interface ResolveProgress {
  done: number;
  total: number;
  phase: 'cache' | 'animethemes' | 'jikan' | 'done';
}

export interface ResolveDeps {
  cache: ThemeCache;
  animeThemes?: (ids: number[]) => Promise<Map<number, Theme[]>>;
  jikan?: (anilistId: number, idMal: number) => Promise<Theme[]>;
  now?: () => number;
  onProgress?: (p: ResolveProgress) => void;
  /** Force refetch, ignoring the cache. */
  refresh?: boolean;
}

/**
 * Resolve themes for each show: cache → AnimeThemes → Jikan (by MAL id).
 *
 * - An AnimeThemes failure is an error: those shows are returned in `errors`
 *   and NOT cached, so they're retried next time.
 * - Jikan is a fallback. If it fails, the show is cached as 'none' with
 *   `incomplete` set (rechecked after RECHECK_INCOMPLETE), and Jikan isn't
 *   asked again for the rest of the run: one dead host costs one timeout,
 *   not one per show.
 * - Formats that don't have OP/EDs of their own (music videos) skip Jikan.
 */
export async function resolveThemes(
  shows: Show[],
  { cache, animeThemes = (ids) => fetchFromAnimeThemes(ids), jikan = fetchFromJikan, now = Date.now, onProgress, refresh = false }: ResolveDeps,
): Promise<{ lookups: Map<number, ThemeLookup>; errors: Map<number, string> }> {
  const lookups = new Map<number, ThemeLookup>();
  const errors = new Map<number, string>();
  const total = shows.length;
  const report = (phase: ResolveProgress['phase']) => onProgress?.({ done: lookups.size + errors.size, total, phase });

  const todo: Show[] = [];
  for (const s of shows) {
    const hit = refresh ? undefined : await cache.get(s.anilistId);
    if (hit && isFresh(hit, s, now())) lookups.set(s.anilistId, hit);
    else todo.push(s);
  }
  report('cache');
  if (!todo.length) { report('done'); return { lookups, errors }; }

  let fromAt = new Map<number, Theme[]>();
  try {
    fromAt = await animeThemes(todo.map((s) => s.anilistId));
  } catch (err) {
    for (const s of todo) errors.set(s.anilistId, `AnimeThemes: ${(err as Error).message}`);
    report('done');
    return { lookups, errors };
  }

  const store = async (lookup: ThemeLookup) => {
    lookups.set(lookup.anilistId, lookup);
    await cache.put(lookup);
  };

  for (const s of todo) {
    const themes = fromAt.get(s.anilistId);
    if (themes?.length) await store({ anilistId: s.anilistId, status: 'found', themes, source: 'animethemes', fetchedAt: now() });
  }
  report('animethemes');

  let jikanDown: string | null = null;
  for (const s of todo.filter((x) => !lookups.has(x.anilistId))) {
    let incomplete: string | undefined;
    if (s.idMal && !skipsJikan(s.format)) {
      if (jikanDown) {
        incomplete = jikanDown;
      } else {
        try {
          const themes = await jikan(s.anilistId, s.idMal);
          if (themes.length) {
            await store({ anilistId: s.anilistId, status: 'found', themes, source: 'jikan', fetchedAt: now() });
            report('jikan');
            continue;
          }
        } catch (err) {
          jikanDown = `Jikan: ${(err as Error).message}`;
          incomplete = jikanDown;
        }
      }
    }
    await store({ anilistId: s.anilistId, status: 'none', themes: [], source: null, fetchedAt: now(), ...(incomplete ? { incomplete } : {}) });
    report('jikan');
  }
  report('done');
  return { lookups, errors };
}

/** Display order within a show: OPs, then EDs, then inserts, by sequence. */
export function sortThemes(themes: Theme[]): Theme[] {
  const rank = { OP: 0, ED: 1, IN: 2 } as const;
  return [...themes].sort((a, b) => rank[a.kind] - rank[b.kind] || a.sequence - b.sequence || a.slug.localeCompare(b.slug));
}
