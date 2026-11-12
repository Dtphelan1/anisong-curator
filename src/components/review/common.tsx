import { useState, type CSSProperties } from 'react';
import type { Show } from '../../types';
import type { Decision } from '../../lib/db';
import type { DupHit } from '../../lib/dedupe';
import { confidenceOf } from '../../lib/matcher';
import type { MatchResult } from '../../lib/matching';
import type { MatchState } from '../../lib/queueView';
import type { Reason } from '../../lib/reasons';

export const mmss = (ms: number | null | undefined) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '');

/** Keys never fire while typing. */
export const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);

export function matchState(m: MatchResult | undefined, st: string | undefined): MatchState {
  if (st !== 'done' && st !== 'error') return 'pending';
  if (st === 'error') return 'error';
  if (!m || m.chosenId === null) return 'no-match';
  if (m.userPicked) return 'your-pick';
  const c = confidenceOf(m.score);
  return c === 'high' ? 'confident' : c === 'check' ? 'check' : c === 'low' ? 'unlikely' : 'no-match';
}

export const STATE_TEXT: Record<MatchState, string> = {
  confident: 'Confident', 'your-pick': 'Your pick', check: 'Check me', unlikely: 'Unlikely', 'no-match': 'No match', error: 'Search failed', pending: 'Matching…',
};
export const STATE_TONE: Record<MatchState, 'ok' | 'warn' | 'bad' | 'wait'> = {
  confident: 'ok', 'your-pick': 'ok', check: 'warn', unlikely: 'bad', 'no-match': 'bad', error: 'bad', pending: 'wait',
};

/** "Confident · 100%", "Check me · 73%", "Unlikely", "No match", "Search failed". */
export function ConfidencePill({ state, score }: { state: MatchState; score: number | null | undefined }) {
  const pct = (state === 'confident' || state === 'check') && score != null ? ` · ${Math.round(score * 100)}%` : '';
  return <span className={`pill tone-${STATE_TONE[state]}`}>{STATE_TEXT[state]}{pct}</span>;
}

/** A show's AniList cover, or a placeholder tinted from its id. */
export function ShowCover({ show, size = 'sm' }: { show: Pick<Show, 'anilistId' | 'coverImage'>; size?: 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const style = { '--hue': (show.anilistId * 47) % 360 } as CSSProperties;
  return show.coverImage && !failed
    ? <img className={`cover cover-${size}`} src={show.coverImage} alt="" loading="lazy" style={style} onError={() => setFailed(true)} />
    : <span className={`cover cover-${size} cover-ph`} style={style} aria-hidden="true" />;
}

export function ReasonChips({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="reasons" aria-label="Why">
      {reasons.map((r) => <li key={r.label} className={`chip-reason tone-${r.tone}`} title={r.title}>{r.label}</li>)}
    </ul>
  );
}

/** What will happen to a song, as a one-glyph queue mark. */
export function decisionMark(d: Decision | undefined, have: DupHit | undefined): { glyph: string; title: string; cls: string } {
  if (!d) return { glyph: '', title: 'Not decided yet', cls: '' };
  if (d.decision === 'skip') return { glyph: '✕', title: 'Skipped', cls: 'muted' };
  if (d.decision === 'later') return { glyph: '…', title: 'Later', cls: 'muted' };
  if (have?.source === 'added' && have.sameTrack) return { glyph: '✓', title: 'Kept and added to your playlist', cls: 'ok' };
  if (!have) return { glyph: '✓', title: 'Kept: will be added', cls: 'ok' };
  if (d.addAnyway) return { glyph: '✓+', title: 'Add anyway: will be added even though you seem to have it', cls: 'have-text' };
  return { glyph: '⊘', title: "Kept, held back: it's already in your playlist", cls: 'have-text' };
}

/** Pill for an "already have" hit: filled for a duplicate, outlined when likely, dashed for another version. */
export function HavePill({ hit }: { hit: DupHit }) {
  const pct = ` · ${Math.round(hit.score * 100)}%`;
  const label = hit.sameTrack ? 'Added by the app'
    : hit.tier === 'duplicate' ? `Already in playlist${pct}`
    : hit.tier === 'likely-duplicate' ? `Likely in playlist${pct}` : `Other version${pct}`;
  return <span className={`pill have-pill have-${hit.tier}`}>{label}</span>;
}

/** Where the hit is: "#212" in the playlist, or the add log. */
export const hitWhere = (hit: DupHit) => (hit.source === 'added' ? 'added by the app' : `#${hit.row.position}`);
