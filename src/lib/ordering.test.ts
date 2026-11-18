import { describe, expect, it } from 'vitest';
import type { FuzzyDate, ListStatus, Show } from '../types';
import { candidatesAfterBound, fuzzyDateKey, orderShows, unixToDateKey, DEFAULT_ORDER } from './ordering';

/** These tests were written against ascending order; the app default is now newest-first. */
const ASC = { ...DEFAULT_ORDER, direction: 'asc' as const };
const D = (year: number | null, month: number | null = null, day: number | null = null): FuzzyDate => ({ year, month, day });
const unix = (iso: string) => Date.parse(iso) / 1000;

let nextId = 1;
function show(p: Partial<Show> & { status: ListStatus; name: string }): Show {
  const { name, ...rest } = p;
  return {
    anilistId: nextId++,
    idMal: null,
    title: { romaji: name, english: null, native: null },
    format: 'TV', season: null, seasonYear: null, airingStatus: 'FINISHED', coverImage: null,
    score: 0, progress: 0, repeat: 0,
    completedAt: D(null), startedAt: D(null),
    updatedAt: 0, createdAt: 0,
    ...rest,
  };
}
const names = (xs: { show: Show }[]) => xs.map((x) => x.show.title.romaji);

describe('fuzzy dates', () => {
  it('orders partial dates at the start of their year/month', () => {
    expect(fuzzyDateKey(D(2020))!).toBeLessThan(fuzzyDateKey(D(2020, 1, 1))!);
    expect(fuzzyDateKey(D(2020, 3))!).toBeLessThan(fuzzyDateKey(D(2020, 3, 1))!);
    expect(fuzzyDateKey(D(null, 3, 1))).toBeNull();
  });
  it('converts unix seconds to comparable UTC day keys', () => {
    expect(unixToDateKey(unix('2024-07-09T12:00:00Z'))).toBe(20240709);
    expect(unixToDateKey(0)).toBeNull();
  });
});

describe('orderShows', () => {
  const shows = [
    show({ name: 'C-2023', status: 'COMPLETED', completedAt: D(2023, 5, 1) }),
    show({ name: 'C-2021', status: 'COMPLETED', completedAt: D(2021, 1, 2) }),
    show({ name: 'C-nodate', status: 'COMPLETED' }),
    show({ name: 'Dropped-2022', status: 'DROPPED', updatedAt: unix('2022-06-01T00:00:00Z') }),
    show({ name: 'Paused-2024', status: 'PAUSED', updatedAt: unix('2024-01-01T00:00:00Z') }),
    show({ name: 'Watching', status: 'CURRENT', updatedAt: unix('2019-01-01T00:00:00Z') }),
    show({ name: 'Rewatching', status: 'REPEATING', completedAt: D(2018, 1, 1) }),
    show({ name: 'Planned', status: 'PLANNING' }),
  ];

  it('sorts bucket A chronologically, puts in-progress after, and excludes PLANNING', () => {
    const o = orderShows(shows, ASC);
    expect(names(o)).toEqual(['C-nodate', 'C-2021', 'Dropped-2022', 'C-2023', 'Paused-2024', 'Rewatching', 'Watching']);
  });

  it('marks fallback and missing keys', () => {
    const o = orderShows(shows, ASC);
    const src = Object.fromEntries(o.map((x) => [x.show.title.romaji, x.keySource]));
    expect(src['C-nodate']).toBe('missing');
    expect(src['Dropped-2022']).toBe('fallback');
    expect(src['C-2023']).toBe('primary');
  });

  it('descending keeps in-progress at the recent end (first)', () => {
    const o = orderShows(shows, { ...ASC, direction: 'desc' });
    expect(names(o).slice(0, 2)).toEqual(['Watching', 'Rewatching']);
    expect(names(o).at(-1)).toBe('C-nodate');
  });

  it('can exclude dropped and paused', () => {
    const o = orderShows(shows, { ...ASC, includeDropped: false, includePaused: false });
    expect(names(o)).not.toContain('Dropped-2022');
    expect(names(o)).not.toContain('Paused-2024');
  });

  it('sorts by score with title tie-break', () => {
    const s = [
      show({ name: 'b', status: 'COMPLETED', score: 80 }),
      show({ name: 'a', status: 'COMPLETED', score: 80 }),
      show({ name: 'z', status: 'COMPLETED', score: 60 }),
    ];
    expect(names(orderShows(s, { ...ASC, field: 'score' }))).toEqual(['z', 'a', 'b']);
  });
});

describe('candidatesAfterBound', () => {
  const s = ['a', 'b', 'c', 'd'].map((n, i) => show({ name: n, status: 'COMPLETED', completedAt: D(2020 + i, 1, 1) }));
  const asc = orderShows(s, ASC);
  const desc = orderShows(s, { ...ASC, direction: 'desc' });
  const bId = s[1]!.anilistId;

  it('returns shows more recent than the bound in either direction', () => {
    expect(names(candidatesAfterBound(asc, bId, 'asc'))).toEqual(['c', 'd']);
    expect(names(candidatesAfterBound(desc, bId, 'desc'))).toEqual(['d', 'c']);
  });
  it('returns everything without a (known) bound', () => {
    expect(candidatesAfterBound(asc, null, 'asc')).toHaveLength(4);
    expect(candidatesAfterBound(asc, 999_999, 'asc')).toHaveLength(4);
  });
});

describe('DEFAULT_ORDER', () => {
  it('is newest first', () => {
    expect(DEFAULT_ORDER.direction).toBe('desc');
  });
});
