/**
 * AniList media formats, and what they mean for finding OP/ED songs.
 *
 * TV series nearly always have an opening and an ending, so "no songs found"
 * for one is worth a look. Movies, specials, OVAs and shorts often have none,
 * or a single theme song that the databases don't list as an OP/ED, so for
 * those it's expected rather than a problem. Music videos are the song.
 */
const LABELS: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music video',
};

export function formatLabel(format: string | null): string | null {
  if (!format) return null;
  return LABELS[format] ?? format.replace(/_/g, ' ');
}

/** Formats where a missing OP/ED is unremarkable. */
export function songsOptional(format: string | null): boolean {
  return !!format && !['TV', 'ONA'].includes(format);
}

/** Formats not worth asking the Jikan fallback about. */
export function skipsJikan(format: string | null): boolean {
  return format === 'MUSIC';
}
