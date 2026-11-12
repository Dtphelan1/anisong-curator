import { describe, expect, it } from 'vitest';
import type { Show } from '../types';
import { orderShows, DEFAULT_ORDER } from './ordering';
import {
  DEFAULT_SELECTION, invertSelection, isPlainNewer, rangeIds, selectAll, selectedIds, selectedShows,
  selectNewer, selectNone, selectOnly, setShows, toggleShow, type SelectionContext,
  handEdits, resetEdits, withBase,
} from './selection';

const show = (id: number, day: number): Show => ({
  anilistId: id, idMal: null, title: { romaji: `S${id}`, english: null, native: null },
  format: 'TV', season: null, seasonYear: null, airingStatus: 'FINISHED', coverImage: null,
  status: 'COMPLETED', score: 0, progress: 0, repeat: 0,
  completedAt: { year: 2024, month: 1, day }, startedAt: { year: null, month: null, day: null }, updatedAt: 0, createdAt: 0,
});
// Completed on days 1..5 → ids 1..5.
const shows = [1, 2, 3, 4, 5].map((d) => show(d, d));
const ctx = (direction: 'asc' | 'desc', boundId: number | null = null): SelectionContext => ({
  ordered: orderShows(shows, { ...DEFAULT_ORDER, direction }), boundId, direction,
});
const ids = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe('selection', () => {
  it('defaults to everything newer than the last show added, or everything without one', () => {
    expect(ids(selectedIds(DEFAULT_SELECTION, ctx('desc')))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(selectedIds(DEFAULT_SELECTION, ctx('desc', 3)))).toEqual([4, 5]);
    expect(ids(selectedIds(DEFAULT_SELECTION, ctx('asc', 3)))).toEqual([4, 5]);
    expect(isPlainNewer(DEFAULT_SELECTION)).toBe(true);
  });

  it('toggles individual shows on top of the base', () => {
    const c = ctx('desc', 3);
    let sel = toggleShow(DEFAULT_SELECTION, 2, c); // add an older show
    sel = toggleShow(sel, 5, c);                   // remove a newer one
    expect(ids(selectedIds(sel, c))).toEqual([2, 4]);
    expect(sel).toMatchObject({ base: 'newer', include: [2], exclude: [5] });
    expect(isPlainNewer(sel)).toBe(false);
    // Toggling back removes the edit rather than piling up both.
    sel = toggleShow(toggleShow(sel, 2, c), 5, c);
    expect(sel).toMatchObject({ include: [], exclude: [] });
  });

  it('keeps hand edits when a newer show appears, and the new show joins automatically', () => {
    const c = ctx('desc', 3);
    const sel = toggleShow(DEFAULT_SELECTION, 4, c); // exclude 4
    const grown: SelectionContext = { ...c, ordered: orderShows([...shows, show(6, 6)], { ...DEFAULT_ORDER, direction: 'desc' }) };
    expect(ids(selectedIds(sel, grown))).toEqual([5, 6]);
  });

  it('sets a range to one state', () => {
    const c = ctx('desc');
    const order = c.ordered.map((o) => o.show.anilistId); // [5,4,3,2,1]
    expect(rangeIds(c.ordered, 3, 1)).toEqual(order.slice(1, 4));
    const sel = setShows(selectNone(), rangeIds(c.ordered, 1, 3), true, c);
    expect(ids(selectedIds(sel, c))).toEqual([2, 3, 4]);
    const off = setShows(selectAll(), rangeIds(c.ordered, 0, 1), false, c);
    expect(ids(selectedIds(off, c))).toEqual([1, 2, 3]);
  });

  it('all, none, only, invert, newer', () => {
    const c = ctx('desc', 3);
    expect(ids(selectedIds(selectAll(), c))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(selectedIds(selectNone(), c))).toEqual([]);
    expect(ids(selectedIds(selectOnly(2), c))).toEqual([2]);
    expect(ids(selectedIds(invertSelection(DEFAULT_SELECTION, c), c))).toEqual([1, 2, 3]);
    expect(ids(selectedIds(selectNewer(), c))).toEqual([4, 5]);
  });

  it('returns selected shows in list order and ignores ids no longer listed', () => {
    const c = ctx('desc');
    const sel = { base: 'none' as const, include: [1, 4, 99], exclude: [] };
    expect(selectedShows(sel, c).map((o) => o.show.anilistId)).toEqual([4, 1]);
  });
});

describe('quick starts', () => {
  // 1–5 completed on Jan 1–5; 6 watching; 7 dropped (newest update); 8 completed, no date.
  const mixed: Show[] = [
    ...shows,
    { ...show(6, 0), status: 'CURRENT', completedAt: { year: null, month: null, day: null }, updatedAt: 1_800_000_000 },
    { ...show(7, 0), status: 'DROPPED', completedAt: { year: null, month: null, day: null }, updatedAt: 1_900_000_000 },
    { ...show(8, 0), completedAt: { year: null, month: null, day: null } },
    { ...show(9, 0), completedAt: { year: 2024, month: null, day: null } },
  ];
  const c = (boundId: number | null = null): SelectionContext => ({ ordered: orderShows(mixed, { ...DEFAULT_ORDER, direction: 'desc' }), boundId, direction: 'desc' });

  it('newer: includes shows in progress, never pre-selects dropped or paused', () => {
    expect(ids(selectedIds(selectNewer(), c(3)))).toEqual([4, 5, 6]);
    expect(ids(selectedIds(selectNewer(), c()))).not.toContain(7);
  });

  it('since: completion date on or after the date, plus shows in progress', () => {
    const sel = withBase(DEFAULT_SELECTION, 'since', { since: '2024-01-03' });
    expect(ids(selectedIds(sel, c()))).toEqual([3, 4, 5, 6]);
    // A partial date (2024) counts from the start of its year, so it's before Jan 3.
    expect(ids(selectedIds(withBase(sel, 'since', { since: '2024-01-01' }), c()))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ids(selectedIds(withBase(sel, 'since', { since: '' }), c()))).toEqual([6]);
  });

  it('latest: the N most recently completed, plus shows in progress', () => {
    const sel = withBase(DEFAULT_SELECTION, 'latest', { count: 2 });
    expect(ids(selectedIds(sel, c()))).toEqual([4, 5, 6]);
  });

  it('switching quick starts keeps hand edits and the remembered date; pick by hand keeps only additions', () => {
    let sel = toggleShow(withBase(DEFAULT_SELECTION, 'since', { since: '2024-01-03' }), 1, c()); // add 1
    sel = toggleShow(sel, 5, c()); // remove 5
    expect(handEdits(sel)).toBe(2);
    const latest = withBase(sel, 'latest', { count: 3 });
    expect(latest.since).toBe('2024-01-03');
    expect(ids(selectedIds(latest, c()))).toEqual([1, 3, 4, 6]);
    expect(ids(selectedIds(withBase(sel, 'none'), c()))).toEqual([1]);
    expect(handEdits(resetEdits(sel))).toBe(0);
    // setShows keeps the extra fields.
    expect(setShows(latest, [2], true, c()).count).toBe(3);
  });
});
