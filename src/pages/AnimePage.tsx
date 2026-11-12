import type { Show } from '../types';
import type { OrderedShow, OrderOptions } from '../lib/ordering';
import { handEdits, resetEdits, type Selection } from '../lib/selection';
import { QuickStart } from '../components/anime/QuickStart';
import { ShowList } from '../components/anime/ShowList';
import { LookupFooter, type LookupState } from '../components/anime/LookupFooter';
import '../components/anime/anime.css';

export interface AnimePageProps {
  shows: Show[];
  ordered: OrderedShow[];
  order: OrderOptions;
  onOrder: (o: OrderOptions) => void;
  boundId: number | null;
  selection: Selection;
  onSelect: (patch: { selection: Selection; boundId?: number | null }) => void;
  /** selectedShows(...), computed by App. */
  candidates: OrderedShow[];
  /** Which extra list statuses are listed (set in Settings). */
  listStatuses: { dropped: boolean; paused: boolean };
  /** "Your playlist now ends with…", from the playlist library. */
  suggestion: { anilistId: number; evidence: string } | null;
  coverage: Map<number, { inPlaylist: number; total: number | null }>;
  /** From cached theme lookups (see `cachedSongCounts` in lib/songCounts). */
  cachedSongCounts: Map<number, number | 'none'>;
  /** Default date for "Finished since". */
  lastSessionAt: number | null;
  /** "3 finished since your last visit". */
  newSinceVisit: number;
  lookup: LookupState | null;
  includeInserts: boolean;
  onFindSongs: () => void;
  onCancelLookup: () => void;
  onRetryLookup: () => void;
  onReviewAnyway: () => void;
}

/**
 * "Which anime would you like to add?" Quick starts on the left, the list on
 * the right, and a sticky footer that becomes the songs lookup's progress
 * bar. Renders under the app's shared header.
 */
export function AnimePage(p: AnimePageProps) {
  const locked = p.lookup !== null;
  const extra = [p.listStatuses.dropped && 'dropped', p.listStatuses.paused && 'paused'].filter(Boolean);
  return (
    <div className="ap">
      <aside className="ap-side">
        <h1 className="ap-h1">Which anime would you like to add?</h1>
        <p className="ap-sub">
          {p.shows.filter((s) => s.status !== 'PLANNING').length} shows on AniList
          {p.newSinceVisit > 0 && <span className="ok"> · {p.newSinceVisit} finished since your last visit</span>}
        </p>
        <h2 className="ap-label">Start from</h2>
        <QuickStart ordered={p.ordered} boundId={p.boundId} selection={p.selection} onSelect={p.onSelect}
          suggestion={p.suggestion} lastSessionAt={p.lastSessionAt} locked={locked} />
        <p className="ap-side-note muted">
          Shows you're watching or rewatching are always included.
          {extra.length > 0 && <> {cap(extra.join(' and '))} shows are listed but never pre-selected.</>}
        </p>
      </aside>

      <main className="ap-main">
        <ShowList ordered={p.ordered} order={p.order} onOrder={p.onOrder} boundId={p.boundId} selection={p.selection}
          onSelect={p.onSelect} suggestedId={p.suggestion?.anilistId ?? null} coverage={p.coverage}
          cachedSongCounts={p.cachedSongCounts} includeInserts={p.includeInserts} lookup={p.lookup}
          canFind={!locked && p.candidates.length > 0} onFindSongs={p.onFindSongs} />
      </main>

      <LookupFooter candidates={p.candidates.map((c) => c.show)} cachedSongCounts={p.cachedSongCounts}
        handChanges={handEdits(p.selection)} onResetEdits={() => p.onSelect({ selection: resetEdits(p.selection) })}
        includeInserts={p.includeInserts} lookup={p.lookup} onFindSongs={p.onFindSongs}
        onCancelLookup={p.onCancelLookup} onRetryLookup={p.onRetryLookup} onReviewAnyway={p.onReviewAnyway} />
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
