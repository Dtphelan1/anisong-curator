import type { Decision } from './db';
import type { DupHit, ExportItem, ExportPlan } from './dedupe';

/**
 * The review session's three phases (docs/SPEC.md, the Review step):
 * review the new songs, then the songs already in your playlist in their
 * own pass, then add the kept ones to the playlist. Pure.
 */
export type Phase = 'review' | 'have' | 'add';
export const PHASES: Phase[] = ['review', 'have', 'add'];
export const PHASE_LABEL: Record<Phase, string> = { review: 'Review', have: 'Already have', add: 'Add to playlist' };

/**
 * Which pass a song belongs to. A song with an "already have" hit (any tier)
 * goes to its own pass, except one you kept that the app then recorded as
 * added (the add log has its exact track): that's your own decision coming
 * back, not news, so it stays where you decided it.
 */
export function phaseOf(hit: DupHit | undefined, decision: Decision | undefined): 'review' | 'have' {
  if (!hit) return 'review';
  if (hit.source === 'added' && hit.sameTrack && decision?.decision === 'keep') return 'review';
  return 'have';
}

/** Split keys (in watch order) into the two review passes, keeping their order. */
export function partition(keys: string[], hits: Map<string, DupHit>, decisions: Map<string, Decision>): { review: string[]; have: string[] } {
  const review: string[] = [];
  const have: string[] = [];
  for (const k of keys) (phaseOf(hits.get(k), decisions.get(k)) === 'have' ? have : review).push(k);
  return { review, have };
}

/** Where the header's "Next" button goes after the review: the already-have pass, or straight to adding when there's none. */
export function nextPhase(phase: Phase, haveCount: number): Phase | null {
  if (phase === 'review') return haveCount > 0 ? 'have' : 'add';
  if (phase === 'have') return 'add';
  return null;
}

/**
 * "Later: whole show": the current song plus every undecided song of the same
 * show in this pass, to punt a show whose matches are all bad.
 */
export function wholeShowLaterKeys(
  keys: string[], showOf: (key: string) => number | string | undefined, currentKey: string, decisions: Map<string, Decision>,
): string[] {
  const show = showOf(currentKey);
  if (show === undefined) return [currentKey];
  return keys.filter((k) => k === currentKey || (showOf(k) === show && !decisions.has(k)));
}

/** Phase-3 summary chips: what goes out and what doesn't. */
export interface ExportSummary {
  /** Songs to add (the export plan's `add`). */
  toAdd: number;
  /** …of which kept normally. */
  kept: number;
  /** …of which you have already, added anyway. */
  addedAnyway: number;
  /** New songs you skipped. */
  skipped: number;
  /** Songs you already have that won't be added (skipped, or never decided: those count as skipped). */
  haveSkipped: number;
  later: number;
  /** New songs not decided yet. */
  undecided: number;
  /** Kept new songs that the export still holds back (listed twice, or found in the playlist since). */
  heldBack: number;
}

export function summarize(review: string[], have: string[], decisions: Map<string, Decision>, plan: ExportPlan): ExportSummary {
  const adding = new Set(plan.add.map((i) => i.key));
  const addedAnyway = plan.add.filter((i) => decisions.get(i.key)?.addAnyway).length;
  const haveSet = new Set(have);
  const d = (k: string) => decisions.get(k)?.decision;
  return {
    toAdd: plan.add.length,
    kept: plan.add.length - addedAnyway,
    addedAnyway,
    skipped: review.filter((k) => d(k) === 'skip').length,
    haveSkipped: have.filter((k) => !adding.has(k) && d(k) !== 'later').length,
    later: [...review, ...have].filter((k) => d(k) === 'later').length,
    undecided: review.filter((k) => !decisions.has(k)).length,
    heldBack: plan.held.filter((h) => !haveSet.has(h.item.key)).length,
  };
}

/** Songs to add grouped by show, consecutive runs in export (watch) order. */
export function groupByShow<T extends Pick<ExportItem, 'key'>>(items: T[], showOf: (key: string) => number | string | undefined): { show: number | string | undefined; items: T[] }[] {
  const groups: { show: number | string | undefined; items: T[] }[] = [];
  for (const it of items) {
    const show = showOf(it.key);
    const last = groups[groups.length - 1];
    if (last && last.show === show) last.items.push(it);
    else groups.push({ show, items: [it] });
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Persisted place: phase, current song per pass, the last recorded batch */
/* ------------------------------------------------------------------ */

export interface RecordedBatch {
  id: string;
  n: number;
  at: number;
  playlistName: string;
  /** Songs that went out as "add anyway": recording clears the override, Undo restores it. */
  anyway?: string[];
  /** "Last show added" before this batch moved it forward; Undo puts it back. */
  prevBound?: number | null;
}

export interface SessionState {
  /** Which set of songs this is (`sessionScope`): a session for other shows starts over. */
  scope?: string;
  phase: Phase;
  current: { review?: string; have?: string };
  /** The batch recorded with "Yes, mark as added": the session is done (undoable). */
  done?: RecordedBatch;
}

export const EMPTY_SESSION: SessionState = { phase: 'review', current: {} };

/** A cheap signature of the session's songs (count, first and last key). */
export function sessionScope(keys: string[]): string {
  return `${keys.length}|${keys[0] ?? ''}|${keys[keys.length - 1] ?? ''}`;
}

/** Read a stored session for `scope`; anything malformed, or saved for other songs, falls back to the start. */
export function parseSession(raw: string | null, scope?: string): SessionState {
  if (!raw) return EMPTY_SESSION;
  try {
    const v = JSON.parse(raw) as Partial<SessionState>;
    if (scope !== undefined && v.scope !== scope) return EMPTY_SESSION;
    const phase = PHASES.includes(v.phase as Phase) ? (v.phase as Phase) : 'review';
    const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
    const c = (v.current && typeof v.current === 'object' ? v.current : {}) as Record<string, unknown>;
    const current: SessionState['current'] = {};
    if (str(c.review)) current.review = str(c.review);
    if (str(c.have)) current.have = str(c.have);
    const d = v.done as Partial<RecordedBatch> | undefined;
    const anyway = Array.isArray(d?.anyway) ? d.anyway.filter((k): k is string => typeof k === 'string') : [];
    const done = d && typeof d.id === 'string' && typeof d.n === 'number' && typeof d.at === 'number'
      ? { id: d.id, n: d.n, at: d.at, playlistName: typeof d.playlistName === 'string' ? d.playlistName : '', ...(anyway.length ? { anyway } : {}) }
      : undefined;
    return { ...(typeof v.scope === 'string' ? { scope: v.scope } : {}), phase, current, ...(done ? { done } : {}) };
  } catch {
    return EMPTY_SESSION;
  }
}
