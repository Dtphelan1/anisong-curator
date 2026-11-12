import type { ThemeLookup } from '../types';
import { displayTitle } from '../lib/anilist';
import type { OrderedShow } from '../lib/ordering';
import { sortThemes, type ResolveProgress } from '../lib/themes';
import { formatLabel, songsOptional } from '../lib/mediaFormat';

interface Props {
  candidates: OrderedShow[];
  lookups: Map<number, ThemeLookup>;
  errors: Map<number, string>;
  progress: ResolveProgress | null;
  includeInserts: boolean;
  onIncludeInserts: (v: boolean) => void;
  onBack: () => void;
  onRetry: () => void;
  onReview: () => void;
  reviewCount: number;
}

export function ThemeList({ candidates, lookups, errors, progress, includeInserts, onIncludeInserts, onBack, onRetry, onReview, reviewCount }: Props) {
  const running = progress !== null && progress.phase !== 'done';
  const visible = (l?: ThemeLookup) => sortThemes(l?.themes ?? []).filter((t) => includeInserts || t.kind !== 'IN');
  const songCount = candidates.reduce((n, c) => n + visible(lookups.get(c.show.anilistId)).length, 0);
  const covered = candidates.filter((c) => visible(lookups.get(c.show.anilistId)).length).length;
  const unchecked = candidates.map((c) => lookups.get(c.show.anilistId)).filter((l) => l?.status === 'none' && l.incomplete);

  return (
    <section className="card">
      <h2>3 · Songs</h2>
      <div className="row">
        <button className="secondary" onClick={onBack}>← Pick shows</button>
        <label><input type="checkbox" checked={includeInserts} onChange={(e) => onIncludeInserts(e.target.checked)} /> Insert songs</label>
        <button className="secondary" onClick={onRetry} disabled={running}>Re-fetch</button>
        {running
          ? <span className="muted">Looking up songs… {progress.done}/{progress.total} ({progress.phase})</span>
          : <span><strong>{songCount}</strong> songs from <strong>{covered}</strong>/{candidates.length} shows</span>}
        <span className="spacer" />
        <button onClick={onReview} disabled={running || !reviewCount}>Match &amp; review {reviewCount} songs →</button>
      </div>
      {errors.size > 0 && (
        <p className="bad">
          {errors.size} {errors.size === 1 ? 'show' : 'shows'} couldn't be looked up ({[...new Set(errors.values())][0]}).
          {' '}They'll be retried next time, or now with Re-fetch.
        </p>
      )}
      {!running && unchecked.length > 0 && (
        <p className="muted" title={unchecked[0]?.incomplete}>
          {unchecked.length} {unchecked.length === 1 ? 'show' : 'shows'} without songs on AnimeThemes couldn't be checked on MyAnimeList
          {' '}(it isn't answering). They'll be rechecked tomorrow, or now with Re-fetch.
        </p>
      )}
      <p className="muted">Songs shared by several shows are reviewed once.</p>

      {candidates.map(({ show }) => {
        const l = lookups.get(show.anilistId);
        const themes = visible(l);
        const err = errors.get(show.anilistId);
        return (
          <div key={show.anilistId} className="show-block">
            <div className="show-head">
              <strong>{displayTitle(show)}</strong>
              {show.format && show.format !== 'TV' && <span className="muted"> · {formatLabel(show.format)}</span>}
              {l?.source === 'jikan' && <span className="badge warn" title="From MyAnimeList text; less reliable">MAL</span>}
              {!l && !err && running && <span className="muted"> …</span>}
              {l?.status === 'none' && <NoSongs format={show.format} incomplete={l.incomplete} />}
              {err && <span className="badge bad" title={err}>lookup failed</span>}
            </div>
            {themes.length > 0 && (
              <table className="themes">
                <tbody>
                  {themes.map((t) => (
                    <tr key={t.slug}>
                      <td className="nowrap muted">{t.slug}</td>
                      <td>
                        {t.songTitle ?? <em className="muted">unknown title</em>}
                        {t.songTitleNative && <span className="muted"> · {t.songTitleNative}</span>}
                      </td>
                      <td>{t.artists.join(', ')}</td>
                      <td className="muted nowrap">{t.episodes && `eps ${t.episodes}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Why a show has no songs, worded by format: expected for a movie, notable for a series. */
function NoSongs({ format, incomplete }: { format: string | null; incomplete?: string }) {
  const optional = songsOptional(format);
  const text = optional ? 'no opening/ending listed' : 'no songs found';
  const title = [
    optional ? `${formatLabel(format)}s often have no opening or ending, or one theme song that isn't listed as one.` : 'Neither AnimeThemes nor MyAnimeList lists an opening or ending.',
    incomplete && `Only AnimeThemes was checked: ${incomplete}.`,
  ].filter(Boolean).join(' ');
  return <span className={optional ? 'badge' : 'badge warn'} title={title}>{text}{incomplete && ' · MAL unchecked'}</span>;
}
