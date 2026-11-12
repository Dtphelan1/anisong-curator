import { describe, expect, it } from 'vitest';
import {
  computeOrder, counts, DEFAULT_VIEW, isStale, nextUndecidedKey, stepKey, withCurrent,
  type QueueEntry, type ViewOptions,
} from './queueView';

const e = (key: string, index: number, p: Partial<QueueEntry> = {}): QueueEntry => ({
  key, index, anime: 'FMA', title: key, match: 'confident', decision: 'undecided', have: false, ...p,
});
const entries: QueueEntry[] = [
  e('again', 0, { anime: 'FMA', title: 'again', match: 'confident' }),
  e('hologram', 1, { anime: 'FMA', title: 'Hologram', match: 'your-pick', have: true, decision: 'keep' }),
  e('golden', 2, { anime: 'FMA', title: 'Golden Time Lover', match: 'check' }),
  e('gurenge', 3, { anime: 'Demon Slayer', title: 'Gurenge', match: 'no-match' }),
  e('edge', 4, { anime: 'Demon Slayer', title: 'from the edge', match: 'pending' }),
  e('aizo', 5, { anime: 'Jujutsu Kaisen', title: 'AIZO', match: 'unlikely', decision: 'later' }),
];
const failed = e('serenade', 6, { anime: 'Oshi no Ko', title: 'Serenade', match: 'error' });
const view = (p: Partial<ViewOptions>) => computeOrder(entries, { ...DEFAULT_VIEW, ...p });

describe('computeOrder', () => {
  it('original order by default', () => {
    expect(view({})).toEqual(['again', 'hologram', 'golden', 'gurenge', 'edge', 'aizo']);
  });
  it('status: confident → your pick → check me → unlikely → no match, still-matching last', () => {
    expect(view({ sort: 'status', desc: true })).toEqual(['again', 'hologram', 'golden', 'aizo', 'gurenge', 'edge']);
    expect(view({ sort: 'status', desc: false })).toEqual(['gurenge', 'aizo', 'golden', 'hologram', 'again', 'edge']);
  });
  it('anime and title, case-insensitive, stable on ties', () => {
    expect(view({ sort: 'anime' })).toEqual(['gurenge', 'edge', 'again', 'hologram', 'golden', 'aizo']);
    expect(view({ sort: 'title' })).toEqual(['again', 'aizo', 'edge', 'golden', 'gurenge', 'hologram']);
  });
  it('filters', () => {
    expect(view({ filter: 'undecided' })).toEqual(['again', 'golden', 'gurenge', 'edge']);
    expect(view({ filter: 'check' })).toEqual(['golden', 'aizo']);
    expect(view({ filter: 'no-match' })).toEqual(['gurenge']);
    expect(view({ filter: 'have' })).toEqual(['hologram']);
    expect(view({ filter: 'later' })).toEqual(['aizo']);
  });
  it('groups by anime in first-appearance order, sorted within groups', () => {
    // Title order: again(FMA) aizo(JJK) edge(DS) golden(FMA) gurenge(DS) hologram(FMA) → grouped by first appearance.
    expect(view({ groupByAnime: true, sort: 'title' })).toEqual(['again', 'golden', 'hologram', 'aizo', 'edge', 'gurenge']);
  });
  it('a failed search sorts after no match and shows under the No match filter', () => {
    const all = [...entries, failed];
    expect(computeOrder(all, { ...DEFAULT_VIEW, sort: 'status', desc: true }).slice(-3)).toEqual(['gurenge', 'serenade', 'edge']);
    expect(computeOrder(all, { ...DEFAULT_VIEW, filter: 'no-match' })).toEqual(['gurenge', 'serenade']);
  });

  it('counts per filter', () => {
    expect(counts(entries)).toMatchObject({ all: 6, undecided: 4, check: 2, 'no-match': 1, have: 1, keep: 1, later: 1, skip: 0 });
  });
});

describe('frozen order', () => {
  it('a status change does not move rows until refreshed', () => {
    const opts = { ...DEFAULT_VIEW, sort: 'status' as const, desc: false };
    const frozen = computeOrder(entries, opts); // no match first
    expect(frozen[0]).toBe('gurenge');
    // Fix gurenge: no match → your pick.
    const after = entries.map((x) => (x.key === 'gurenge' ? { ...x, match: 'your-pick' as const } : x));
    expect(isStale(frozen, after, opts)).toBe(true);
    // The UI keeps `frozen`; stepping from gurenge stays in the no-match/unlikely end of the list.
    expect(stepKey(frozen, 'gurenge', 1)).toBe('aizo');
    expect(isStale(computeOrder(after, opts), after, opts)).toBe(false);
  });

  it('keeps the current song in view after it leaves the filter', () => {
    const opts = { ...DEFAULT_VIEW, filter: 'undecided' as const };
    const frozen = computeOrder(entries, opts);
    const decided = entries.map((x) => (x.key === 'golden' ? { ...x, decision: 'keep' as const } : x));
    const fresh = computeOrder(decided, opts);
    expect(fresh).not.toContain('golden');
    expect(withCurrent(fresh, 'golden', decided)).toEqual(['again', 'golden', 'gurenge', 'edge']);
    expect(withCurrent(frozen, 'golden', decided)).toEqual(frozen);
  });
});

describe('navigation', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('steps and clamps', () => {
    expect(stepKey(order, 'b', 1)).toBe('c');
    expect(stepKey(order, 'd', 1)).toBe('d');
    expect(stepKey(order, 'a', -1)).toBe('a');
    expect(stepKey(order, 'zzz', 1)).toBe('a');
    expect(stepKey([], 'a', 1)).toBeNull();
  });
  it('next undecided wraps within the view and skips the current song', () => {
    const undecided = new Set(['a', 'd']);
    expect(nextUndecidedKey(order, 'b', (k) => undecided.has(k))).toBe('d');
    expect(nextUndecidedKey(order, 'd', (k) => undecided.has(k))).toBe('a');
    expect(nextUndecidedKey(order, 'a', (k) => k === 'a')).toBeNull();
  });
});
