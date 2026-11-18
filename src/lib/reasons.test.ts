import { describe, expect, it } from 'vitest';
import type { DupHit } from './dedupe';
import { haveReasons, matchReasons } from './reasons';

const theme = { songTitle: 'Golden Time Lover', artists: ['Sukima Switch'], artistsNative: [] };
const cand = (p: Partial<{ flags: string[]; titleSim: number; artistSim: number; isStreamable: boolean | null }> = {}) => ({
  flags: (p.flags ?? []) as never[], titleSim: p.titleSim ?? 1, artistSim: p.artistSim ?? 1, track: { isStreamable: p.isStreamable ?? true },
});
const labels = (rs: { label: string }[]) => rs.map((r) => r.label);

describe('matchReasons', () => {
  it('a clean match: artist matches, full version', () => {
    expect(matchReasons(theme, cand())).toEqual([{ label: 'artist matches', tone: 'ok' }, { label: 'full version', tone: 'neutral' }]);
  });
  it('a translated title in this store', () => {
    const r = matchReasons(theme, cand({ titleSim: 0.3, artistSim: 0.95 }));
    expect(labels(r)).toEqual(['artist matches', 'title differs', 'full version']);
    expect(r[1]!.tone).toBe('warn');
  });
  it('a slight spelling difference', () => {
    expect(labels(matchReasons(theme, cand({ titleSim: 0.7 })))).toContain('title differs slightly');
  });
  it('a different artist, unless the cover flag already says so', () => {
    expect(labels(matchReasons(theme, cand({ artistSim: 0.2 })))).toContain('different artist');
    const cover = labels(matchReasons(theme, cand({ artistSim: 0.2, flags: ['cover'] })));
    expect(cover).toContain('cover?');
    expect(cover).not.toContain('different artist');
  });
  it('a similar artist (alias or romaji spelling)', () => {
    expect(labels(matchReasons(theme, cand({ artistSim: 0.7 })))).toContain('artist similar');
  });
  it('no artist on AnimeThemes', () => {
    expect(labels(matchReasons({ ...theme, artists: [] }, cand({ artistSim: 0.5 })))).toEqual(['no artist on AnimeThemes', 'full version']);
  });
  it('TV size and full version follow the flags and the TV-size preference', () => {
    expect(matchReasons(theme, cand({ flags: ['tv'] }))).toContainEqual({ label: 'TV size', tone: 'neutral' });
    expect(matchReasons(theme, cand({ flags: ['tv'] }), { preferTvSize: true })).toContainEqual({ label: 'TV size', tone: 'ok' });
    expect(labels(matchReasons(theme, cand(), { preferTvSize: true }))).toContain('full version, not TV size');
    // A live cut is neither "full version" nor TV size.
    const live = labels(matchReasons(theme, cand({ flags: ['live'] })));
    expect(live).toContain('live');
    expect(live).not.toContain('full version');
  });
  it('soundtrack album, karaoke, not streamable', () => {
    const r = labels(matchReasons(theme, cand({ flags: ['soundtrack', 'karaoke'], isStreamable: false })));
    expect(r).toEqual(expect.arrayContaining(['soundtrack album', 'karaoke', 'not streamable']));
  });
  it('your pick and AnimeThemes links come first', () => {
    expect(labels(matchReasons(theme, cand(), { userPicked: true, linked: true })).slice(0, 2)).toEqual(['your pick', 'linked on AnimeThemes']);
  });
});

describe('haveReasons', () => {
  const hit = (p: Partial<DupHit> = {}): DupHit => ({
    source: 'playlist', tier: 'duplicate', score: 1, titleSim: 1, artistSim: 1, durationDeltaMs: 3000,
    row: { position: 212, title: 'Again', artist: 'YUI', album: 'GREEN GARDEN POP', durationMs: 255_000 }, ...p,
  });
  it('same title and artist, different album, 3 s longer', () => {
    expect(labels(haveReasons(hit(), { collectionName: 'again - EP', trackTimeMillis: 258_000 }))).toEqual(['same title and artist', 'different album', 'match 3 s longer']);
  });
  it('same album ignores the Single / EP suffix; same length within a second', () => {
    expect(labels(haveReasons(hit({ row: { position: 1, title: 'Again', artist: 'YUI', album: 'again', durationMs: 255_400 } }), { collectionName: 'again - Single', trackTimeMillis: 255_000 })))
      .toEqual(['same title and artist', 'same album', 'same length']);
  });
  it('a likely hit: similar title, unknown artist, no album', () => {
    expect(labels(haveReasons(hit({ tier: 'likely-duplicate', titleSim: 0.8, artistSim: null, row: { position: 3, title: 'Agian', artist: '', album: '', durationMs: null } }))))
      .toEqual(['similar title · 80%', 'artist unknown']);
  });
  it('another version: a big length gap is a warning', () => {
    const r = haveReasons(hit({ tier: 'other-version' }), { collectionName: 'x', trackTimeMillis: 90_000 });
    expect(labels(r)).toContain('another version');
    expect(r.find((x) => x.label.startsWith('match'))).toEqual(expect.objectContaining({ label: 'match 165 s shorter', tone: 'warn' }));
  });
  it('the app added this exact track', () => {
    expect(labels(haveReasons(hit({ source: 'added', sameTrack: true })))).toEqual(['same Apple Music track, added by the app']);
    expect(labels(haveReasons(hit({ source: 'added' })))[0]).toBe('added by the app earlier');
  });
});
