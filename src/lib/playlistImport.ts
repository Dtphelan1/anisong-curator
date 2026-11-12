/**
 * Playlist import (SPEC §9.5/§9.6): parse what Music.app gives you.
 *
 * 1. **Export** — File → Library → Export Playlist… → Plain Text. Tab-separated
 *    with a header row (Name, Artist, Composer, Album, …, Time, …, Location).
 *    Usually UTF-16LE with a BOM and CR line endings. `Time` is in seconds.
 *    Columns are found by header name: the set and order vary by version and
 *    locale.
 * 2. **Pasted rows** — ⌘C on selected songs. No header; the columns are
 *    whatever the list view shows (typically Name, Time, Artist, Album, …)
 *    with Time as m:ss. The mapping is guessed and reported as such.
 */

export interface PlaylistRow {
  /** 1-based position in the playlist (row order). */
  position: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number | null;
}

export type ColumnField = 'title' | 'artist' | 'album' | 'time';
export type ColumnMapping = Record<ColumnField, number | null>;

export interface ParseResult {
  rows: PlaylistRow[];
  warnings: string[];
  format: 'export' | 'pasted' | 'empty';
  /** True when columns were inferred from the data rather than a header. */
  guessed: boolean;
  /** Column index per field (0-based), null when not found. */
  mapping: ColumnMapping;
  /** Header cells, when there was a header. */
  header: string[] | null;
  /** Detected text encoding (for byte input). */
  encoding: string;
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

/**
 * Decode an export file. Honors a BOM (UTF-16LE/BE, UTF-8); without one,
 * sniffs UTF-16 from NUL bytes (ASCII-heavy text in UTF-16 has a NUL in every
 * other byte), else UTF-8.
 */
export function decodeBytes(input: ArrayBuffer | Uint8Array): { text: string; encoding: string } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2];
  if (b0 === 0xff && b1 === 0xfe) return { text: utf16(bytes.subarray(2), true), encoding: 'utf-16le' };
  if (b0 === 0xfe && b1 === 0xff) return { text: utf16(bytes.subarray(2), false), encoding: 'utf-16be' };
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };

  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let evenNul = 0, oddNul = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? oddNul++ : evenNul++);
  const half = sample.length / 2;
  if (half && oddNul / half > 0.3 && evenNul / half < 0.05) return { text: utf16(bytes, true), encoding: 'utf-16le (no BOM)' };
  if (half && evenNul / half > 0.3 && oddNul / half < 0.05) return { text: utf16(bytes, false), encoding: 'utf-16be (no BOM)' };
  return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
}

/** UTF-16 without relying on TextDecoder('utf-16be') support. */
function utf16(bytes: Uint8Array, littleEndian: boolean): string {
  const even = bytes.length - (bytes.length % 2);
  if (littleEndian) return new TextDecoder('utf-16le').decode(bytes.subarray(0, even));
  const swapped = new Uint8Array(even);
  for (let i = 0; i < even; i += 2) { swapped[i] = bytes[i + 1]!; swapped[i + 1] = bytes[i]!; }
  return new TextDecoder('utf-16le').decode(swapped);
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

/**
 * Header names per field. English is what Music.app writes on an English
 * system; the others are best-effort for localized exports. Matched
 * case-insensitively on the whole cell, so "Album Artist" ≠ "Album".
 */
const HEADER_NAMES: Record<ColumnField, string[]> = {
  title: ['name', 'title', 'song', 'nom', 'titel', 'nombre', 'título', 'titolo', 'nome', '名前', 'タイトル', '曲名', '이름', '名称'],
  artist: ['artist', 'künstler', 'interpret', 'artiste', 'artista', 'アーティスト', '아티스트', '艺人', '藝人', '歌手'],
  album: ['album', 'álbum', 'albumtitel', 'アルバム', '앨범', '专辑', '專輯'],
  time: ['time', 'duration', 'length', 'dauer', 'zeit', 'durée', 'duración', 'durata', 'duração', '時間', '長さ', '시간', '时间', '時長'],
};
/** Other Music.app export headers: their presence also marks a header row. */
const OTHER_HEADERS = new Set(
  ['composer', 'grouping', 'work', 'movement number', 'movement count', 'movement name', 'genre', 'size', 'disc number', 'disc count',
    'track number', 'track count', 'year', 'date modified', 'date added', 'bit rate', 'sample rate', 'volume adjustment', 'kind',
    'equalizer', 'comments', 'plays', 'last played', 'skips', 'last skipped', 'my rating', 'location'],
);

const cellKey = (s: string) => s.normalize('NFKC').trim().toLowerCase();

function headerMapping(cells: string[]): { mapping: ColumnMapping; known: number } | null {
  const keys = cells.map(cellKey);
  const mapping: ColumnMapping = { title: null, artist: null, album: null, time: null };
  let known = 0;
  for (const field of Object.keys(HEADER_NAMES) as ColumnField[]) {
    const i = keys.findIndex((k) => HEADER_NAMES[field].includes(k));
    if (i >= 0) { mapping[field] = i; known++; }
  }
  const others = keys.filter((k) => OTHER_HEADERS.has(k)).length;
  // A header needs two field names, or one plus other known export columns.
  if (known >= 2 || (known >= 1 && others >= 2)) return { mapping, known: known + others };
  return null;
}

/** "3:58" / "1:02:03" → ms. */
function parseClock(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

/** Export: whole seconds ("238"), sometimes m:ss. */
export function parseDuration(raw: string | undefined, plainNumberIsSeconds = true): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const clock = parseClock(s);
  if (clock !== null) return clock;
  if (plainNumberIsSeconds && /^\d+(?:[.,]\d+)?$/.test(s)) {
    const sec = Number(s.replace(',', '.'));
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null;
  }
  return null;
}

const CLOCK = /^(?:\d+:)?\d{1,3}:\d{2}$/;
const NUMERIC = /^[-+]?\d+(?:[.,]\d+)?(?:\s*(?:kbps|khz|mb|kb|%))?$/i;
const DATE_LIKE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b|^\d{1,2}:\d{2}\s*(?:am|pm)?$/i;
const RATING = /^[★☆✩✭\s]+$/;

function columnStats(rows: string[][], width: number) {
  return Array.from({ length: width }, (_, c) => {
    let filled = 0, clock = 0, text = 0;
    for (const r of rows) {
      const v = (r[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (CLOCK.test(v)) clock++;
      else if (!NUMERIC.test(v) && !DATE_LIKE.test(v) && !RATING.test(v)) text++;
    }
    const n = rows.length || 1;
    return { filled: filled / n, clock: filled ? clock / filled : 0, text: filled ? text / filled : 0 };
  });
}

/**
 * Headerless rows: Time is the column that is mostly m:ss; Name is the first
 * text column (column 0 in the default view); Artist and Album are the next
 * text columns after Time.
 */
function guessMapping(rows: string[][]): { mapping: ColumnMapping; notes: string[] } {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const stats = columnStats(rows, width);
  const notes: string[] = [];
  const isText = (c: number) => stats[c]!.filled >= 0.5 && stats[c]!.text >= 0.6;

  let time: number | null = null;
  stats.forEach((s, c) => { if (s.clock >= 0.6 && s.filled >= 0.5 && (time === null || s.clock > stats[time]!.clock)) time = c; });

  const textCols = stats.map((_, c) => c).filter(isText);
  const title = textCols[0] ?? (width ? 0 : null);
  const rest = textCols.filter((c) => c !== title);
  const after = time === null ? rest : rest.filter((c) => c > (time as number));
  const pool = after.length >= 2 ? after : [...after, ...rest.filter((c) => !after.includes(c))];
  const artist = pool[0] ?? null;
  const album = pool[1] ?? null;

  if (time === null) notes.push('No m:ss time column found: durations are unknown, so duplicate checks fall back to title + artist.');
  if (artist === null) notes.push('Could not find an artist column.');
  return { mapping: { title, artist, album, time }, notes };
}

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

const LINE = /\r\n|\r|\n/;

/** Parse an export file (bytes) or pasted text. */
export function parsePlaylist(input: string | ArrayBuffer | Uint8Array): ParseResult {
  const { text, encoding } = typeof input === 'string' ? { text: input, encoding: 'text' } : decodeBytes(input);
  const lines = text.replace(/^﻿/, '').split(LINE).filter((l) => l.replace(/\t/g, '').trim() !== '');
  const empty: ParseResult = { rows: [], warnings: [], format: 'empty', guessed: false, mapping: { title: null, artist: null, album: null, time: null }, header: null, encoding };
  if (!lines.length) return { ...empty, warnings: ['Nothing to import.'] };

  const table = lines.map((l) => l.split('\t'));
  const warnings: string[] = [];
  const head = headerMapping(table[0]!);
  let mapping: ColumnMapping;
  let body: string[][];
  let format: ParseResult['format'];
  let guessed: boolean;

  if (head) {
    format = 'export';
    guessed = false;
    body = table.slice(1);
    mapping = head.mapping;
    if (mapping.title === null) {
      // Odd header without a recognizable Name column: fall back to the guess.
      const g = guessMapping(body);
      mapping = { ...mapping, title: g.mapping.title };
      warnings.push(`No "Name" column in the header; using column ${(g.mapping.title ?? 0) + 1} ("${table[0]![g.mapping.title ?? 0] ?? ''}") as the title.`);
      guessed = true;
    }
    if (mapping.artist === null) warnings.push('No "Artist" column: songs will be matched on title alone, which is much weaker.');
    if (mapping.album === null) warnings.push('No "Album" column.');
    if (mapping.time === null) warnings.push('No "Time" column: durations are unknown, so duplicate checks fall back to title + artist.');
    if (!body.length) warnings.push('The file has a header but no songs.');
  } else {
    format = 'pasted';
    guessed = true;
    body = table;
    if (table.every((r) => r.length === 1)) {
      warnings.push('No tabs found: each line is read as a title only. Paste rows copied from Music.app (⌘C), or use the exported .txt.');
    }
    const g = guessMapping(body);
    mapping = g.mapping;
    warnings.push(...g.notes);
  }

  const cell = (r: string[], i: number | null) => (i === null ? '' : (r[i] ?? '').trim());
  const rows: PlaylistRow[] = [];
  let skipped = 0, shortRows = 0;
  const width = head ? table[0]!.length : 0;
  for (const r of body) {
    if (head && r.length < width) shortRows++;
    const title = cell(r, mapping.title);
    if (!title) { skipped++; continue; }
    rows.push({
      position: rows.length + 1,
      title,
      artist: cell(r, mapping.artist),
      album: cell(r, mapping.album),
      // Pasted list views show m:ss; a bare number there is more likely a count.
      durationMs: parseDuration(cell(r, mapping.time), format === 'export'),
    });
  }
  if (skipped) warnings.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} with no title.`);
  if (shortRows) warnings.push(`${shortRows} row${shortRows === 1 ? ' has' : 's have'} fewer columns than the header; missing cells were left empty.`);
  if (mapping.time !== null && rows.length) {
    const bad = rows.filter((r) => r.durationMs === null).length;
    if (bad / rows.length > 0.2) warnings.push(`${bad} of ${rows.length} rows have no readable duration.`);
  }
  return { rows, warnings, format, guessed, mapping, header: head ? table[0]!.map((c) => c.trim()) : null, encoding };
}

/** Human-readable summary of a guessed mapping, e.g. "Name = column 1, Time = column 2, …". */
export function describeMapping(m: ColumnMapping): string {
  const label: Record<ColumnField, string> = { title: 'Name', time: 'Time', artist: 'Artist', album: 'Album' };
  return (Object.keys(label) as ColumnField[])
    .map((f) => `${label[f]} = ${m[f] === null ? 'not found' : `column ${m[f]! + 1}`}`)
    .join(', ');
}
