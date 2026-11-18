import { PHASE_LABEL, PHASES, type Phase } from '../../lib/session';

interface HeaderProps {
  phase: Phase;
  showCount: number;
  songCount: number;
  /** Songs still waiting for a match. */
  pending: number;
  progress: { done: number; total: number } | null;
  haveCount: number;
  haveUndecided: number;
  onNext: () => void;
  /** Every song of the current pass is decided: the Next button becomes the primary one. */
  passDone: boolean;
  onSkipRest: () => void;
  onBack: () => void;
}

/** Session summary, progress, "Saved", and the button to the next phase. Settings live in the app header's ⚙. */
export function ReviewHeader(p: HeaderProps) {
  const next = p.phase === 'review'
    ? p.haveCount > 0 ? `Next: Already have (${p.haveCount}) →` : 'Next: Add to playlist →'
    : p.phase === 'have' ? 'Next: Add to playlist →' : null;
  const pct = p.progress && p.progress.total ? (p.progress.done / p.progress.total) * 100 : 0;
  return (
    <header className="rv-header">
      <button className="back-btn" onClick={p.onBack} title="Back to the songs" aria-label="Back to songs">←</button>
      <span className="rv-sub">
        {p.showCount} show{p.showCount === 1 ? '' : 's'} · {p.songCount} songs{p.pending > 0 && <> · matching {p.pending} more</>}
      </span>
      {p.progress ? (
        <div className="rv-progress" aria-label={`${p.progress.done} of ${p.progress.total} decided`}>
          <div className={`bar ${p.phase === 'have' ? 'bar-have' : ''}`}><span style={{ width: `${pct}%` }} /></div>
          <span className="rv-count"><b>{p.progress.done}</b> of {p.progress.total}</span>
        </div>
      ) : <span className="spacer" />}
      <span className="saved" title="Decisions and your place are saved in this browser">● Saved</span>
      {p.phase === 'have' && p.haveUndecided > 0 && <button className="btn-line" onClick={p.onSkipRest}>Skip the rest ({p.haveUndecided})</button>}
      {next && <button className={p.passDone ? 'btn-accent' : 'btn-line'} onClick={p.onNext}>{next}</button>}
    </header>
  );
}

/** "1 · Review · 34", "2 · Already have · 4", "3 · Add to playlist", with ✓ on finished phases. Each is clickable. */
export function PhaseBar({ phase, counts, finished, onPhase }: {
  phase: Phase; counts: Partial<Record<Phase, number>>; finished: Record<Phase, boolean>; onPhase: (p: Phase) => void;
}) {
  return (
    <nav className="phasebar" aria-label="Session phases">
      {PHASES.map((ph, i) => (
        <button key={ph} className={`phase ${ph === phase ? 'on' : ''} ${finished[ph] ? 'finished' : ''} phase-${ph}`}
          aria-current={ph === phase ? 'step' : undefined} onClick={() => onPhase(ph)}>
          {finished[ph] ? '✓' : `${i + 1} ·`} {PHASE_LABEL[ph]}{counts[ph] !== undefined && ` · ${counts[ph]}`}
        </button>
      ))}
    </nav>
  );
}
