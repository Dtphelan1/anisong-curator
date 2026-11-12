import { describe, expect, it } from 'vitest';
import type { Decision } from './db';
import type { DupHit, ExportItem, ExportPlan } from './dedupe';
import { EMPTY_SESSION, groupByShow, nextPhase, parseSession, partition, phaseOf, sessionScope, summarize, wholeShowLaterKeys } from './session';

const hit = (p: Partial<DupHit> = {}): DupHit => ({
  source: 'playlist', tier: 'duplicate', score: 1, titleSim: 1, artistSim: 1, durationDeltaMs: 0,
  row: { position: 1, title: 'Again', artist: 'YUI', album: '', durationMs: null }, ...p,
});
const dec = (key: string, decision: Decision['decision'], p: Partial<Decision> = {}): [string, Decision] => [key, { key, decision, trackId: 1, decidedAt: 0, ...p }];

describe('phase partitioning', () => {
  it('songs with a hit of any tier go to the Already have pass', () => {
    expect(phaseOf(undefined, undefined)).toBe('review');
    expect(phaseOf(hit(), undefined)).toBe('have');
    expect(phaseOf(hit({ tier: 'other-version' }), undefined)).toBe('have');
    expect(phaseOf(hit({ tier: 'likely-duplicate', source: 'added' }), undefined)).toBe('have');
  });
  it('a song you kept and the app recorded as added stays in the review', () => {
    const [, kept] = dec('a', 'keep');
    expect(phaseOf(hit({ source: 'added', sameTrack: true }), kept)).toBe('review');
    expect(phaseOf(hit({ source: 'added', sameTrack: true }), undefined)).toBe('have');
  });
  it('keeps watch order within each pass', () => {
    const hits = new Map([['b', hit()], ['d', hit()]]);
    expect(partition(['a', 'b', 'c', 'd'], hits, new Map())).toEqual({ review: ['a', 'c'], have: ['b', 'd'] });
  });
  it('Next goes to Already have, or straight to adding when there is none', () => {
    expect(nextPhase('review', 3)).toBe('have');
    expect(nextPhase('review', 0)).toBe('add');
    expect(nextPhase('have', 3)).toBe('add');
    expect(nextPhase('add', 3)).toBeNull();
  });
});

describe('Later: whole show', () => {
  const show: Record<string, number> = { a: 1, b: 1, c: 1, d: 2, e: 1 };
  it('marks the current song and every undecided song of its show in this pass', () => {
    const decisions = new Map([dec('b', 'keep')]);
    expect(wholeShowLaterKeys(['a', 'b', 'c', 'd', 'e'], (k) => show[k], 'c', decisions)).toEqual(['a', 'c', 'e']);
  });
  it('includes the current song even when it is decided', () => {
    const decisions = new Map([dec('a', 'skip')]);
    expect(wholeShowLaterKeys(['a', 'b'], (k) => show[k], 'a', decisions)).toEqual(['a', 'b']);
  });
  it('only the current song when its show is unknown', () => {
    expect(wholeShowLaterKeys(['a', 'x'], (k) => show[k], 'x', new Map())).toEqual(['x']);
  });
});

describe('export summary and grouping', () => {
  const item = (key: string): ExportItem => ({ key, trackId: key.charCodeAt(0), title: key, artist: 'X', durationMs: null, url: '', label: key });
  it('counts kept, added anyway, skipped, already-have skipped, later and held back', () => {
    const decisions = new Map([
      dec('a', 'keep'), dec('b', 'skip'), dec('c', 'later'), dec('e', 'keep'),
      dec('h1', 'keep', { addAnyway: true }), dec('h2', 'skip'), dec('h4', 'keep'),
    ]);
    const plan: ExportPlan = {
      add: [item('a'), item('h1')],
      held: [{ item: item('e'), reason: 'repeat-in-batch', detail: '', overridable: false }, { item: item('h4'), reason: 'in-playlist', detail: '', overridable: true }],
    };
    expect(summarize(['a', 'b', 'c', 'd', 'e'], ['h1', 'h2', 'h3', 'h4'], decisions, plan)).toEqual({
      toAdd: 2, kept: 1, addedAnyway: 1, skipped: 1, haveSkipped: 3, later: 1, undecided: 1, heldBack: 1,
    });
  });
  it('groups consecutive songs of one show', () => {
    const show: Record<string, number> = { a: 1, b: 1, c: 2, d: 1 };
    expect(groupByShow(['a', 'b', 'c', 'd'].map(item), (k) => show[k]).map((g) => [g.show, g.items.map((i) => i.key)]))
      .toEqual([[1, ['a', 'b']], [2, ['c']], [1, ['d']]]);
  });
});

describe('persisted session', () => {
  const scope = sessionScope(['a', 'b', 'c']);
  it('round-trips phase, current songs and the recorded batch', () => {
    const s = { scope, phase: 'have', current: { review: 'b', have: 'c' }, done: { id: 'b1', n: 3, at: 5, playlistName: 'P', anyway: ['c'] } };
    expect(parseSession(JSON.stringify(s), scope)).toEqual(s);
  });
  it('starts over for other songs, or on anything malformed', () => {
    expect(parseSession(JSON.stringify({ scope: 'other', phase: 'add', current: {} }), scope)).toEqual(EMPTY_SESSION);
    expect(parseSession('{nope', scope)).toEqual(EMPTY_SESSION);
    expect(parseSession(null)).toEqual(EMPTY_SESSION);
    expect(parseSession(JSON.stringify({ scope, phase: 'bogus', current: { review: 7 }, done: { id: 1 } }), scope)).toEqual({ scope, phase: 'review', current: {} });
  });
  it('scope is count, first and last key', () => {
    expect(scope).toBe('3|a|c');
    expect(sessionScope([])).toBe('0||');
  });
});
