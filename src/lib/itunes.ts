import { createLimiter, HttpError } from './rateLimit';

/**
 * iTunes Search / Lookup: keyless, CORS `*` (verified 2026-11-11).
 * - trackId is the Apple Music catalog song id, and it is the SAME across
 *   storefronts; only names are localized (JP returns native script, US may
 *   return romaji or an English translation).
 * - Lookup accepts comma-separated ids, and with entity=song an album id
 *   expands to its tracks. Both batch.
 * - Throttling is undocumented (~20/min is the folklore); be conservative.
 * - Never send `media=music` to /search: iOS gets a redirect pages can't follow.
 */
export interface ItunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  collectionId: number;
  trackTimeMillis: number | null;
  previewUrl: string | null;
  trackViewUrl: string;
  artworkUrl100: string | null;
  isStreamable: boolean | null;
  country: string;
  trackNumber: number | null;
  trackCount: number | null;
  releaseDate: string | null;
}

export const itunesLimiter = createLimiter({ perMinute: 20 });

interface RawResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionId?: number;
  trackTimeMillis?: number;
  previewUrl?: string;
  trackViewUrl?: string;
  artworkUrl100?: string;
  isStreamable?: boolean;
  trackNumber?: number;
  trackCount?: number;
  releaseDate?: string;
}

export function toTrack(r: RawResult, country: string): ItunesTrack | null {
  if (r.wrapperType !== 'track' || r.kind !== 'song' || !r.trackId || !r.trackName) return null;
  return {
    trackId: r.trackId,
    trackName: r.trackName,
    artistName: r.artistName ?? '',
    collectionName: r.collectionName ?? '',
    collectionId: r.collectionId ?? 0,
    trackTimeMillis: r.trackTimeMillis ?? null,
    previewUrl: r.previewUrl ?? null,
    trackViewUrl: r.trackViewUrl ?? `https://music.apple.com/${country}/song/${r.trackId}`,
    artworkUrl100: r.artworkUrl100 ?? null,
    isStreamable: r.isStreamable ?? null,
    country,
    trackNumber: r.trackNumber ?? null,
    trackCount: r.trackCount ?? null,
    releaseDate: r.releaseDate ?? null,
  };
}

function jsonp(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cb = `__itunes_${Math.random().toString(36).slice(2)}`;
    const s = document.createElement('script');
    const w = window as unknown as Record<string, unknown>;
    const timer = setTimeout(() => { cleanup(); reject(new Error('iTunes JSONP timeout')); }, 15_000);
    function cleanup() { delete w[cb]; s.remove(); clearTimeout(timer); }
    w[cb] = (data: unknown) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('iTunes JSONP failed (blocked or throttled)')); };
    s.src = `${url}&callback=${cb}`;
    document.head.appendChild(s);
  });
}

export interface ItunesDeps {
  fetchImpl?: typeof fetch;
  /** Skip the limiter (tests). */
  unlimited?: boolean;
}

async function get(path: 'search' | 'lookup', params: Record<string, string>, deps: ItunesDeps = {}): Promise<RawResult[]> {
  const url = `https://itunes.apple.com/${path}?${new URLSearchParams(params)}`;
  const run = async (): Promise<RawResult[]> => {
    let body: { results?: RawResult[] };
    try {
      // A hung connection would stall the whole matcher queue; give up after 20 s.
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(20_000) : undefined;
      const res = await (deps.fetchImpl ?? fetch)(url, signal ? { signal } : undefined);
      if (!res.ok) throw new HttpError(res.status, `iTunes HTTP ${res.status}`);
      body = (await res.json()) as { results?: RawResult[] };
    } catch (err) {
      // A CORS/network TypeError → try JSONP once (browser only).
      if (err instanceof HttpError || typeof document === 'undefined') throw err;
      body = (await jsonp(url)) as { results?: RawResult[] };
    }
    return body.results ?? [];
  };
  return deps.unlimited ? run() : itunesLimiter.schedule(run);
}

export async function searchSongs(term: string, country: string, limit = 15, deps?: ItunesDeps): Promise<ItunesTrack[]> {
  // No `media=music`: on iPhone, Apple answers searches carrying it with a
  // redirect (to the Music app) that a web page can't follow ("Load failed").
  // `entity=song` alone returns the same results (verified 2026-11-12).
  const results = await get('search', { term, country, entity: 'song', limit: String(limit) }, deps);
  return results.map((r) => toTrack(r, country)).filter((t): t is ItunesTrack => !!t);
}

/** Look up song ids and/or album ids (albums expand to their tracks). */
export async function lookup(ids: number[], country: string, deps?: ItunesDeps): Promise<ItunesTrack[]> {
  if (!ids.length) return [];
  const out: ItunesTrack[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const results = await get('lookup', { id: ids.slice(i, i + 100).join(','), entity: 'song', country, limit: '200' }, deps);
    for (const r of results) { const t = toTrack(r, country); if (t) out.push(t); }
  }
  return out;
}

export type AppleMusicRef = { kind: 'song'; id: number } | { kind: 'album'; id: number };

/**
 * Parse Apple Music / iTunes links:
 *   music.apple.com/jp/song/1830210171            → song
 *   music.apple.com/us/song/finis-teller/1830210171 → song
 *   music.apple.com/us/album/gurenge/1529543131?i=1529543135 → song (the ?i=)
 *   music.apple.com/jp/album/1787113451           → album
 *   itunes.apple.com/us/album/...?i=...            → same rules
 * A bare number is treated as a song id.
 */
export function parseAppleMusicUrl(input: string): AppleMusicRef | null {
  const s = input.trim();
  if (/^\d{6,}$/.test(s)) return { kind: 'song', id: Number(s) };
  let url: URL;
  try { url = new URL(s); } catch { return null; }
  if (!/(^|\.)(music|itunes)\.apple\.com$/.test(url.hostname)) return null;
  const i = url.searchParams.get('i');
  if (i && /^\d+$/.test(i)) return { kind: 'song', id: Number(i) };
  const parts = url.pathname.split('/').filter(Boolean);
  const kindIdx = parts.findIndex((p) => p === 'song' || p === 'album');
  if (kindIdx < 0) return null;
  const id = [...parts.slice(kindIdx + 1)].reverse().map((p) => p.replace(/^id/, '')).find((p) => /^\d+$/.test(p));
  if (!id) return null;
  return { kind: parts[kindIdx] as 'song' | 'album', id: Number(id) };
}

export function songUrl(trackId: number, country: string): string {
  return `https://music.apple.com/${country}/song/${trackId}`;
}
