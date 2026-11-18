import { describe, expect, it } from 'vitest';
import type { Theme } from '../types';
import type { ItunesTrack } from './itunes';
import { parseAppleMusicUrl } from './itunes';
import { coreTitle, dice, planSearches, scoreTrack, splitArtists, trackFlags } from './matcher';

const theme = (p: Partial<Theme>): Theme => ({
  slug: 'OP1', anilistId: 1, kind: 'OP', sequence: 1, songId: 1, songTitle: 'Gurenge', songTitleNative: null,
  artists: ['LiSA'], artistsNative: [], episodes: null, appleMusicUrl: null, source: 'animethemes', ...p,
});
const track = (p: Partial<ItunesTrack>): ItunesTrack => ({
  trackId: 1, trackName: 'Gurenge', artistName: 'LiSA', collectionName: 'Gurenge - EP', collectionId: 1,
  trackTimeMillis: 240_000, previewUrl: null, trackViewUrl: '', artworkUrl100: null, isStreamable: true,
  country: 'us', trackNumber: 1, trackCount: 1, releaseDate: null, ...p,
});

describe('normalization', () => {
  it.each([
    ['Gurenge (TV Version)', 'gurenge'],
    ['Gurenge - From THE FIRST TAKE', 'gurenge'],
    ['From the Edge (feat. LiSA)', 'from the edge'],
    ['スキキライも追い越して ～朱音ver.～', 'スキキライも追い越して'],
    ['Kasuka na Hana (OP Theme to Hell\'s Paradise) [feat. BABYMETAL]', 'kasuka na hana'],
    ['ＡＩＺＯ', 'aizo'],
  ])('coreTitle(%s) = %s', (input, expected) => expect(coreTitle(input)).toBe(expected));

  it('dice ignores spacing and handles CJK', () => {
    expect(dice('kasuka na hana', 'kasukana hana')).toBe(1);
    expect(dice('よあけのうた', 'よあけのうた')).toBe(1);
    expect(dice('gurenge', 'unravel')).toBeLessThan(0.2);
  });

  it('splits collaborators and strips CV credits', () => {
    expect(splitArtists('Tatsuya Kitani & BABYMETAL')).toEqual(['Tatsuya Kitani', 'BABYMETAL']);
    expect(splitArtists('Yui Hirasawa (CV: Aki Toyosaki), Mio Akiyama')).toEqual(['Yui Hirasawa', 'Mio Akiyama']);
  });
});

describe('trackFlags', () => {
  it.each([
    ['Gurenge (TV Version)', 'Gurenge - EP', ['tv']],
    ['Gurenge - From THE FIRST TAKE', 'x', ['firstTake']],
    ['Golden Time Lover (From "Fullmetal Alchemist Brotherhood")', 'Golden', ['cover']],
    ['Unravel', 'Anime Karaoke Hits', ['karaoke']],
    ['Inferno', 'Promare (Original Soundtrack)', ['soundtrack']],
    ['Kasuka na Hana (OP Theme to Hell\'s Paradise)', 'x', []],
  ])('%s / %s', (trackName, collectionName, flags) => {
    expect(trackFlags({ trackName, collectionName }).sort()).toEqual([...flags].sort());
  });
});

describe('scoreTrack', () => {
  const ctx = { theme: theme({}), animeTitles: ['Kimetsu no Yaiba'] };
  it('ranks the original above TV size, covers, and karaoke', () => {
    const original = scoreTrack(ctx, track({}));
    const tv = scoreTrack(ctx, track({ trackName: 'Gurenge (TV Version)' }));
    const cover = scoreTrack(ctx, track({ trackName: 'Gurenge (From "Demon Slayer")', artistName: 'Some Cover Band' }));
    const karaoke = scoreTrack(ctx, track({ collectionName: 'Karaoke Anime Hits' }));
    expect(original.score).toBeGreaterThan(tv.score);
    expect(tv.score).toBeGreaterThan(cover.score);
    expect(original.score).toBeGreaterThan(karaoke.score);
    expect(original.score).toBeGreaterThanOrEqual(0.9);
  });
  it('prefers TV size when asked', () => {
    const original = scoreTrack(ctx, track({}), { preferTvSize: true });
    const tv = scoreTrack(ctx, track({ trackName: 'Gurenge (TV Version)' }), { preferTvSize: true });
    expect(tv.score).toBeGreaterThan(original.score);
  });
  it('matches native titles and artists', () => {
    const c = { theme: theme({ songTitle: 'Yoake no Uta', songTitleNative: 'よあけのうた', artists: ['jo0ji'] }), animeTitles: [] };
    expect(scoreTrack(c, track({ trackName: 'よあけのうた', artistName: 'jo0ji' })).score).toBeGreaterThan(0.85);
  });
  it('a weak title cannot be rescued by the artist', () => {
    expect(scoreTrack(ctx, track({ trackName: 'Homura' })).score).toBeLessThan(0.55);
  });
});

describe('planSearches', () => {
  it('goes romaji+artist → title → JP native', () => {
    const t = theme({ songTitle: 'Yoake no Uta', songTitleNative: 'よあけのうた', artists: ['jo0ji'] });
    expect(planSearches(t, 'us')).toEqual([
      { term: 'Yoake no Uta jo0ji', country: 'us' },
      { term: 'Yoake no Uta', country: 'us' },
      { term: 'よあけのうた jo0ji', country: 'jp' },
      { term: 'よあけのうた', country: 'jp' },
    ]);
  });
  it('tries the native title alone when native title + romaji artist finds nothing', () => {
    const t = theme({ songTitle: 'Kore Koi Itare Ai', songTitleNative: '来れ恋・至れ愛', artists: ['Rentarou Family'] });
    expect(planSearches(t, 'us').slice(-2)).toEqual([
      { term: '来れ恋・至れ愛 Rentarou Family', country: 'jp' },
      { term: '来れ恋・至れ愛', country: 'jp' },
    ]);
  });
  it('uses the anime title when the artist is unknown', () => {
    expect(planSearches(theme({ songTitle: 'Inferno', artists: [] }), 'us', ['Promare'])).toEqual([
      { term: 'Inferno', country: 'us' },
      { term: 'Inferno Promare', country: 'us' },
    ]);
  });
});

describe('parseAppleMusicUrl', () => {
  it.each([
    ['https://music.apple.com/jp/song/1830210171', { kind: 'song', id: 1830210171 }],
    ['https://music.apple.com/us/song/finis-teller/1830210171', { kind: 'song', id: 1830210171 }],
    ['https://music.apple.com/us/album/gurenge/1529543131?i=1529543135&uo=4', { kind: 'song', id: 1529543135 }],
    ['https://music.apple.com/jp/album/1787113451', { kind: 'album', id: 1787113451 }],
    ['https://itunes.apple.com/us/album/x/id1529543131?i=1529543135', { kind: 'song', id: 1529543135 }],
    ['1529543135', { kind: 'song', id: 1529543135 }],
    ['https://open.spotify.com/track/abc', null],
    ['not a url', null],
  ])('%s', (input, expected) => expect(parseAppleMusicUrl(input)).toEqual(expected));
});
