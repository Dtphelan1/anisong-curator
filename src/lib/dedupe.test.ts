import { describe, expect, it } from 'vitest';
import type { Theme } from '../types';
import fixture from './__fixtures__/animethemes-gql.json';
import recording from './__fixtures__/itunes-recording.json';
import { FIXTURE_IDS } from './__fixtures__/tail';
import {
  checkSources, classify, DUP, findDuplicate, indexRows, planExport, shortcutLine, themeNames, withStoreName,
  type AddedRecord, type DupQuery, type ExportItem,
} from './dedupe';
import type { ItunesTrack } from './itunes';
import { parsePlaylist, type PlaylistRow } from './playlistImport';
import { mapAnimeThemes, type AtGqlResponse } from './themes';

const themes = mapAnimeThemes(fixture as AtGqlResponse, FIXTURE_IDS);
const theme = (anilistId: number, slug: string): Theme => themes.get(anilistId)!.find((t) => t.slug === slug)!;
/** A real catalog track from the iTunes recording. */
const track = (id: number): ItunesTrack => {
  for (const v of Object.values(recording as Record<string, ItunesTrack[]>)) {
    const t = Array.isArray(v) ? v.find((x) => x.trackId === id) : undefined;
    if (t) return t;
  }
  throw new Error(`no track ${id}`);
};
/** What KeptSummary builds: the catalog track's names plus the theme's. */
const query = (t: ItunesTrack, th?: Theme): DupQuery => ({ title: t.trackName, artist: t.artistName, durationMs: t.trackTimeMillis, ...(th ? themeNames(th) : {}) });
const row = (title: string, artist: string, durationMs: number | null = null, position = 1, album = ''): PlaylistRow => ({ position, title, artist, album, durationMs });
const tierOf = (rows: PlaylistRow[], q: DupQuery, artistsKnown = true) => findDuplicate(indexRows(rows, { artistsKnown }), q)?.tier ?? null;

const GURENGE = 1529543135, GURENGE_TV = 1538287177, GURENGE_FIRST_TAKE = 1543157753;

describe('likelihood tiers', () => {
  it('exact title + artist + duration is a duplicate', () => {
    const m = findDuplicate(indexRows([row('Gurenge', 'LiSA', 238_000, 7)]), query(track(GURENGE), theme(101922, 'OP1')));
    expect(m).toMatchObject({ tier: 'duplicate', row: { position: 7 }, titleSim: 1, artistSim: 1 });
    expect(m!.score).toBeGreaterThan(0.95);
  });

  it('ignores case, punctuation and storefront artist suffixes', () => {
    expect(tierOf([row('GURENGE!', 'lisa', 237_000)], query(track(GURENGE)))).toBe('duplicate');
    // US store: "SCANDAL (JP)"; a library row may say "SCANDAL".
    expect(tierOf([row('Shunkan Sentimental', 'SCANDAL', 225_000)], query(track(1536262419), theme(5114, 'ED4')))).toBe('duplicate');
    // "Sukima Switch" (AnimeThemes) / "Sukimaswitch" (US store): whitespace-insensitive.
    expect(tierOf([row('Golden Time Rubber', 'Sukima Switch', 369_000)], { title: 'Golden Time Rubber', artist: 'Sukimaswitch', durationMs: 369_453 })).toBe('duplicate');
  });

  it('JP native title in the playlist vs romaji in the catalog, via the theme alt titles', () => {
    const yoake = query(track(1860793850), theme(172463, 'ED1')); // "Yoake no uta" / theme native よあけのうた
    expect(tierOf([row('よあけのうた', 'jo0ji', 199_000)], yoake)).toBe('duplicate');
    // Without the theme's names there's nothing to go on.
    expect(tierOf([row('よあけのうた', 'jo0ji', 199_000)], query(track(1860793850)))).toBeNull();
    // Native artist too: US "QUEEN BEE" vs a JP library's 女王蜂 (theme artistsNative).
    expect(tierOf([row('PERSONAL', '女王蜂', 275_000)], query(track(1864160080), theme(166613, 'ED1')))).toBe('duplicate');
  });

  it('a native title only the JP store knows, via the JP-store name', () => {
    // AnimeThemes often has no native title (Frieren OP1 is plain "Yuusha"); the JP store says 勇者.
    const yuusha = { title: 'Yuusha', artist: 'YOASOBI', durationMs: 194_000, altTitles: ['Yuusha'], altArtists: ['YOASOBI'] };
    const pl = [row('勇者', 'YOASOBI', 194_000)];
    expect(tierOf(pl, yuusha)).toBeNull();
    expect(tierOf(pl, withStoreName(yuusha, { title: '勇者', artist: 'YOASOBI' }))).toBe('duplicate');
    expect(withStoreName(yuusha, null)).toBe(yuusha);
  });

  it('translated catalog title vs the original in the playlist, via the theme alt titles', () => {
    const revenge = query(track(1866463539), theme(182587, 'OP1')); // US "Revenge of B" / theme "B no Revenge", Bのリベンジ
    expect(tierOf([row('B no Revenge', 'B-Komachi')], revenge)).toBe('duplicate');
    expect(tierOf([row('Bのリベンジ', 'B Komachi', 182_000)], revenge)).toBe('duplicate');
    expect(tierOf([row('B no Revenge', 'B-Komachi')], query(track(1866463539)))).toBeNull();
  });

  it('TV size vs full (or live, or ≥ 20 s apart) is another version', () => {
    const full = [row('Gurenge', 'LiSA', 238_587)];
    expect(tierOf(full, query(track(GURENGE_TV), theme(101922, 'OP1')))).toBe('other-version');
    expect(tierOf(full, query(track(GURENGE_FIRST_TAKE)))).toBe('other-version');
    expect(tierOf([row('Gurenge (TV Size)', 'LiSA', null)], query(track(GURENGE)))).toBe('other-version');
    expect(tierOf([row('Gurenge', 'LiSA', 90_000)], query(track(GURENGE)))).toBe('other-version');
    expect(tierOf([row('Uso', 'SID', 208_000)], query(track(1650757427)))).toBe('other-version'); // "Uso (LIVE)"
  });

  it('a few seconds off (another master) is likely, not certain', () => {
    expect(tierOf([row('Again', 'YUI', 265_000)], query(track(1537445612), theme(5114, 'OP1')))).toBe('likely-duplicate');
    expect(tierOf([row('Again', 'YUI', 254_347)], query(track(1537445612), theme(5114, 'OP1')))).toBe('duplicate');
  });

  it('same title by a different artist is not a match (covers, unrelated songs)', () => {
    const again = [row('Again', 'YUI', 255_213)];
    expect(tierOf(again, query(track(1481110126), theme(5114, 'OP1')))).toBeNull(); // AmaLee cover
    expect(tierOf(again, { title: 'Again', artist: 'Lenny Kravitz', durationMs: 228_000 })).toBeNull();
    expect(tierOf([row('PERSONAL', 'QUEEN BEE', 275_493)], query(track(1440906668)))).toBeNull(); // "Personal" by HRVY
    expect(tierOf([row('Inferno', 'Mrs. GREEN APPLE', 211_600)], query(track(1579117772)))).toBeNull(); // Bella Poarch
    expect(tierOf([row('Golden Time', 'Fujifabric', 192_240)], { title: 'Golden Time Rubber', artist: 'Sukimaswitch', durationMs: 369_453 })).toBeNull();
  });

  it('other songs by the same artist are not matches', () => {
    expect(tierOf([row('Homura', 'LiSA', 270_000), row('Shirushi', 'LiSA', 270_000)], query(track(GURENGE)))).toBeNull();
    expect(tierOf([row('Rain', 'Sid', 256_000)], query(track(1536375094)))).toBeNull(); // Uso
  });

  it('unknown artists cap the tier at likely, and need the title and duration to agree', () => {
    const q = query(track(GURENGE), theme(101922, 'OP1'));
    expect(tierOf([row('Gurenge', 'LiSA', 238_000)], q, false)).toBe('likely-duplicate');
    expect(tierOf([row('Gurenge', '', null)], q)).toBe('likely-duplicate');
    expect(tierOf([row('Gurenge', '', 90_000)], q)).toBeNull();
    expect(tierOf([row('Gurenge (TV Size)', '', null)], q)).toBeNull();
    expect(findDuplicate(indexRows([row('Gurenge', '', null)]), q)?.artistSim).toBeNull();
  });

  it('classify: the threshold table', () => {
    expect(classify(1, 1, 0, false)).toBe('duplicate');
    expect(classify(DUP.titleDuplicate, DUP.artistDuplicate, DUP.sameDurationMs, false)).toBe('duplicate');
    expect(classify(0.89, 1, 0, false)).toBe('likely-duplicate');
    expect(classify(1, 0.79, 0, false)).toBe('likely-duplicate');
    expect(classify(1, 1, 10_000, false)).toBe('likely-duplicate');
    expect(classify(DUP.titleLikely, DUP.artistLikely, null, false)).toBe('likely-duplicate');
    expect(classify(0.74, 1, 0, false)).toBeNull();
    expect(classify(1, 0.59, 0, false)).toBeNull();
    expect(classify(1, 1, 0, true)).toBe('other-version');
    expect(classify(1, 1, DUP.otherCutMs, false)).toBe('other-version');
    expect(classify(0.78, 1, 0, true)).toBeNull();
    expect(classify(1, null, null, false)).toBe('likely-duplicate');
    expect(classify(0.85, null, 0, false)).toBeNull();
  });
});

describe('checkSources: add log + snapshot', () => {
  const log = (p: Partial<AddedRecord> & { trackId: number; title: string }): AddedRecord => ({ artist: 'LiSA', durationMs: 200_000, key: 'k', batchId: 'b1', addedAt: 0, ...p });

  it('same trackId in the add log is a certain duplicate', () => {
    expect(checkSources({ ...query(track(GURENGE)), trackId: GURENGE }, { added: [log({ trackId: GURENGE, title: 'whatever' })] }))
      .toMatchObject({ source: 'added', sameTrack: true, tier: 'duplicate' });
  });

  it('add-log names are scored like playlist rows (other id, alt title)', () => {
    const added = [log({ trackId: 1, title: 'よあけのうた', artist: 'jo0ji', durationMs: 199_613 })];
    expect(checkSources({ ...query(track(1860793850), theme(172463, 'ED1')), trackId: 2 }, { added })).toMatchObject({ source: 'added', tier: 'duplicate' });
  });

  it('the stronger tier wins; the add log wins ties', () => {
    const playlist = indexRows([row('Gurenge', 'LiSA', 238_000, 3)]);
    const q = { ...query(track(GURENGE)), trackId: GURENGE };
    expect(checkSources(q, { playlist, added: [log({ trackId: 9, title: 'Gurenge', durationMs: 90_000 })] })).toMatchObject({ source: 'playlist', tier: 'duplicate' });
    expect(checkSources(q, { playlist, added: [log({ trackId: 9, title: 'Gurenge', durationMs: 237_000 })] })).toMatchObject({ source: 'added', tier: 'duplicate' });
  });
});

const item = (p: Partial<ExportItem> & { key: string; trackId: number; title: string }): ExportItem => ({
  artist: 'LiSA', durationMs: 240_000, url: `https://music.apple.com/us/song/${p.trackId}`, label: p.key, ...p,
});
const playlist = indexRows([
  row('Gurenge', 'LiSA', 238_000, 1, 'LEO-NiNE'),
  row('Unravel', 'TK from Ling tosite sigure', 239_000, 2),
  row('Homura (TV Size)', 'LiSA', 90_000, 3),
  row('Bのリベンジ', 'B小町', 182_000, 4),
]);
const added = (p: Partial<AddedRecord> & { trackId: number; title: string }): AddedRecord => ({
  artist: 'LiSA', durationMs: 200_000, key: 'k', batchId: 'b1', addedAt: 0, ...p,
});

describe('planExport', () => {
  it('passes new songs through in order', () => {
    const plan = planExport([item({ key: 'a', trackId: 1, title: 'Shirushi' }), item({ key: 'b', trackId: 2, title: 'Catch the Moment' })], { playlist });
    expect(plan.add.map((i) => i.key)).toEqual(['a', 'b']);
    expect(plan.held).toEqual([]);
  });

  it('holds songs already in the playlist, with the row, tier and score', () => {
    const plan = planExport([item({ key: 'a', trackId: 1, title: 'GURENGE', durationMs: 240_000 })], { playlist });
    expect(plan.add).toEqual([]);
    expect(plan.held[0]).toMatchObject({ reason: 'in-playlist', overridable: true, hit: { tier: 'duplicate', source: 'playlist', row: { position: 1 } } });
    expect(plan.held[0]!.hit!.score).toBeGreaterThan(0.9);
    expect(plan.held[0]!.detail).toMatch(/^#1: Gurenge — LiSA/);
  });

  it('holds likely duplicates and other versions too', () => {
    const plan = planExport([
      item({ key: 'a', trackId: 1, title: 'Homura', durationMs: 270_000 }),
      item({ key: 'b', trackId: 2, title: 'Gurenge', durationMs: 250_000 }),
    ], { playlist });
    expect(plan.held.map((h) => [h.item.key, h.reason, h.hit?.tier])).toEqual([['a', 'other-version', 'other-version'], ['b', 'likely-in-playlist', 'likely-duplicate']]);
  });

  it('uses the alt titles: a native-titled row holds the translated catalog song', () => {
    // Artist "B小町" doesn't romanize to B-Komachi: the title alone is strong, but the artist disagrees → not held.
    const revenge = item({ key: 'r', trackId: 5, title: 'Revenge of B', artist: 'B KOMACHI RUBY(CV: YURIE IGOMA)', durationMs: 181_893, altTitles: ['B no Revenge', 'Bのリベンジ'], altArtists: ['B-Komachi'] });
    expect(planExport([revenge], { playlist }).add).toHaveLength(1);
    const pl2 = indexRows([row('Bのリベンジ', 'B-Komachi', 182_000, 4)]);
    expect(planExport([revenge], { playlist: pl2 }).held[0]).toMatchObject({ reason: 'in-playlist', hit: { tier: 'duplicate' } });
  });

  it('holds songs the app already added, by trackId or by name', () => {
    const log = [added({ trackId: 9, title: 'Shirushi' }), added({ trackId: 8, title: 'Catch the Moment', durationMs: 240_000 })];
    const plan = planExport([item({ key: 'a', trackId: 9, title: 'Shirushi' }), item({ key: 'b', trackId: 77, title: 'Catch the Moment' })], { added: log });
    expect(plan.held.map((h) => [h.item.key, h.reason])).toEqual([['a', 'already-added'], ['b', 'already-added']]);
    expect(plan.held[0]!.detail).toBe('same track');
  });

  it('drops repeats within one batch, with no override', () => {
    const plan = planExport([
      item({ key: 'a', trackId: 1, title: 'Shirushi', label: 'Show A OP1' }),
      item({ key: 'b', trackId: 1, title: 'Shirushi' }),
      item({ key: 'c', trackId: 2, title: 'shirushi!' }),
    ], { overrides: new Set(['b', 'c']) });
    expect(plan.add.map((i) => i.key)).toEqual(['a']);
    expect(plan.held.map((h) => [h.item.key, h.reason, h.overridable])).toEqual([['b', 'repeat-in-batch', false], ['c', 'repeat-in-batch', false]]);
    expect(plan.held[0]!.detail).toBe('same song as Show A OP1');
  });

  it('"add anyway" overrides a hold', () => {
    const plan = planExport([item({ key: 'a', trackId: 1, title: 'Gurenge' })], { playlist, overrides: new Set(['a']) });
    expect(plan.add.map((i) => i.key)).toEqual(['a']);
  });

  it('a different artist with the same title is not a duplicate', () => {
    const plan = planExport([item({ key: 'a', trackId: 1, title: 'Unravel', artist: 'Some Cover Band' })], { playlist });
    expect(plan.add).toHaveLength(1);
  });
});

describe('the synthetic top-10 openings export (Music.app format)', async () => {
  // Dynamic, untyped import: the app's tsconfig has no Node types.
  const fs = await import(/* @vite-ignore */ 'node:' + 'fs');
  const dir = new URL('./__fixtures__/playlists/', import.meta.url);
  const exp = JSON.parse(fs.readFileSync(new URL('top10-openings.expected.json', dir), 'utf8'));
  const parsed = parsePlaylist(fs.readFileSync(new URL('top10-openings.export.txt', dir)) as Uint8Array);
  const idx = indexRows(parsed.rows);

  it('parses as an unordered export, so it is used for duplicates only', () => {
    expect(parsed.rows).toHaveLength(exp.rowCount);
    expect(parsed.ordered).toBe(exp.ordered);
  });

  it('holds the exact duplicate, the native-title duplicate, and not the same-title cover', () => {
    const d = exp.duplicatePair, n = exp.nativeDuplicatePair, x = exp.notADuplicate;
    const items = [
      item({ key: 'dup', trackId: 1, title: d.title, artist: d.artist, durationMs: null }),
      // Frieren OP1: the US catalog says "Yuusha"; the theme carries the native 勇者.
      item({ key: 'native', trackId: 2, title: n.catalogTitle, artist: n.artist, durationMs: null, altTitles: [n.catalogTitle, n.playlistTitle], altArtists: [n.artist] }),
      item({ key: 'cover', trackId: 3, title: x.title, artist: x.artist, durationMs: null }),
    ];
    const plan = planExport(items, { playlist: idx });
    expect(plan.add.map((i) => i.key)).toEqual(['cover']);
    const byKey = new Map(plan.held.map((h) => [h.item.key, h]));
    expect(byKey.get('dup')).toMatchObject({ reason: 'in-playlist', hit: { tier: 'duplicate', row: { title: d.title, artist: d.artist } } });
    expect(['duplicate', 'likely-duplicate']).toContain(byKey.get('native')!.hit!.tier);
    expect(byKey.get('native')!.hit!.row.title).toBe(n.playlistTitle);
  });

  it('a real catalog track (Again — YUI, US store) is held against it', () => {
    expect(findDuplicate(idx, query(track(1537445612), theme(5114, 'OP1')))).toMatchObject({ tier: 'duplicate', row: { title: 'Again', artist: 'YUI' } });
  });
});

describe('performance', () => {
  // Deterministic pseudo-random romaji-ish titles and artists; a few common
  // English words too, so short titles collide the way real ones do.
  const syl = 'ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa n ga gi gu ge go'.split(' ');
  const common = 'again rain love blue fire dream star heart brave shine'.split(' ');
  let seed = 42;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
  const word = () => (rand(6) ? Array.from({ length: 2 + rand(3) }, () => syl[rand(syl.length)]).join('') : common[rand(common.length)]!);
  const title = () => Array.from({ length: 1 + rand(4) }, word).join(' ');
  const artist = () => `${word()} ${word()}`;
  const rows = Array.from({ length: 2000 }, (_, i) => row(title(), artist(), 150_000 + rand(150_000), i + 1));

  it('2,000 rows × 50 items in well under 100 ms (index + plan)', () => {
    const items = Array.from({ length: 50 }, (_, i) => {
      const hit = rows[i * 37]!;
      return item({
        key: `k${i}`, trackId: i, title: i % 5 ? title() : hit.title, artist: i % 5 ? artist() : hit.artist,
        durationMs: i % 5 ? 200_000 : hit.durationMs, altTitles: [title()], altArtists: [artist()],
      });
    });
    planExport(items.slice(0, 5), { playlist: indexRows(rows.slice(0, 50)) }); // warm up the JIT
    const t0 = performance.now();
    const plan = planExport(items, { playlist: indexRows(rows) });
    const ms = performance.now() - t0;
    expect(plan.add.length + plan.held.length).toBe(50);
    expect(plan.held.filter((h) => h.hit?.tier === 'duplicate').length).toBeGreaterThanOrEqual(10);
    expect(ms).toBeLessThan(100);
  });
});

describe('shortcutLine', () => {
  it('formats Title | Artist | URL and neutralizes separators', () => {
    expect(shortcutLine({ title: 'Gurenge', artist: 'LiSA', url: 'https://music.apple.com/us/song/1' })).toBe('Gurenge | LiSA | https://music.apple.com/us/song/1');
    expect(shortcutLine({ title: 'A|B', artist: 'C\nD', url: 'u' })).toBe('A / B | C D | u');
  });
});

describe('theme-level hits (playlist library links)', () => {
  const linked = (title: string, artist: string, durationMs: number, keys: string[]): PlaylistRow => ({ ...row(title, artist, durationMs), themeKeys: keys });

  it('a row linked to the same OP/ED is likely in the playlist, even when the names share nothing', () => {
    const idx = indexRows([linked('Yuusha', 'YOASOBI', 194_000, ['song:42'])]);
    const q: DupQuery = { key: 'song:42', title: 'The Brave', artist: 'YOASOBI (English ver.)', durationMs: 195_000 };
    expect(findDuplicate(idx, q)).toMatchObject({ tier: 'likely-duplicate', via: 'theme' });
    // Without the key the names alone don't meet.
    expect(findDuplicate(idx, { ...q, key: undefined })).toBeNull();
  });

  it('same OP/ED in another cut is another version; a stronger name match still wins', () => {
    const idx = indexRows([linked('Yuusha (TV Size)', 'YOASOBI', 90_000, ['song:42'])]);
    expect(findDuplicate(idx, { key: 'song:42', title: 'Brave', artist: 'X', durationMs: 194_000 })).toMatchObject({ tier: 'other-version', via: 'theme' });
    const idx2 = indexRows([linked('Yuusha', 'YOASOBI', 194_000, ['song:42'])]);
    expect(findDuplicate(idx2, { key: 'song:42', title: 'Yuusha', artist: 'YOASOBI', durationMs: 194_000 })).toMatchObject({ tier: 'duplicate', via: 'names' });
  });

  it('the export plan holds it back and says why; the add log carries its keys too', () => {
    const playlist = indexRows([linked('勇者', 'YOASOBI', 194_000, ['song:42'])]);
    const plan = planExport([item({ key: 'song:42', trackId: 5, title: 'Yuusha', artist: 'YOASOBI', durationMs: 194_000 })], { playlist });
    expect(plan.held[0]).toMatchObject({ reason: 'likely-in-playlist' });
    expect(plan.held[0]!.detail).toContain('linked to this song');
    const fromLog = checkSources({ key: 'song:42', title: 'Brave', artist: 'Z', durationMs: 194_000, trackId: 6 }, { added: [added({ trackId: 9, title: '勇者', key: 'song:42', durationMs: 194_000 })] });
    expect(fromLog).toMatchObject({ source: 'added', via: 'theme' });
  });
});

