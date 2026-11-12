import { describe, expect, it } from 'vitest';
import type { Show, Theme } from '../types';
import fixture from './__fixtures__/animethemes-gql.json';
import recording from './__fixtures__/itunes-recording.json';
import { EXPECTED, FIXTURE_IDS, OST_ROW, OST_TRACK_ID, SHOWS, TAIL_ROWS } from './__fixtures__/tail';
import type { ItunesTrack } from './itunes';
import { themeKey, type MatchResult } from './matching';
import { DEFAULT_ORDER, orderShows } from './ordering';
import type { PlaylistRow } from './playlistImport';
import { buildThemeIndex, findInPlaylist, indexPlaylist, inferTail, mapRow, titleStems } from './tailInference';
import { mapAnimeThemes, type AtGqlResponse } from './themes';

/** These tests were written against ascending order; the app default is now newest-first. */
const ASC = { ...DEFAULT_ORDER, direction: 'asc' as const };
const themes = mapAnimeThemes(fixture as AtGqlResponse, FIXTURE_IDS);
const themesFor = (s: Show) => themes.get(s.anilistId) ?? [];
const index = buildThemeIndex(SHOWS, themesFor);
const ordered = orderShows(SHOWS, ASC);
const label = (h: { show: Show; theme: Theme } | null) => (h ? `${h.show.anilistId}:${h.theme.slug}` : null);
const row = (title: string, artist: string, album = '', durationMs: number | null = null, position = 1): PlaylistRow => ({ position, title, artist, album, durationMs });

describe('titleStems', () => {
  it('adds season-less and subtitle-less forms', () => {
    expect(titleStems(SHOWS.find((s) => s.anilistId === 166613)!)).toEqual(expect.arrayContaining(['hells paradise', 'jigokuraku', '地獄楽']));
    expect(titleStems(SHOWS.find((s) => s.anilistId === 182587)!)).toEqual(expect.arrayContaining(['oshi no ko', '推しの子']));
    expect(titleStems(SHOWS.find((s) => s.anilistId === 5114)!)).toEqual(expect.arrayContaining(['fullmetal alchemist brotherhood', 'fullmetal alchemist']));
  });
});

describe('mapRow on US-store names (real iTunes data)', () => {
  it.each([
    ['Golden Time Rubber', 'Sukimaswitch', 'Nayuta To Fukashigi', '5114:OP3'],
    ['Revenge of B', 'B KOMACHI RUBY(CV: YURIE IGOMA), ARIMA KANA(CV: MEGUMI HAN), MEMCHO (CV: RUMI OKUBO)', 'Song from Tv Series "【Oshi No Ko】 " Vol.5', '182587:OP1'],
    // Artist localized beyond recognition (女王蜂 → QUEEN BEE): the show named in the title carries it.
    ["PERSONAL (ED Theme to Hell's Paradise: Jigokuraku Season 2)", 'QUEEN BEE', 'PERSONAL - EP', '166613:ED1'],
    ['Kori Ni Tojikomete', 'Superfly', 'Ambitious - Single', '99425:ED2'],
    ['From the Edge (feat. LiSA)', 'FictionJunction', 'PARADE', '101922:ED1'],
  ])('%s / %s → %s', (title, artist, album, want) => {
    const m = mapRow(row(title, artist, album), index);
    expect(m.hits.map(label)).toEqual([want]);
    expect(m.hits[0]!.method).toBe('fuzzy');
  });

  it('rejects same-title songs by other artists, and covers', () => {
    for (const [t, a, al] of [
      ['Personal', 'Jessie J', 'Sweet Talker'],
      ['Golden Time', 'Fujifabric', 'Golden Time - Single'],
      ['INFERNO', 'Bella Poarch & Sub Urban', 'INFERNO - Single'],
      ['Golden Time Lover (from "Fullmetal Alchemist: Brotherhood")', 'AmaLee', 'Nostalgia V'],
      ['Gurenge (Karaoke Version)', 'Urock Karaoke', 'Anime Hits Karaoke'],
    ] as const) {
      const m = mapRow(row(t, a, al), index);
      expect(m.hits, `${t} / ${a}`).toEqual([]);
      expect(m.nearest).not.toBeNull(); // shown as "closest: …"
    }
  });

  it('needs the show named when the theme has no artist on record', () => {
    expect(mapRow(row('Inferno', 'Mrs. GREEN APPLE', 'Attitude'), index).hits).toEqual([]);
    expect(mapRow(row('Inferno', 'Hiroyuki Sawano', 'PROMARE (Original Soundtrack)'), index).hits.map(label)).toEqual(['99425:ED1']);
  });

  it('maps a translated OST title via the featured artist and the show in the album', () => {
    const m = mapRow(OST_ROW, index);
    expect(m.hits.map(label)).toEqual(['101922:ED2']);
    expect(m.hits[0]!.confidence).toBeLessThan(0.8);
  });

  it('maps a cached match exactly (confidence 1), ahead of fuzzy scoring', () => {
    const theme = themes.get(101922)!.find((t) => t.slug === 'ED2')!;
    const track = (recording as Record<string, ItunesTrack[]>)['lookup|us|1568442751,1577663290,1797538837,1503597275,1479963536,1809128470']!
      .find((t) => t.trackId === OST_TRACK_ID)!;
    const match: MatchResult = {
      key: themeKey(theme), country: 'us', chosenId: OST_TRACK_ID, score: 1, method: 'manual', requests: 1, matchedAt: 0, userPicked: true,
      candidates: [{ track, score: 1, flags: [], titleSim: 0, artistSim: 0 }],
    };
    const r = inferTail({ rows: [OST_ROW], index, ordered, direction: 'asc', matches: [match] });
    expect(r.tail[0]!.pick).toMatchObject({ method: 'exact', confidence: 1 });
    expect(label(r.tail[0]!.pick)).toBe('101922:ED2');
  });
});

describe('inferTail', () => {
  it('maps the realistic tail exactly (anisongs mapped, others unmatched)', () => {
    const r = inferTail({ rows: TAIL_ROWS, index, ordered, direction: 'asc' });
    expect(r.tail.map((t) => label(t.pick))).toEqual(EXPECTED);
    expect(r.mapped).toBe(EXPECTED.filter(Boolean).length);
    expect(r.unmatched).toBe(EXPECTED.filter((x) => !x).length);
  });

  it('suggests the most recent show in the sort order, not the last row', () => {
    const r = inferTail({ rows: TAIL_ROWS, index, ordered, direction: 'asc' });
    expect(label(r.tail.at(-1)!.pick)).toBe('182587:ED1'); // last row: Oshi no Ko
    expect(r.suggestion).toMatchObject({ show: { anilistId: 166613 }, support: 2, weak: false, orderIndex: 5 });
    expect(r.suggestion!.rowPosition).toBe(TAIL_ROWS.find((x) => x.title.startsWith('Kasuka'))!.position);
  });

  it('gives the same show when sorted newest first', () => {
    const desc = orderShows(SHOWS, { ...ASC, direction: 'desc' });
    const r = inferTail({ rows: TAIL_ROWS, index, ordered: desc, direction: 'desc' });
    expect(r.suggestion!.show.anilistId).toBe(166613);
    expect(r.suggestion!.orderIndex).toBe(0);
  });

  it('follows the sort field: by start date a different show is the most recent', () => {
    const started = SHOWS.map((s) => ({ ...s, startedAt: s.anilistId === 182587 ? { year: 2026, month: 4, day: 1 } : { year: 2020, month: 1, day: 1 } }));
    const ord = orderShows(started, { ...ASC, field: 'startedAt' });
    const idx = buildThemeIndex(started, themesFor);
    expect(inferTail({ rows: TAIL_ROWS, index: idx, ordered: ord, direction: 'asc' }).suggestion!.show.anilistId).toBe(182587);
  });

  it('only looks at the last n rows', () => {
    const r = inferTail({ rows: TAIL_ROWS, index, ordered, direction: 'asc', n: 2 });
    expect(r.tail.map((t) => t.row.title)).toEqual(['TEST ME', 'Serenade']);
    expect(r.suggestion!.show.anilistId).toBe(182587);
  });

  it('skips shows the current filters exclude, and counts them', () => {
    const dropped = SHOWS.map((s) => (s.anilistId === 166613 ? { ...s, status: 'DROPPED' as const } : s));
    const ord = orderShows(dropped, { ...ASC, includeDropped: false });
    const r = inferTail({ rows: TAIL_ROWS, index: buildThemeIndex(dropped, themesFor), ordered: ord, direction: 'asc' });
    expect(r.excluded).toBe(2);
    expect(r.suggestion!.show.anilistId).toBe(172463);
  });

  it('flags a suggestion resting on one so-so row as weak', () => {
    const r = inferTail({ rows: [row('Golden Time Rubber', 'Sukimaswitch', 'Nayuta To Fukashigi')], index, ordered, direction: 'asc' });
    expect(r.suggestion).toMatchObject({ show: { anilistId: 5114 }, support: 1, weak: true });
  });

  it('returns no suggestion when nothing maps', () => {
    const r = inferTail({ rows: [row('Personal', 'Jessie J')], index, ordered, direction: 'asc' });
    expect(r.suggestion).toBeNull();
    expect(r.unmatched).toBe(1);
  });

  it('picks the earliest show when a song is shared by several shows', () => {
    // A recap movie (later in the order) reusing FMA:B OP1.
    const movie: Show = { ...SHOWS[0]!, anilistId: 1, title: { romaji: 'Recap Movie', english: null, native: null }, completedAt: { year: 2027, month: 1, day: 1 } };
    const shows = [...SHOWS, movie];
    const themesFor2 = (s: Show) => (s.anilistId === 1 ? themesFor(SHOWS[0]!).filter((t) => t.slug === 'OP1').map((t) => ({ ...t, anilistId: 1 })) : themesFor(s));
    const ord = orderShows(shows, ASC);
    const r = inferTail({ rows: [row('Again', 'YUI', 'again - EP')], index: buildThemeIndex(shows, themesFor2), ordered: ord, direction: 'asc' });
    expect(r.tail[0]!.hits.map((h) => h.show.anilistId).sort()).toEqual([1, 5114]);
    expect(r.suggestion!.show.anilistId).toBe(5114);
  });

  it('stays fast on a large list (2000+ themes, 30 rows)', () => {
    const words = ['ai', 'hikari', 'yume', 'sora', 'kimi', 'boku', 'hana', 'kaze', 'koi', 'namida', 'ashita', 'sekai', 'hoshi', 'tsuki', 'uta', 'mirai'];
    const big: Show[] = [];
    const bigThemes = new Map<number, Theme[]>();
    for (let i = 0; i < 520; i++) {
      const s: Show = { ...SHOWS[0]!, anilistId: 10_000 + i, title: { romaji: `Show ${i}`, english: null, native: null } };
      big.push(s);
      bigThemes.set(s.anilistId, [1, 2, 3, 4].map((k) => ({
        ...themesFor(SHOWS[0]!)[0]!, anilistId: s.anilistId, slug: `OP${k}`, songId: i * 10 + k,
        songTitle: `${words[(i + k) % 16]} no ${words[(i * k) % 16]} ${words[(i + 3 * k) % 16]}`, artists: [`Artist ${i % 97}`],
      })));
    }
    const shows = [...SHOWS, ...big];
    const t0 = performance.now();
    const idx = buildThemeIndex(shows, (s) => bigThemes.get(s.anilistId) ?? themesFor(s));
    const r = inferTail({ rows: [...TAIL_ROWS, ...TAIL_ROWS].slice(-30), index: idx, ordered: orderShows(shows, ASC), direction: 'asc' });
    const ms = performance.now() - t0;
    expect(idx.entries.length).toBeGreaterThan(2000);
    expect(r.suggestion!.show.anilistId).toBe(166613);
    expect(ms).toBeLessThan(1500);
  });
});

describe('findInPlaylist (§9.4)', () => {
  const idx = indexPlaylist([
    row('Gurenge', 'LiSA', 'Gurenge - EP', 238_000, 1),
    row('Golden Time Rubber', 'Sukimaswitch', 'Nayuta To Fukashigi', 369_000, 2),
    row('Uso', 'Sid', 'Uso - Single', null, 3),
  ]);
  const t = (trackName: string, artistName: string, trackTimeMillis: number | null) => ({ trackName, artistName, trackTimeMillis });

  it('same normalized title + artist within ±3 s is a duplicate', () => {
    expect(findInPlaylist(idx, t('GURENGE', 'LiSA', 238_587))).toMatchObject({ kind: 'duplicate', row: { position: 1 } });
    expect(findInPlaylist(idx, t('Golden Time Rubber', 'Sukimaswitch', 369_453))?.kind).toBe('duplicate');
  });

  it('unknown duration on either side still counts as a duplicate', () => {
    expect(findInPlaylist(idx, t('Uso', 'Sid', 208_120))?.kind).toBe('duplicate');
    expect(findInPlaylist(idx, t('Gurenge', 'LiSA', null))?.kind).toBe('duplicate');
  });

  it('different duration or a version suffix is "version" (TV size vs full)', () => {
    expect(findInPlaylist(idx, t('Gurenge', 'LiSA', 90_000))?.kind).toBe('version');
    expect(findInPlaylist(idx, t('Gurenge (TV Size)', 'LiSA', 90_000))?.kind).toBe('version');
  });

  it('other artists or titles are not in the playlist', () => {
    expect(findInPlaylist(idx, t('Gurenge', 'Mewsic', 238_000))).toBeNull();
    expect(findInPlaylist(idx, t('Homura', 'LiSA', 238_000))).toBeNull();
  });
});
