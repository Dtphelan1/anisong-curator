import { describe, expect, it } from 'vitest';
import type { Show } from '../types';
import { orderShows, DEFAULT_ORDER } from './ordering';
import {
  DEFAULT_SELECTION, invertSelection, isPlainNewer, rangeIds, selectAll, selectedIds, selectedShows,
  selectNewer, selectNone, selectOnly, setShows, toggleShow, type SelectionContext,
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
