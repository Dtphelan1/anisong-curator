import type { Show, ThemeLookup } from '../../types';
import type { ResolveProgress } from '../../lib/themes';
import { describeNone, summarizeLookup } from '../../lib/pickerRows';

export interface LookupState {
  running: boolean;
  progress: ResolveProgress | null;
  lookups: Map<number, ThemeLookup>;
  errors: Map<number, string>;
}

interface Props {
  candidates: Show[];
  cachedSongCounts: Map<number, number | 'none'>;
  handChanges: number;
  onResetEdits: () => void;
  includeInserts: boolean;
  lookup: LookupState | null;
  onFindSongs: () => void;
  onCancelLookup: () => void;
  onRetryLookup: () => void;
  onReviewAnyway: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The anime page's sticky footer. Selecting: the count, a song estimate from
 * the cache, and Find songs. Looking up: a progress bar in its place; Review
 * opens by itself when it's done. Shows without songs never block; only an
 * AnimeThemes failure stops it, with Retry and "Review the rest".
 */
export function LookupFooter(p: Props) {
  if (p.lookup) return <Progress {...p} lookup={p.lookup} />;

  let songs = 0;
  let unknown = 0;
  for (const s of p.candidates) {
    const c = p.cachedSongCounts.get(s.anilistId);
    if (c === undefined) unknown++;
    else if (c !== 'none') songs += c;
  }
  return (
    <footer className="ap-foot">
      <span className="ap-foot-count">
        <b>{plural(p.candidates.length, 'show')}</b> selected
        {p.candidates.length > 0 && <span className="muted"> · ~{plural(songs, 'song')}{unknown > 0 && `, + ${plural(unknown, 'show')} not looked up yet`}</span>}
      </span>
      {p.handChanges > 0 && (
        <span className="muted">{plural(p.handChanges, 'hand change')} · <button className="link" onClick={p.onResetEdits}>reset</button></span>
      )}
      <span className="spacer" />
      <span className="ap-legend muted"><kbd>J</kbd>/<kbd>K</kbd> move · <kbd>Space</kbd> toggle · <kbd>/</kbd> filter · <kbd>↵</kbd> find songs</span>
      <button className="btn-accent ap-find" onClick={p.onFindSongs} disabled={!p.candidates.length}>Find songs →</button>
    </footer>
  );
}

function Progress(p: Props & { lookup: LookupState }) {
  const { lookup } = p;
  const total = lookup.progress?.total ?? p.candidates.length;
  const done = lookup.progress?.done ?? 0;
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  const sum = summarizeLookup(p.candidates, lookup.lookups, lookup.errors, p.includeInserts);
  const none = describeNone(sum.none);
  const firstError = [...new Set(lookup.errors.values())][0];
  const notes = [
    none,
    sum.unchecked > 0 && `${plural(sum.unchecked, 'show')} not checked on MyAnimeList (it isn't answering; rechecked tomorrow)`,
  ].filter(Boolean).join(' · ');

  return (
    <footer className="ap-foot ap-foot-lookup" aria-live="polite">
      <div className="ap-foot-main">
        {lookup.running ? (
          <>
            <span className="ap-foot-count"><b>Looking up songs</b> · {done} of {plural(total, 'show')} · {plural(sum.songs, 'song')} so far</span>
            <div className="ap-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${pct}%` }} /></div>
            <button className="btn-line" onClick={p.onCancelLookup}>Cancel</button>
          </>
        ) : sum.errors > 0 ? (
          <>
            <span className="ap-foot-count bad">
              {plural(sum.errors, 'show')} couldn't be looked up{firstError && ` (${firstError})`}.
            </span>
            <span className="spacer" />
            <button className="btn-line" onClick={p.onCancelLookup}>Back to selecting</button>
            <button className="btn-line" onClick={p.onRetryLookup}>Retry</button>
            <button className="btn-accent" onClick={p.onReviewAnyway} disabled={!sum.songs}>Review the rest ({plural(sum.songs, 'song')}) →</button>
          </>
        ) : (
          <>
            <span className="ap-foot-count"><b>{plural(sum.songs, 'song')}</b> from {plural(sum.withSongs, 'show')} · opening the review…</span>
            <span className="spacer" />
            <button className="btn-line" onClick={p.onCancelLookup}>Back to selecting</button>
            <button className="btn-accent" onClick={p.onReviewAnyway} disabled={!sum.songs}>Review →</button>
          </>
        )}
      </div>
      {notes && <p className="ap-foot-note muted">{notes}</p>}
    </footer>
  );
}
