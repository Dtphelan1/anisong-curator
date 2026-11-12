import { describe, expect, it } from 'vitest';
import type { Show, ThemeLookup } from '../types';
import { DEFAULT_ORDER, orderShows } from './ordering';
import { buildPickerRows, describeNone, formatFuzzy, matchesFilter, seasonLabel, statusLine, summarizeLookup } from './pickerRows';

const mk = (id: number, p: Partial<Show> = {}): Show => ({
  anilistId: id, idMal: null, title: { romaji: `Show ${id}`, english: null, native: null },
  format: 'TV', season: null, seasonYear: null, airingStatus: 'FINISHED', coverImage: null,
  status: 'COMPLETED', score: 0, progress: 12, repeat: 0,
  completedAt: { year: 2026, month: 1, day: 1 }, startedAt: { year: null, month: null, day: null }, updatedAt: 0, createdAt: 0, ...p,
});

const shows = [
  mk(1, { completedAt: { year: 2026, month: 2, day: 10 } }),  // Winter 2026
  mk(2, { completedAt: { year: 2026, month: 7, day: 1 } }),   // Summer 2026
  mk(3, { completedAt: { year: 2026, month: 8, day: 14 } }),  // Summer 2026
  mk(4, { completedAt: { year: 2026, month: 10, day: 20 }, title: { romaji: 'Chainsaw Man', english: 'Chainsaw Man – The Movie', native: 'チェンソーマン' }, format: 'MOVIE' }),
  mk(5, { status: 'CURRENT', completedAt: { year: null, month: null, day: null }, airingStatus: 'RELEASING', progress: 7 }),
];
const ordered = (direction: 'asc' | 'desc') => orderShows(shows, { ...DEFAULT_ORDER, direction });

describe('buildPickerRows', () => {
  it('groups by season of the sort date, with in-progress shows first when newest-first', () => {
    const { rows } = buildPickerRows({ ordered: ordered('desc'), field: 'completedAt', direction: 'desc', groupBy: 'season', filter: '', boundId: null });
    const labels = rows.filter((r) => r.type === 'group').map((r) => (r as { label: string }).label);
    expect(labels).toEqual(['Watching now', 'Finished · Fall 2026', 'Finished · Summer 2026', 'Finished · Winter 2026']);
    const summer = rows.find((r) => r.type === 'group' && r.key === 'Summer 2026') as { ids: number[] };
    expect(summer.ids).toEqual([3, 2]);
  });

  it('puts the last-added divider above the bound when newest-first and below it when oldest-first', () => {
    const desc = buildPickerRows({ ordered: ordered('desc'), field: 'completedAt', direction: 'desc', groupBy: 'none', filter: '', boundId: 2 }).rows;
    const i = desc.findIndex((r) => r.type === 'divider');
    expect(desc[i + 1]).toMatchObject({ type: 'show', o: { show: { anilistId: 2 } } });
    const asc = buildPickerRows({ ordered: ordered('asc'), field: 'completedAt', direction: 'asc', groupBy: 'none', filter: '', boundId: 2 }).rows;
    const j = asc.findIndex((r) => r.type === 'divider');
    expect(asc[j - 1]).toMatchObject({ type: 'show', o: { show: { anilistId: 2 } } });
  });

  it('filters on any title script; indexes follow the visible rows', () => {
    const { rows, visible } = buildPickerRows({ ordered: ordered('desc'), field: 'completedAt', direction: 'desc', groupBy: 'season', filter: 'チェンソー', boundId: null });
    expect(visible.map((o) => o.show.anilistId)).toEqual([4]);
    expect(rows).toHaveLength(2); // its group + the row
    expect(matchesFilter(shows[3]!, 'chainsaw movie')).toBe(true);
  });

  it('does not group by season for non-date sorts', () => {
    const o = orderShows(shows, { ...DEFAULT_ORDER, field: 'score' });
    const { rows } = buildPickerRows({ ordered: o, field: 'score', direction: 'desc', groupBy: 'season', filter: '', boundId: null });
    expect(rows.filter((r) => r.type === 'group').map((r) => (r as { label: string }).label)).toEqual(['Watching now']);
  });
});

describe('labels', () => {
  it('seasons, dates and status lines', () => {
    expect(seasonLabel(20261103)).toBe('Fall 2026');
    expect(seasonLabel(20260000)).toBe('2026');
    expect(formatFuzzy({ year: 2026, month: 11, day: 3 }, 2026)).toBe('Nov 3');
    expect(formatFuzzy({ year: 2024, month: 11, day: 3 }, 2026)).toBe('Nov 3, 2024');
    expect(formatFuzzy({ year: 2026, month: 8, day: null }, 2026)).toBe('Aug 2026');
    const now = new Date(2026, 10, 12);
    expect(statusLine(shows[4]!, now).text).toBe('Watching · ep 7 · airing');
    expect(statusLine(mk(9, { completedAt: { year: null, month: null, day: null } }), now)).toMatchObject({ text: 'Completed · no date', tone: 'warn' });
  });
});

describe('summarizeLookup', () => {
  it('counts songs and words the shows without any by kind', () => {
    const l = (id: number, n: number, extra: Partial<ThemeLookup> = {}): ThemeLookup => ({
      anilistId: id, status: n ? 'found' : 'none', source: n ? 'animethemes' : null, fetchedAt: 0,
      themes: Array.from({ length: n }, (_, i) => ({ slug: `OP${i + 1}`, anilistId: id, kind: 'OP' as const, sequence: i + 1, songId: null, songTitle: 'x', songTitleNative: null, artists: [], artistsNative: [], episodes: null, appleMusicUrl: null, source: 'animethemes' as const })),
      ...extra,
    });
    const lookups = new Map([[1, l(1, 2)], [4, l(4, 0, { incomplete: 'Jikan: down' })], [5, l(5, 0)]]);
    const s = summarizeLookup(shows, lookups, new Map([[3, 'AnimeThemes: HTTP 500']]), false);
    expect(s).toMatchObject({ songs: 2, withSongs: 1, unchecked: 1, errors: 1, none: { optional: 1, airing: 1, series: 0 } });
    expect(describeNone(s.none)).toBe('2 without songs listed (1 movie or special, 1 still airing)');
  });
});
