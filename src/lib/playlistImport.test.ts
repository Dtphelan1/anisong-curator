import { describe, expect, it } from 'vitest';
import { EXPORT_HEADER, exportText, TAIL_ROWS, utf16be, utf16le } from './__fixtures__/tail';
import { decodeBytes, describeMapping, parseDuration, parsePlaylist } from './playlistImport';

const strip = <T extends { position: number }>(rows: T[]) => rows.map(({ position: _p, ...r }) => r);

describe('parsePlaylist: Music.app export', () => {
  const text = exportText(TAIL_ROWS);

  it('reads UTF-16LE with a BOM and CR line endings (what Music.app writes)', () => {
    const bytes = utf16le(text);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
    const r = parsePlaylist(bytes.buffer as ArrayBuffer);
    expect(r).toMatchObject({ format: 'export', guessed: false, encoding: 'utf-16le', warnings: [] });
    expect(r.rows).toHaveLength(TAIL_ROWS.length);
    expect(r.rows.map((x) => x.position)).toEqual(TAIL_ROWS.map((_, i) => i + 1));
    // Time is whole seconds in the export.
    expect(strip(r.rows)).toEqual(TAIL_ROWS.map(({ title, artist, album, durationMs }) => ({ title, artist, album, durationMs: Math.round(durationMs! / 1000) * 1000 })));
  });

  it('keeps native-script and punctuation-heavy names intact', () => {
    const r = parsePlaylist(utf16le(exportText([{ title: 'ゴールデンタイムラバー', artist: 'スキマスイッチ', album: '【推しの子】 "Vol.5"', durationMs: 369_000 }])));
    expect(r.rows[0]).toMatchObject({ title: 'ゴールデンタイムラバー', artist: 'スキマスイッチ', album: '【推しの子】 "Vol.5"', durationMs: 369_000 });
  });

  it('reads UTF-8 with CRLF, with and without a BOM', () => {
    const crlf = exportText(TAIL_ROWS.slice(0, 3), EXPORT_HEADER, '\r\n');
    const enc = new TextEncoder().encode(crlf);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc]);
    for (const input of [enc, withBom]) {
      const r = parsePlaylist(input);
      expect(r.format).toBe('export');
      expect(r.encoding).toBe('utf-8');
      expect(r.rows.map((x) => x.title)).toEqual(['Again', 'Personal', 'Golden Time Rubber']);
      expect(r.rows[2]!.artist).toBe('Sukimaswitch'); // no stray \r
    }
  });

  it('reads UTF-16BE with a BOM and UTF-16LE without one; LF endings', () => {
    const lf = exportText(TAIL_ROWS.slice(0, 2), EXPORT_HEADER, '\n');
    expect(parsePlaylist(utf16be(lf))).toMatchObject({ encoding: 'utf-16be', rows: [{ title: 'Again' }, { title: 'Personal' }] });
    const noBom = parsePlaylist(utf16le(lf, false));
    expect(noBom.encoding).toMatch(/utf-16le/);
    expect(noBom.rows.map((x) => x.title)).toEqual(['Again', 'Personal']);
  });

  it('accepts a pasted export (string with BOM)', () => {
    const r = parsePlaylist('﻿' + exportText(TAIL_ROWS.slice(0, 2)));
    expect(r).toMatchObject({ format: 'export', rows: [{ title: 'Again', artist: 'YUI', album: 'again - EP', durationMs: 258_000 }, { title: 'Personal' }] });
  });

  it('finds columns by name in any order and ignores unknown ones', () => {
    const header = ['Location', 'Time', 'Weird Column', 'Album', 'Name', 'Genre', 'Artist'];
    const text = [header.join('\t'), ['/x.m4a', '238', '?', 'Gurenge - EP', 'Gurenge', 'Anime', 'LiSA'].join('\t')].join('\r');
    const r = parsePlaylist(text);
    expect(r.mapping).toEqual({ title: 4, artist: 6, album: 3, time: 1 });
    expect(strip(r.rows)).toEqual([{ title: 'Gurenge', artist: 'LiSA', album: 'Gurenge - EP', durationMs: 238_000 }]);
  });

  it('reads localized headers (Japanese)', () => {
    const r = parsePlaylist(['名前\tアーティスト\tアルバム\t時間', '紅蓮華\tLiSA\t紅蓮華\t239'].join('\r'));
    expect(r).toMatchObject({ format: 'export', rows: [{ title: '紅蓮華', artist: 'LiSA', album: '紅蓮華', durationMs: 239_000 }] });
  });

  it('warns about missing columns and short rows instead of failing', () => {
    const r = parsePlaylist(['Name\tGenre\tKind\tPlays', 'Gurenge\tAnime\tAAC\t3', 'Uso'].join('\n'));
    expect(r.format).toBe('export');
    expect(r.rows.map((x) => [x.title, x.artist, x.durationMs])).toEqual([['Gurenge', '', null], ['Uso', '', null]]);
    expect(r.warnings.join(' ')).toMatch(/No "Artist" column/);
    expect(r.warnings.join(' ')).toMatch(/No "Time" column/);
    expect(r.warnings.join(' ')).toMatch(/fewer columns/);
  });

  it('skips blank lines and rows without a title', () => {
    const r = parsePlaylist(['Name\tArtist\tTime', '', 'Gurenge\tLiSA\t238', '\tNobody\t100', '\t\t', 'Uso\tSid\t208', ''].join('\r'));
    expect(r.rows.map((x) => [x.position, x.title])).toEqual([[1, 'Gurenge'], [2, 'Uso']]);
    expect(r.warnings.join(' ')).toMatch(/Skipped 1 row/);
  });

  it('falls back to a guessed title column when the header has no Name', () => {
    const r = parsePlaylist(['Song Name\tArtist\tAlbum\tTime', 'Gurenge\tLiSA\tGurenge - EP\t238'].join('\r'));
    expect(r.guessed).toBe(true);
    expect(r.rows[0]).toMatchObject({ title: 'Gurenge', artist: 'LiSA' });
    expect(r.warnings[0]).toMatch(/No "Name" column/);
  });
});

describe('parsePlaylist: pasted ⌘C rows', () => {
  it('guesses Name / Time (m:ss) / Artist / Album in the default list view', () => {
    const text = [
      'Gurenge\t3:58\tLiSA\tGurenge - EP\tAnime\t3',
      'Golden Time Rubber\t6:09\tSukimaswitch\tNayuta To Fukashigi\tJ-Pop\t',
      'Revenge of B\t3:01\tB KOMACHI RUBY(CV: YURIE IGOMA)\tSong from Tv Series "【Oshi No Ko】 " Vol.5\tAnime\t12',
    ].join('\r');
    const r = parsePlaylist(text);
    expect(r).toMatchObject({ format: 'pasted', guessed: true, mapping: { title: 0, time: 1, artist: 2, album: 3 } });
    expect(strip(r.rows)).toEqual([
      { title: 'Gurenge', artist: 'LiSA', album: 'Gurenge - EP', durationMs: 238_000 },
      { title: 'Golden Time Rubber', artist: 'Sukimaswitch', album: 'Nayuta To Fukashigi', durationMs: 369_000 },
      { title: 'Revenge of B', artist: 'B KOMACHI RUBY(CV: YURIE IGOMA)', album: 'Song from Tv Series "【Oshi No Ko】 " Vol.5', durationMs: 181_000 },
    ]);
    expect(describeMapping(r.mapping)).toBe('Name = column 1, Time = column 2, Artist = column 3, Album = column 4');
  });

  it('handles a custom view: leading track number, Time at the end, numbers skipped', () => {
    const text = ['1\tAgain\tYUI\t2009\tagain - EP\t4:18', '2\tUso\tSid\t2009\tUso - Single\t3:28', '3\tRain\tSid\t2010\tRain - Single\t4:16'].join('\n');
    const r = parsePlaylist(text);
    expect(r.mapping.title).toBe(1);
    expect(r.mapping.time).toBe(5);
    // Nothing after Time: Artist/Album are the next text columns anywhere.
    expect(r.rows[0]).toMatchObject({ title: 'Again', artist: 'YUI', album: 'again - EP', durationMs: 258_000 });
  });

  it('works without a time column, and says so', () => {
    const r = parsePlaylist('Gurenge\tLiSA\tGurenge - EP\nUso\tSid\tUso - Single');
    expect(r.rows[1]).toMatchObject({ title: 'Uso', artist: 'Sid', album: 'Uso - Single', durationMs: null });
    expect(r.warnings.join(' ')).toMatch(/No m:ss time column/);
  });

  it('reads untabbed lines as titles, with a warning', () => {
    const r = parsePlaylist('Gurenge\nUso');
    expect(r.rows.map((x) => x.title)).toEqual(['Gurenge', 'Uso']);
    expect(r.warnings.join(' ')).toMatch(/No tabs found/);
  });

  it('returns nothing for empty input', () => {
    expect(parsePlaylist('  \r\n\r\n')).toMatchObject({ format: 'empty', rows: [] });
    expect(parsePlaylist(new Uint8Array([0xff, 0xfe]))).toMatchObject({ format: 'empty', rows: [] });
  });
});

describe('helpers', () => {
  it('parseDuration', () => {
    expect(parseDuration('238')).toBe(238_000);
    expect(parseDuration('3:58')).toBe(238_000);
    expect(parseDuration('1:02:03')).toBe(3_723_000);
    expect(parseDuration('238', false)).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('n/a')).toBeNull();
  });

  it('decodeBytes treats odd bytes as UTF-8 without crashing', () => {
    expect(decodeBytes(new TextEncoder().encode('héllo')).text).toBe('héllo');
    expect(decodeBytes(new Uint8Array([0xfe, 0xff, 0x00])).text).toBe('');
  });
});

/*
 * Drop real exports into __fixtures__/playlists/*.txt (as saved by Music.app,
 * untouched) and they are parsed here. Optional sibling <name>.expected.json:
 * { "rows": 1234, "first": { "title": …, "artist": … }, "last": { … } }.
 */
describe('real exports in __fixtures__/playlists', async () => {
  // Dynamic, untyped import: the app's tsconfig has no Node types.
  const fs = await import(/* @vite-ignore */ 'node:' + 'fs');
  const dir = new URL('./__fixtures__/playlists/', import.meta.url);
  const files: string[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith('.txt')) : [];

  it.each(files.length ? files : ['(none)'])('%s', (file) => {
    if (file === '(none)') return;
    const bytes: Uint8Array = fs.readFileSync(new URL(file, dir));
    const r = parsePlaylist(bytes);
    expect(r.format).toBe('export');
    expect(r.guessed).toBe(false);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.title && !/[\r\n\t﻿]/.test(x.title + x.artist + x.album))).toBe(true);
    expect(r.rows.filter((x) => x.artist).length / r.rows.length).toBeGreaterThan(0.9);
    expect(r.rows.filter((x) => x.durationMs).length / r.rows.length).toBeGreaterThan(0.9);
    const expectedUrl = new URL(file.replace(/\.txt$/, '.expected.json'), dir);
    if (fs.existsSync(expectedUrl)) {
      const exp = JSON.parse(fs.readFileSync(expectedUrl, 'utf8'));
      if (exp.rows !== undefined) expect(r.rows).toHaveLength(exp.rows);
      if (exp.first) expect(r.rows[0]).toMatchObject(exp.first);
      if (exp.last) expect(r.rows.at(-1)).toMatchObject(exp.last);
    }
  });
});
