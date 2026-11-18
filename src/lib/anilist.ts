import type { FuzzyDate, ListStatus, Show } from '../types';
import { HttpError, limitedFetch, limiters } from './rateLimit';

const ENDPOINT = 'https://graphql.anilist.co';

const LIST_QUERY = /* GraphQL */ `
  query ($name: String, $chunk: Int, $perChunk: Int) {
    MediaListCollection(userName: $name, type: ANIME, chunk: $chunk, perChunk: $perChunk) {
      hasNextChunk
      lists {
        entries {
          status score progress repeat updatedAt createdAt
          completedAt { year month day }
          startedAt { year month day }
          media {
            id idMal format season seasonYear status
            title { romaji english native }
            coverImage { medium }
          }
        }
      }
    }
  }
`;

const VIEWER_QUERY = /* GraphQL */ `query { Viewer { name } }`;

export class AniListError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
    this.name = 'AniListError';
  }
}

interface RawEntry {
  status: ListStatus;
  score: number | null;
  progress: number | null;
  repeat: number | null;
  updatedAt: number | null;
  createdAt: number | null;
  completedAt: FuzzyDate | null;
  startedAt: FuzzyDate | null;
  media: {
    id: number;
    idMal: number | null;
    format: string | null;
    season: string | null;
    seasonYear: number | null;
    status: string | null;
    title: { romaji: string | null; english: string | null; native: string | null };
    coverImage: { medium: string | null } | null;
  };
}

export interface RawCollection {
  hasNextChunk: boolean;
  lists: { entries: RawEntry[] }[];
}

const EMPTY_DATE: FuzzyDate = { year: null, month: null, day: null };

export function normalizeEntry(e: RawEntry): Show {
  return {
    anilistId: e.media.id,
    idMal: e.media.idMal,
    title: e.media.title,
    format: e.media.format,
    season: e.media.season,
    seasonYear: e.media.seasonYear,
    airingStatus: e.media.status,
    coverImage: e.media.coverImage?.medium ?? null,
    status: e.status,
    score: e.score ?? 0,
    progress: e.progress ?? 0,
    repeat: e.repeat ?? 0,
    completedAt: e.completedAt ?? EMPTY_DATE,
    startedAt: e.startedAt ?? EMPTY_DATE,
    updatedAt: e.updatedAt ?? 0,
    createdAt: e.createdAt ?? 0,
  };
}

/** Flatten all lists, dropping duplicates (custom lists repeat entries). */
export function flattenCollections(chunks: RawCollection[]): Show[] {
  const byId = new Map<number, Show>();
  for (const c of chunks) for (const l of c.lists) for (const e of l.entries) {
    if (!byId.has(e.media.id)) byId.set(e.media.id, normalizeEntry(e));
  }
  return [...byId.values()];
}

async function gql<T>(query: string, variables: Record<string, unknown>, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await limitedFetch(limiters.anilist, ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      // AniList returns GraphQL errors with 4xx statuses; surface the message.
      throw new AniListError(err.status === 401 ? 'AniList token expired or invalid. Log in again.' : err.message, err.status);
    }
    throw err;
  }
  const body = (await res.json()) as { data?: T; errors?: { message: string; status?: number }[] };
  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).join('; ');
    const status = body.errors[0]?.status ?? null;
    throw new AniListError(/private/i.test(msg) ? `${msg}. This list is private: log in with AniList to read it.` : msg, status);
  }
  if (!body.data) throw new AniListError('Empty response from AniList', null);
  return body.data;
}

export async function fetchViewerName(token: string): Promise<string> {
  const data = await gql<{ Viewer: { name: string } }>(VIEWER_QUERY, {}, token);
  return data.Viewer.name;
}

/** Fetch every anime list entry for a user, following AniList's chunking. */
export async function fetchAnimeList(userName: string, token?: string | null): Promise<Show[]> {
  const chunks: RawCollection[] = [];
  for (let chunk = 1; chunk <= 50; chunk++) {
    const data = await gql<{ MediaListCollection: RawCollection }>(LIST_QUERY, { name: userName, chunk, perChunk: 500 }, token);
    chunks.push(data.MediaListCollection);
    if (!data.MediaListCollection.hasNextChunk) break;
  }
  return flattenCollections(chunks);
}

/** Implicit-grant login URL. The client's redirect URL must be this app's origin. */
export function authorizeUrl(clientId: string): string {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;
}

/** Read and strip `#access_token=...` after the implicit-grant redirect. */
export function consumeTokenFromHash(loc: Location = window.location): string | null {
  if (!loc.hash.includes('access_token=')) return null;
  const token = new URLSearchParams(loc.hash.slice(1)).get('access_token');
  history.replaceState(null, '', loc.pathname + loc.search);
  return token;
}

export function displayTitle(s: Pick<Show, 'title'>): string {
  return s.title.english || s.title.romaji || s.title.native || '(untitled)';
}
