/**
 * Replays real iTunes responses recorded by matching.live.test.ts
 * (2026-11-12, US storefront) through the matcher.
 */
import { describe, expect, it } from 'vitest';
import type { Theme } from '../types';
import fixture from './__fixtures__/animethemes-gql.json';
import recording from './__fixtures__/itunes-recording.json';
import type { ItunesTrack } from './itunes';
import { confidenceOf } from './matcher';
import { matchBySearch, matchLinked, manualResult, themeKey, type MatchDeps } from './matching';
import { mapAnimeThemes, type AtGqlResponse } from './themes';

const rec = recording as Record<string, ItunesTrack[]>;
const replay: MatchDeps = {
  search: async (term, country) => {
    const r = rec[`search|${country}|${term}`];
    if (!r) throw new Error(`not recorded: search|${country}|${term}`);
    return r;
  },
  lookup: async (ids, country) => {
    const r = rec[`lookup|${country}|${ids.join(',')}`];
    if (!r) throw new Error(`not recorded: lookup|${country}|${ids.join(',')}`);
    return r;
  },
  now: () => 0,
};

const ids = [101922, 99425, 182587, 172463, 166613, 5114];
const themes = [...mapAnimeThemes(fixture as AtGqlResponse, ids).values()].flat();
const names: Record<number, string[]> = {
  5114: ['Fullmetal Alchemist: Brotherhood', 'Hagane no Renkinjutsushi'], 101922: ['Demon Slayer', 'Kimetsu no Yaiba'],
  99425: ['Promare'], 182587: ['Oshi no Ko'], 172463: ['Jujutsu Kaisen'], 166613: ["Hell's Paradise", 'Jigokuraku'],
};
const find = (id: number, slug: string) => themes.find((t) => t.anilistId === id && t.slug === slug)!;
const run = (t: Theme) => matchBySearch({ theme: t, animeTitles: names[t.anilistId] ?? [] }, 'us', undefined, replay);
const top = async (id: number, slug: string) => {
  const r = await run(find(id, slug));
  const best = r.candidates[0];
  return { r, best, label: best ? `${best.track.trackName} | ${best.track.artistName}` : null };
};

describe('matchBySearch on recorded iTunes data', () => {
  it('finds the original, not the TV size or THE FIRST TAKE', async () => {
    const { label, r } = await top(101922, 'OP1');
    expect(label).toBe('Gurenge | LiSA');
    expect(confidenceOf(r.score)).toBe('high');
    expect(r.requests).toBe(1);
  });

  it('finds an original whose US title is a mistranslation, via the JP store', async () => {
    const { label, r } = await top(5114, 'OP3');
    expect(label).toBe('Golden Time Rubber | Sukimaswitch');
    expect(confidenceOf(r.score)).toBe('check');
  });

  it('finds a song via JP-store relevance when there is no native title', async () => {
    const { label } = await top(99425, 'ED2');
    expect(label).toBe('Kori Ni Tojikomete | Superfly');
  });

  it('handles translated titles and localized artist names', async () => {
    expect((await top(182587, 'OP1')).label).toMatch(/^Revenge of B \| B KOMACHI/);
    expect((await top(166613, 'ED1')).label).toBe("PERSONAL (ED Theme to Hell's Paradise: Jigokuraku Season 2) | QUEEN BEE");
  });

  it('never auto-accepts a theme with no artist on record', async () => {
    const { r } = await top(99425, 'ED1');
    expect(confidenceOf(r.score)).not.toBe('high');
  });

  it('cover-factory "(From …)" tracks never win', async () => {
    for (const t of themes.filter((x) => x.kind !== 'IN')) {
      const { best } = await top(t.anilistId, t.slug);
      if (best) expect(best.flags).not.toContain('cover');
    }
  });

  it('stays within ~2 requests per theme on average', async () => {
    let total = 0, n = 0;
    for (const t of themes.filter((x) => x.kind !== 'IN')) { total += (await run(t)).requests; n++; }
    expect(total / n).toBeLessThan(2);
  });
});

describe('matchLinked', () => {
  const t = (p: Partial<Theme>): Theme => ({ ...find(101922, 'OP1'), ...p });
  const tr = (id: number, name: string, albumId: number): ItunesTrack => ({
    trackId: id, trackName: name, artistName: 'LiSA', collectionName: 'x', collectionId: albumId, trackTimeMillis: 1,
    previewUrl: null, trackViewUrl: '', artworkUrl100: null, isStreamable: true, country: 'us', trackNumber: 1, trackCount: 2, releaseDate: null,
  });

  it('trusts song links and resolves album links by title, in one lookup', async () => {
    const calls: string[] = [];
    const lookup: MatchDeps['lookup'] = async (ids, country) => {
      calls.push(`${country}:${ids.join(',')}`);
      return [tr(111, 'Gurenge', 1), tr(201, 'Homura', 200), tr(202, 'Gurenge', 200)];
    };
    const a = t({ songId: 1, appleMusicUrl: 'https://music.apple.com/jp/song/111' });
    const b = t({ songId: 2, appleMusicUrl: 'https://music.apple.com/jp/album/200' });
    const c = t({ songId: 3, appleMusicUrl: null });
    const out = await matchLinked([a, b, c].map((theme) => ({ theme, animeTitles: [] })), 'us', undefined, { lookup });
    expect(calls).toEqual(['us:111,200']);
    expect(out.get(themeKey(a))).toMatchObject({ chosenId: 111, method: 'animethemes-link' });
    expect(out.get(themeKey(a))!.score).toBeGreaterThanOrEqual(0.95);
    expect(out.get(themeKey(b))!.chosenId).toBe(202);
    expect(out.has(themeKey(c))).toBe(false);
  });

  it('skips song links not available in the storefront (falls back to search)', async () => {
    const out = await matchLinked([{ theme: t({ appleMusicUrl: 'https://music.apple.com/jp/song/999' }), animeTitles: [] }], 'us', undefined, { lookup: async () => [] });
    expect(out.size).toBe(0);
  });
});

describe('manualResult', () => {
  it('pins the user pick first and keeps other candidates', async () => {
    const { r } = await top(101922, 'OP1');
    const other = r.candidates[2]!.track;
    const m = manualResult({ theme: find(101922, 'OP1'), animeTitles: [] }, 'us', other, r, undefined, 0);
    expect(m).toMatchObject({ chosenId: other.trackId, userPicked: true, method: 'manual' });
    expect(m.candidates[0]!.track.trackId).toBe(other.trackId);
    expect(m.candidates.filter((c) => c.track.trackId === other.trackId)).toHaveLength(1);
  });
});
