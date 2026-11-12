import type { Theme } from '../types';
import type { DupHit } from './dedupe';
import type { ItunesTrack } from './itunes';
import type { Flag } from './matcher';
import { normalize } from './matcher';
import type { Candidate } from './matching';

/**
 * Reason chips: why a match looks right or wrong, in a few words each. Pure,
 * so the card can stay a thin view (the review screen's comparison row).
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'have' | 'neutral';
export interface Reason {
  label: string;
  tone: Tone;
  /** Longer explanation, for a tooltip. */
  title?: string;
}

/** Below this the matched title reads as another title, not a spelling variant. */
export const TITLE_DIFFERS = 0.8;
/** Below this the artist is someone else (as in the matcher and the duplicate check). */
export const ARTIST_DIFFERS = 0.6;
export const ARTIST_MATCHES = 0.8;

const FLAG_REASON: Partial<Record<Flag, Reason>> = {
  cover: { label: 'cover?', tone: 'bad', title: 'Looks like a cover: named "(From …)" or "cover", or on a piano/music-box album' },
  karaoke: { label: 'karaoke', tone: 'bad' },
  instrumental: { label: 'instrumental', tone: 'bad' },
  live: { label: 'live', tone: 'warn' },
  remix: { label: 'remix', tone: 'warn' },
  acoustic: { label: 'acoustic', tone: 'warn' },
  firstTake: { label: 'THE FIRST TAKE', tone: 'warn' },
  soundtrack: { label: 'soundtrack album', tone: 'warn', title: 'On a score album: may be a same-named composer track, not the vocal theme' },
  altVersion: { label: 'alt version', tone: 'neutral' },
};

/** Version flags that are another cut of the song: with one of these, "full version" would be wrong. */
const CUTS: Flag[] = ['tv', 'live', 'remix', 'acoustic', 'firstTake', 'instrumental', 'karaoke'];

export interface MatchReasonOptions {
  userPicked?: boolean;
  /** Linked on AnimeThemes (no search needed). */
  linked?: boolean;
  preferTvSize?: boolean;
}

/** Reasons for the chosen Apple Music candidate against the theme. */
export function matchReasons(
  theme: Pick<Theme, 'artists' | 'artistsNative' | 'songTitle'>,
  c: Pick<Candidate, 'flags' | 'titleSim' | 'artistSim'> & { track: Pick<ItunesTrack, 'isStreamable'> },
  { userPicked = false, linked = false, preferTvSize = false }: MatchReasonOptions = {},
): Reason[] {
  const out: Reason[] = [];
  if (userPicked) out.push({ label: 'your pick', tone: 'ok' });
  if (linked) out.push({ label: 'linked on AnimeThemes', tone: 'ok', title: 'AnimeThemes links this exact Apple Music track' });

  const hasArtist = theme.artists.length + theme.artistsNative.length > 0;
  const cover = c.flags.includes('cover');
  if (!hasArtist) out.push({ label: 'no artist on AnimeThemes', tone: 'neutral' });
  else if (c.artistSim >= ARTIST_MATCHES) out.push({ label: 'artist matches', tone: 'ok' });
  else if (c.artistSim < ARTIST_DIFFERS && !cover) {
    out.push({ label: 'different artist', tone: 'warn', title: 'Artist differs from AnimeThemes: a cover, or a localized or alias name' });
  } else if (c.artistSim >= ARTIST_DIFFERS) out.push({ label: 'artist similar', tone: 'neutral', title: 'Spelled differently (romaji, alias or a group member)' });

  if (theme.songTitle && c.titleSim < TITLE_DIFFERS) {
    out.push(c.titleSim < 0.5
      ? { label: 'title differs', tone: 'warn', title: 'Another title: a translation in this store, or another song' }
      : { label: 'title differs slightly', tone: 'warn', title: 'A spelling variant, or a translated word' });
  }

  for (const f of c.flags) { const r = FLAG_REASON[f]; if (r) out.push(r); }
  if (c.flags.includes('tv')) out.push({ label: 'TV size', tone: preferTvSize ? 'ok' : 'neutral' });
  else if (!c.flags.some((f) => CUTS.includes(f))) {
    out.push(preferTvSize ? { label: 'full version, not TV size', tone: 'warn' } : { label: 'full version', tone: 'neutral' });
  }
  if (c.track.isStreamable === false) out.push({ label: 'not streamable', tone: 'bad', title: "Listed, but can't be added to a playlist in this store" });
  return out;
}

/** Album names without the " - Single" / " - EP" release-type suffix. */
const albumCore = (s: string) => normalize(s.replace(/\s+-\s+(?:single|ep)$/i, ''));

/** Reasons for an "already have" hit: how the playlist row (or add-log entry) compares with the match. */
export function haveReasons(hit: DupHit, track?: Pick<ItunesTrack, 'collectionName' | 'trackTimeMillis'>): Reason[] {
  if (hit.sameTrack) return [{ label: 'same Apple Music track, added by the app', tone: 'have' }];
  const out: Reason[] = [];
  if (hit.source === 'added') out.push({ label: 'added by the app earlier', tone: 'have' });
  const sameTitle = hit.titleSim >= 0.9;
  const sameArtist = hit.artistSim !== null && hit.artistSim >= ARTIST_MATCHES;
  if (sameTitle && sameArtist) out.push({ label: 'same title and artist', tone: 'have' });
  else {
    out.push(sameTitle ? { label: 'same title', tone: 'have' } : { label: `similar title · ${Math.round(hit.titleSim * 100)}%`, tone: 'warn' });
    if (hit.artistSim === null) out.push({ label: 'artist unknown', tone: 'neutral', title: 'The playlist copy has no artist to compare' });
    else out.push(sameArtist ? { label: 'same artist', tone: 'have' } : { label: 'similar artist', tone: 'warn' });
  }
  if (hit.tier === 'other-version') out.push({ label: 'another version', tone: 'warn', title: 'Another cut of the song: TV size vs full, live, remix, or 20 s or more apart' });

  const album = hit.row.album?.trim();
  if (album && track?.collectionName) {
    out.push(albumCore(album) === albumCore(track.collectionName) ? { label: 'same album', tone: 'neutral' } : { label: 'different album', tone: 'neutral' });
  }
  if (hit.row.durationMs !== null && track?.trackTimeMillis) {
    const d = Math.round((track.trackTimeMillis - hit.row.durationMs) / 1000);
    out.push(Math.abs(d) <= 1
      ? { label: 'same length', tone: 'neutral' }
      : { label: `match ${Math.abs(d)} s ${d > 0 ? 'longer' : 'shorter'}`, tone: Math.abs(d) >= 20 ? 'warn' : 'neutral', title: 'The Apple Music match compared with the copy in your playlist' });
  }
  return out;
}
