/**
 * Live evaluation against iTunes (opt-in: LIVE=1 npx vitest run matching.live).
 * Records every response to __fixtures__/itunes-recording.json so the offline
 * tests in matching.test.ts replay real data.
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import fixture from './__fixtures__/animethemes-gql.json';
import { lookup, searchSongs } from './itunes';
import { matchBySearch, matchLinked } from './matching';
import { mapAnimeThemes, type AtGqlResponse } from './themes';

const LIVE = !!process.env.LIVE;

describe.skipIf(!LIVE)('live matcher eval', () => {
  it('matches every fixture theme', async () => {
    const recording: Record<string, unknown> = {};
    const rs: typeof searchSongs = async (term, country, limit) => {
      const r = await searchSongs(term, country, limit); recording[`search|${country}|${term}`] = r; return r;
    };
    const rl: typeof lookup = async (ids, country) => {
      const r = await lookup(ids, country); recording[`lookup|${country}|${ids.join(',')}`] = r; return r;
    };
    const ids = [101922, 99425, 182587, 172463, 166613, 5114];
    const themes = [...mapAnimeThemes(fixture as AtGqlResponse, ids).values()].flat().filter((t) => t.kind !== 'IN');
    const names: Record<number, string[]> = { 5114: ['Fullmetal Alchemist: Brotherhood', 'Hagane no Renkinjutsushi'], 101922: ['Demon Slayer', 'Kimetsu no Yaiba'], 99425: ['Promare'], 182587: ['Oshi no Ko'], 172463: ['Jujutsu Kaisen'], 166613: ["Hell's Paradise", 'Jigokuraku'] };
    let total = 0;
    for (const theme of themes) {
      const ctx = { theme, animeTitles: names[theme.anilistId] ?? [] };
      const r = theme.appleMusicUrl
        ? (await matchLinked([ctx], 'us', undefined, { lookup: rl })).get(`song:${theme.songId}`) ?? await matchBySearch(ctx, 'us', undefined, { search: rs, lookup: rl })
        : await matchBySearch(ctx, 'us', undefined, { search: rs, lookup: rl });
      total += r.requests;
      const best = r.candidates[0];
      console.log(`${String(theme.anilistId).padEnd(7)}${theme.slug.padEnd(5)}${(theme.songTitle ?? '').padEnd(24)} → ${best ? `${best.track.trackName} | ${best.track.artistName} | ${best.track.collectionName}`.slice(0, 80) : '—'}  score=${r.score?.toFixed(2)} req=${r.requests} [${best?.flags.join(',') ?? ''}]`);
    }
    console.log(`TOTAL iTunes requests: ${total} for ${themes.length} themes`);
    writeFileSync(new URL('./__fixtures__/itunes-recording.json', import.meta.url), JSON.stringify(recording));
  }, 600_000);
});
