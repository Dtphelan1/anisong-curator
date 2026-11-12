import { describe, expect, it, vi } from 'vitest';
import type { Show, Theme, ThemeLookup } from '../types';
import fixture from './__fixtures__/animethemes-gql.json';
import { isFresh, jikanToThemes, mapAnimeThemes, type AtGqlResponse, parseJikanTheme, resolveThemes, RECHECK_AFTER, type ThemeCache } from './themes';

describe('parseJikanTheme', () => {
  it.each([
    ['1: "Gurenge" by LiSA (eps 1-19)', { sequence: 1, title: 'Gurenge', titleNative: null, artists: ['LiSA'], episodes: '1-19' }],
    ['"Kaikai Kitan" by Eve (eps 1-13)', { sequence: null, title: 'Kaikai Kitan', titleNative: null, artists: ['Eve'], episodes: '1-13' }],
    ['#2: "Ai no Supreme! (愛のシュプリーム!)" by fhána (eps 1-12)', { sequence: 2, title: 'Ai no Supreme!', titleNative: '愛のシュプリーム!', artists: ['fhána'], episodes: '1-12' }],
    ['"Fuwa Fuwa Time" by Yui Hirasawa (CV: Aki Toyosaki) (eps 1-13)', { sequence: null, title: 'Fuwa Fuwa Time', titleNative: null, artists: ['Yui Hirasawa (CV: Aki Toyosaki)'], episodes: '1-13' }],
    ['"Kick Back" by Kenshi Yonezu', { sequence: null, title: 'Kick Back', titleNative: null, artists: ['Kenshi Yonezu'], episodes: null }],
    ['3: "Idol" by YOASOBI feat. Someone & Another (ep 1)', { sequence: 3, title: 'Idol', titleNative: null, artists: ['YOASOBI', 'Someone', 'Another'], episodes: '1' }],
    ['"紅蓮華" by LiSA', { sequence: null, title: '紅蓮華', titleNative: '紅蓮華', artists: ['LiSA'], episodes: null }],
  ])('%s', (raw, expected) => {
    expect(parseJikanTheme(raw)).toEqual(expected);
  });

  it('returns null for unparseable strings', () => {
    expect(parseJikanTheme('No opening themes have been added')).toBeNull();
  });

  it('numbers unnumbered themes by position', () => {
    const t = jikanToThemes(1, { openings: ['"A" by X', '"B" by Y'], endings: ['"C" by Z'] });
    expect(t.map((x) => x.slug)).toEqual(['OP1', 'OP2', 'ED1']);
  });
});

describe('mapAnimeThemes (GraphQL, real response captured 2026-11-11)', () => {
  const ids = [101922, 99425, 182587, 172463, 166613, 5114];
  const m = mapAnimeThemes(fixture as AtGqlResponse, ids);

  it('maps every requested show from one batched call', () => {
    expect([...m.keys()].sort()).toEqual([...ids].sort());
  });
  it('extracts title, artists, episodes, and native title', () => {
    const [op] = m.get(101922)!;
    expect(op).toMatchObject({ slug: 'OP1', kind: 'OP', sequence: 1, songTitle: 'Gurenge', artists: ['LiSA'], source: 'animethemes' });
    expect(op!.episodes).toBe('1-15, 16-21, 22, 23-26');
    const ed = m.get(172463)!.find((t) => t.kind === 'ED')!;
    expect(ed).toMatchObject({ songTitle: 'Yoake no Uta', songTitleNative: 'よあけのうた' });
  });
  it('dedupes repeated group performances', () => {
    const op1 = m.get(182587)!.find((t) => t.slug === 'OP1')!;
    expect(op1.artists).toEqual(['B-Komachi']);
  });
  it('drops native titles identical to romaji', () => {
    expect(m.get(172463)!.find((t) => t.kind === 'OP')!.songTitleNative).toBeNull();
  });
  it('ignores ids that were not requested', () => {
    expect(mapAnimeThemes(fixture as AtGqlResponse, [5114]).size).toBe(1);
  });
});

/* ---------------- resolveThemes ---------------- */

function mkShow(id: number, p: Partial<Show> = {}): Show {
  return {
    anilistId: id, idMal: id + 1000, title: { romaji: `S${id}`, english: null, native: null },
    format: 'TV', season: null, seasonYear: null, airingStatus: 'FINISHED', coverImage: null,
    status: 'COMPLETED', score: 0, progress: 0, repeat: 0,
    completedAt: { year: null, month: null, day: null }, startedAt: { year: null, month: null, day: null },
    updatedAt: 0, createdAt: 0, ...p,
  };
}
const theme = (anilistId: number, source: Theme['source'] = 'animethemes'): Theme => ({
  slug: 'OP1', anilistId, kind: 'OP', sequence: 1, songId: 1, songTitle: 'x', songTitleNative: null, artists: [], artistsNative: [], episodes: null, appleMusicUrl: null, source,
});
function memCache(seed: ThemeLookup[] = []): ThemeCache & { data: Map<number, ThemeLookup> } {
  const data = new Map(seed.map((l) => [l.anilistId, l]));
  return { data, get: async (id) => data.get(id), put: async (l) => { data.set(l.anilistId, l); } };
}

describe('resolveThemes', () => {
  const NOW = 1_000_000_000_000;

  it('uses cache, then AnimeThemes, then Jikan, and caches negatives', async () => {
    const cache = memCache([{ anilistId: 1, status: 'found', themes: [theme(1)], source: 'animethemes', fetchedAt: 0 }]);
    const animeThemes = vi.fn(async (ids: number[]) => new Map(ids.filter((i) => i === 2).map((i) => [i, [theme(i)]])));
    const jikan = vi.fn(async (id: number) => (id === 3 ? [theme(3, 'jikan')] : []));
    const { lookups, errors } = await resolveThemes([mkShow(1), mkShow(2), mkShow(3), mkShow(4)], { cache, animeThemes, jikan, now: () => NOW });

    expect(animeThemes).toHaveBeenCalledWith([2, 3, 4]);
    expect(jikan.mock.calls.map((c) => c[0])).toEqual([3, 4]);
    expect(lookups.get(2)?.source).toBe('animethemes');
    expect(lookups.get(3)?.source).toBe('jikan');
    expect(lookups.get(4)?.status).toBe('none');
    expect(cache.data.get(4)?.status).toBe('none');
    expect(errors.size).toBe(0);
  });

  it('does not cache failures, so they are retried', async () => {
    const cache = memCache();
    const animeThemes = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { lookups, errors } = await resolveThemes([mkShow(1)], { cache, animeThemes, now: () => NOW });
    expect(lookups.size).toBe(0);
    expect(errors.get(1)).toMatch(/Failed to fetch/);
    expect(cache.data.size).toBe(0);
  });

  it('isFresh: negatives and airing shows expire, finished shows do not', () => {
    const found: ThemeLookup = { anilistId: 1, status: 'found', themes: [], source: 'animethemes', fetchedAt: 0 };
    const none: ThemeLookup = { ...found, status: 'none' };
    expect(isFresh(found, mkShow(1), RECHECK_AFTER * 10)).toBe(true);
    expect(isFresh(found, mkShow(1, { airingStatus: 'RELEASING' }), RECHECK_AFTER + 1)).toBe(false);
    expect(isFresh(none, mkShow(1), RECHECK_AFTER - 1)).toBe(true);
    expect(isFresh(none, mkShow(1), RECHECK_AFTER + 1)).toBe(false);
  });
});
