import type { Show } from '../../types';
import { formatLabel } from '../../lib/mediaFormat';
import { noSongsKind } from '../../lib/pickerRows';

/**
 * Why a show has no songs, worded by format and airing state: expected for a
 * movie or a show still airing (the databases lag by weeks), notable for a
 * finished series. Never a blocker.
 */
export function NoSongs({ show, incomplete }: { show: Show; incomplete?: string }) {
  const kind = noSongsKind(show);
  const text = kind === 'airing' ? 'airing · songs not listed yet' : kind === 'optional' ? 'no opening/ending listed' : 'no songs found';
  const title = [
    kind === 'airing'
      ? 'Song databases usually catch up a few weeks into a season. Rechecked weekly.'
      : kind === 'optional'
        ? `${formatLabel(show.format)}s often have no opening or ending, or one theme song that isn't listed as one.`
        : 'Neither AnimeThemes nor MyAnimeList lists an opening or ending.',
    incomplete && `Only AnimeThemes was checked: ${incomplete}.`,
  ].filter(Boolean).join(' ');
  return (
    <span className={`ap-nosongs ${kind === 'series' ? 'warn' : ''}`} title={title}>
      {text}{incomplete && ' · MAL unchecked'}
    </span>
  );
}
