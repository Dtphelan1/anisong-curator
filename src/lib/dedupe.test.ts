import { describe, expect, it } from 'vitest';
import { planExport, shortcutLine, type AddedRecord, type ExportItem } from './dedupe';
import { indexPlaylist } from './tailInference';

const item = (p: Partial<ExportItem> & { key: string; trackId: number; title: string }): ExportItem => ({
  artist: 'LiSA', durationMs: 240_000, url: `https://music.apple.com/us/song/${p.trackId}`, label: p.key, ...p,
});
const playlist = indexPlaylist([
  { position: 1, title: 'Gurenge', artist: 'LiSA', album: 'LEO-NiNE', durationMs: 238_000 },
  { position: 2, title: 'Unravel', artist: 'TK from Ling tosite sigure', album: 'Fantastic Magic', durationMs: 239_000 },
  { position: 3, title: 'Homura (TV Size)', artist: 'LiSA', album: 'x', durationMs: 90_000 },
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

  it('holds songs already in the playlist (±3 s), case- and punctuation-insensitive', () => {
    const plan = planExport([item({ key: 'a', trackId: 1, title: 'GURENGE', durationMs: 240_000 })], { playlist });
    expect(plan.add).toEqual([]);
    expect(plan.held[0]).toMatchObject({ reason: 'in-playlist', overridable: true });
    expect(plan.held[0]!.detail).toMatch(/^#1: Gurenge/);
  });

  it('holds other versions (TV size vs full) separately', () => {
    const plan = planExport([item({ key: 'a', trackId: 1, title: 'Homura', durationMs: 270_000 })], { playlist });
    expect(plan.held[0]?.reason).toBe('other-version');
  });

  it('holds songs the app already added, by trackId or by name', () => {
    const log = [added({ trackId: 9, title: 'Shirushi' }), added({ trackId: 8, title: 'Catch the Moment', durationMs: 240_000 })];
    const plan = planExport([item({ key: 'a', trackId: 9, title: 'Shirushi' }), item({ key: 'b', trackId: 77, title: 'Catch the Moment' })], { added: log });
    expect(plan.held.map((h) => [h.item.key, h.reason])).toEqual([['a', 'already-added'], ['b', 'already-added']]);
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

describe('shortcutLine', () => {
  it('formats Title | Artist | URL and neutralizes separators', () => {
    expect(shortcutLine({ title: 'Gurenge', artist: 'LiSA', url: 'https://music.apple.com/us/song/1' })).toBe('Gurenge | LiSA | https://music.apple.com/us/song/1');
    expect(shortcutLine({ title: 'A|B', artist: 'C\nD', url: 'u' })).toBe('A / B | C D | u');
  });
});
