import { describe, expect, it } from 'vitest';
import { EXPORT_HEADER, exportText, TAIL_ROWS, utf16be, utf16le } from './__fixtures__/tail';
import { decodeBytes, describeMapping, detectSort, parseDuration, parsePlaylist } from './playlistImport';

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
    const short = parsePlaylist(['Name\tArtist\tTime', 'Gurenge\tLiSA\t238', 'Uso\tSid'].join('\n'));
    expect(short.rows[1]).toMatchObject({ title: 'Uso', artist: 'Sid', durationMs: null });
    expect(short.warnings.join(' ')).toMatch(/1 row is missing the Name, Artist, Album or Time cell/);
  });

  it('is silent when rows only lack trailing columns it does not read (Location on streaming tracks)', () => {
    const lines = exportText(TAIL_ROWS.slice(0, 3), EXPORT_HEADER, '\r').split('\r');
    // Music.app drops the empty trailing Location cell: 31 header cells, 30 per row.
    const trimmed = [lines[0], ...lines.slice(1).map((l) => l.split('\t').slice(0, EXPORT_HEADER.length - 1).join('\t'))].join('\r');
    expect(trimmed.split('\r')[1]!.split('\t')).toHaveLength(30);
    const r = parsePlaylist(utf16le(trimmed));
    expect(r.rows).toHaveLength(3);
    expect(r.warnings).toEqual([]);
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

describe('parsePlaylist: Export Playlist shortcut text', () => {
  const doc = (titles: string[], artists?: string[] | null, durations?: string[] | null, eol = '\n', name = '🔥 AniSong MegaMix') => [
    'anisong-playlist v1', name,
    '---titles---', ...titles,
    ...(artists === null ? [] : ['---artists---', ...(artists ?? [])]),
    ...(durations === null ? [] : ['---durations---', ...(durations ?? [])]),
    '',
  ].join(eol);

  it('reads the parallel lists, the playlist name, and marks the rows unordered', () => {
    const r = parsePlaylist(doc(['Gurenge', 'unravel', '紅蓮華'], ['LiSA', 'TK from Ling tosite sigure', 'LiSA'], ['238', '239.4', '238']));
    expect(r).toMatchObject({ format: 'shortcut', playlistName: '🔥 AniSong MegaMix', ordered: false, artistsKnown: true, guessed: false, warnings: [] });
    expect(strip(r.rows)).toEqual([
      { title: 'Gurenge', artist: 'LiSA', album: '', durationMs: 238_000 },
      { title: 'unravel', artist: 'TK from Ling tosite sigure', album: '', durationMs: 239_400 },
      { title: '紅蓮華', artist: 'LiSA', album: '', durationMs: 238_000 },
    ]);
    expect(r.rows.map((x) => x.position)).toEqual([1, 2, 3]);
  });

  it('tolerates CRLF, a BOM, blank lines between sections, and leading blank lines', () => {
    const text = '\uFEFF\r\nanisong-playlist v1\r\nMy List\r\n---titles---\r\nGurenge\r\nUso\r\n\r\n\r\n---artists---\r\nLiSA\r\nSID\r\n\r\n---durations---\r\n3:58\r\n3:28\r\n';
    const r = parsePlaylist(text);
    expect(r.playlistName).toBe('My List');
    expect(strip(r.rows)).toEqual([
      { title: 'Gurenge', artist: 'LiSA', album: '', durationMs: 238_000 },
      { title: 'Uso', artist: 'SID', album: '', durationMs: 208_000 },
    ]);
    expect(r.warnings).toEqual([]);
    // Also as UTF-16 bytes, the way a file save might arrive.
    expect(parsePlaylist(utf16le(text.replace(/^\uFEFF/, ''))).rows).toHaveLength(2);
  });

  it('works without durations (missing or empty section)', () => {
    for (const durations of [null, []]) {
      const r = parsePlaylist(doc(['Gurenge', 'Uso'], ['LiSA', 'SID'], durations));
      expect(r.rows.map((x) => [x.title, x.artist, x.durationMs])).toEqual([['Gurenge', 'LiSA', null], ['Uso', 'SID', null]]);
      expect(r.warnings.join(' ')).toMatch(/No durations/);
      expect(r.mapping.time).toBeNull();
    }
  });

  it('accepts m:ss, h:mm:ss, fractional and suffixed seconds; unreadable ones are null', () => {
    const r = parsePlaylist(doc(['a', 'b', 'c', 'd', 'e', 'f'], ['x', 'x', 'x', 'x', 'x', 'x'], ['3:58', '1:02:03', '238.6', '238,5', '238 s', '?']));
    expect(r.rows.map((x) => x.durationMs)).toEqual([238_000, 3_723_000, 238_600, 238_500, 238_000, null]);
  });

  it('does not zip mismatched lists: artists are dropped for the snapshot, with a warning', () => {
    const r = parsePlaylist(doc(['Gurenge', 'Uso', 'Again'], ['LiSA', 'SID'], ['238', '208', '257']));
    expect(r.artistsKnown).toBe(false);
    expect(r.rows.map((x) => [x.title, x.artist, x.durationMs])).toEqual([['Gurenge', '', 238_000], ['Uso', '', 208_000], ['Again', '', 257_000]]);
    expect(r.warnings.join(' ')).toMatch(/3 titles but 2 artists/);
  });

  it('drops mismatched durations the same way', () => {
    const r = parsePlaylist(doc(['Gurenge', 'Uso'], ['LiSA', 'SID'], ['238']));
    expect(r.artistsKnown).toBe(true);
    expect(r.rows.map((x) => x.durationMs)).toEqual([null, null]);
    expect(r.warnings.join(' ')).toMatch(/2 titles but 1 durations/);
  });

  it('keeps empty titles as blank rows so the lists stay aligned', () => {
    const r = parsePlaylist(doc(['Gurenge', '', 'Uso'], ['LiSA', 'Mystery', 'SID'], ['238', '100', '208']));
    expect(r.rows.map((x) => [x.position, x.title, x.artist, x.durationMs])).toEqual([[1, 'Gurenge', 'LiSA', 238_000], [2, '', 'Mystery', 100_000], [3, 'Uso', 'SID', 208_000]]);
    expect(r.artistsKnown).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/1 song has no title; kept as blank rows/);
  });

  it('keeps a blank last artist or duration when the lists need it to line up', () => {
    const text = 'anisong-playlist v1\nX\n---titles---\nGurenge\nMystery\n\n---artists---\nLiSA\n\n\n---durations---\n238\n\n';
    const r = parsePlaylist(text);
    expect(r.rows.map((x) => [x.title, x.artist, x.durationMs])).toEqual([['Gurenge', 'LiSA', 238_000], ['Mystery', '', null]]);
    expect(r.artistsKnown).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/line up/);
  });

  it('handles a missing name line, missing sections and other versions', () => {
    const noName = parsePlaylist('anisong-playlist v1\n---titles---\nGurenge\n---artists---\nLiSA');
    expect(noName).toMatchObject({ playlistName: null, rows: [{ title: 'Gurenge', artist: 'LiSA' }] });
    const noTitles = parsePlaylist('anisong-playlist v1\nX\n---artists---\nLiSA');
    expect(noTitles.rows).toEqual([]);
    expect(noTitles.warnings.join(' ')).toMatch(/No ---titles---/);
    expect(parsePlaylist('anisong-playlist v2\nX\n---titles---\nA').warnings.join(' ')).toMatch(/version v2/);
    // Not the magic line: falls back to the tab/paste parser.
    expect(parsePlaylist('Anisong playlist\nGurenge').format).toBe('pasted');
  });
});

describe('sort detection (export order is the window sort)', () => {
  const rows = (titles: string[], artists = titles.map((_, i) => `Artist ${(i * 7) % 11}`)) =>
    titles.map((title, i) => ({ title, artist: artists[i]!, album: '' }));
  const names = ['Again', 'Uso', 'Gurenge', 'Hologram', 'Period', 'Rain', 'Let It Out', 'Tsunaida Te', 'RAY OF LIGHT', 'AIZO', 'TEST ME', 'Serenade', 'Inferno', 'Homura', 'unravel', 'Kaikai Kitan', 'Shirushi', 'Brave Shine', 'Lilac', 'Odd Future'];

  it('flags exports sorted by Name, either direction, case-insensitively', () => {
    const asc = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    expect(detectSort(rows(asc))).toMatchObject({ field: 'title', direction: 'asc' });
    expect(detectSort(rows([...asc].reverse()))).toMatchObject({ field: 'title', direction: 'desc' });
    // A couple of out-of-place rows (Music.app's collation differs a bit) still count.
    const noisy = [...asc].reverse();
    [noisy[3], noisy[4]] = [noisy[4]!, noisy[3]!];
    expect(detectSort(rows(noisy))?.field).toBe('title');
  });

  it('flags a sort by Artist even with many same-artist neighbours', () => {
    const artists = names.map((_, i) => `Artist ${String.fromCharCode(65 + Math.floor(i / 2))}`);
    expect(detectSort(rows(names, artists))).toMatchObject({ field: 'artist', direction: 'asc' });
  });

  it('leaves playlist order (and short lists) alone', () => {
    expect(detectSort(rows(names))).toBeNull();
    expect(detectSort(TAIL_ROWS)).toBeNull();
    expect(detectSort(rows(['A', 'B', 'C', 'D']))).toBeNull();
  });

  it('marks a sorted export ordered: false with a warning; playlist order stays ordered', () => {
    const sorted = [...TAIL_ROWS].sort((a, b) => b.title.toLowerCase().localeCompare(a.title.toLowerCase()));
    const r = parsePlaylist(utf16le(exportText(sorted)));
    expect(r.ordered).toBe(false);
    expect(r.sortedBy).toMatchObject({ field: 'title', direction: 'desc' });
    expect(r.warnings.join(' ')).toMatch(/sorted by Name .*not in playlist order.*Sort By → Playlist Order/);
    expect(parsePlaylist(utf16le(exportText(TAIL_ROWS)))).toMatchObject({ ordered: true, sortedBy: null, warnings: [] });
  });
});

describe('helpers', () => {
  it('parseDuration', () => {
    expect(parseDuration('238')).toBe(238_000);
    expect(parseDuration('3:58')).toBe(238_000);
    expect(parseDuration('3:58.5')).toBe(238_500);
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
 * { "rows" | "rowCount": 1234, "first": { "title": …, "artist": …, "durationSec"?: … }, "last": { … },
 *   "ordered"?: false, "sortedBy"?: "name-desc" }.
 */
describe('real exports in __fixtures__/playlists', async () => {
  // Dynamic, untyped import: the app's tsconfig has no Node types.
  const fs = await import(/* @vite-ignore */ 'node:' + 'fs');
  const dir = new URL('./__fixtures__/playlists/', import.meta.url);
  const files: string[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith('.txt')) : [];
  /** Expected-row spec: durationSec (whole seconds) or durationMs. */
  const rowSpec = ({ durationSec, ...rest }: { durationSec?: number; [k: string]: unknown }) =>
    durationSec === undefined ? rest : { ...rest, durationMs: durationSec * 1000 };
  /** <name>.expected.json next to <name>.txt or <name>.export.txt. */
  const expectedFor = (file: string) => {
    for (const name of [file.replace(/\.txt$/, '.expected.json'), file.replace(/(?:\.export)?\.txt$/, '.expected.json')]) {
      const url = new URL(name, dir);
      if (fs.existsSync(url)) return JSON.parse(fs.readFileSync(url, 'utf8'));
    }
    return null;
  };

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
    // No false "short row" alarm: Music.app drops the trailing Location cell for streaming tracks.
    expect(r.warnings.join(' ')).not.toMatch(/missing the Name/);
    const exp = expectedFor(file);
    if (exp) {
      const count = exp.rowCount ?? exp.rows;
      if (count !== undefined) expect(r.rows).toHaveLength(count);
      if (exp.first) expect(r.rows[0]).toMatchObject(rowSpec(exp.first));
      if (exp.last) expect(r.rows.at(-1)).toMatchObject(rowSpec(exp.last));
      if (exp.ordered !== undefined) expect(r.ordered).toBe(exp.ordered);
      if (exp.sortedBy !== undefined) {
        // "name-desc" → { field: 'title', direction: 'desc' }; null → not sorted.
        const [col, direction] = (exp.sortedBy ?? '').split('-');
        expect(r.sortedBy ?? null).toEqual(exp.sortedBy ? expect.objectContaining({ field: { name: 'title', artist: 'artist', album: 'album' }[col as string], direction }) : null);
      }
    }
  });
});
