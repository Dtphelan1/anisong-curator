import { describe, expect, it } from 'vitest';
import type { Show, Theme } from '../types';
import type { ParseResult, PlaylistRow } from './playlistImport';
import { buildThemeIndex } from './tailInference';
import {
  appendAdds, computeStatus, coverage, itemsAsRows, linkItem, LINKER_VERSION, needsLink, planImport, removeAdds,
  setManualLink, suggestLastShow, type PlaylistItem,
} from './playlistLibrary';

/* Synthetic data only (CLAUDE.md): well-known songs, made-up durations. */

const row = (position: number, title: string, artist: string, sec: number | null = 200, album = ''): PlaylistRow =>
  ({ position, title, artist, album, durationMs: sec === null ? null : sec * 1000 });

function parse(rows: PlaylistRow[], p: Partial<ParseResult> = {}): ParseResult {
  return {
    rows, warnings: [], format: 'export', guessed: false, header: null, encoding: 'utf-8',
    mapping: { title: 0, artist: 1, album: 2, time: 3 }, playlistName: null, ordered: true, artistsKnown: true, sortedBy: null, ...p,
  };
}
const titles = (items: PlaylistItem[]) => [...items].sort((a, b) => a.position - b.position).map((i) => i.title);

const BASE = [row(1, 'Gurenge', 'LiSA', 238), row(2, 'Kaikai Kitan', 'Eve', 221), row(3, 'Idol', 'YOASOBI', 213)];

describe('planImport: first import', () => {
  it('creates one item per row, in row order, all new', () => {
    const p = planImport([], parse(BASE), { now: 1, importId: 'a' });
    expect(titles(p.next)).toEqual(['Gurenge', 'Kaikai Kitan', 'Idol']);
    expect(p.event.diff).toMatchObject({ new: 3, missing: 0, unchanged: 0 });
    expect(p.next.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(p.next.every((i) => i.origin === 'import' && i.link === null)).toBe(true);
    expect(p.event.orderIsPlaylist).toBe(true);
  });

  it('an unordered first import still gives an order, labelled as import order', () => {
    const p = planImport([], parse(BASE, { format: 'shortcut', ordered: false }), { now: 1 });
    expect(titles(p.next)).toEqual(['Gurenge', 'Kaikai Kitan', 'Idol']);
    expect(p.event.orderIsPlaylist).toBe(false);
  });
});

describe('planImport: re-import diff', () => {
  const first = planImport([], parse(BASE), { now: 1, importId: 'a' });

  it('keeps ids and links of unchanged songs, adds new ones, drops missing ones', () => {
    const linked = first.next.map((i) => (i.title === 'Idol' ? setManualLink(i, { themeKey: 'song:9', anilistId: 150672, slug: 'OP1' }, 1) : i));
    const p = planImport(linked, parse([row(1, 'Idol', 'YOASOBI', 214), row(2, 'Gurenge', 'LiSA', 238), row(3, 'Mephisto', 'QUEEN BEE', 237)]), { now: 2, importId: 'b' });
    expect(p.event.diff).toMatchObject({ new: 1, missing: 1, unchanged: 2, renamed: 0 });
    expect(p.missing.map((i) => i.title)).toEqual(['Kaikai Kitan']);
    const idol = p.next.find((i) => i.title === 'Idol')!;
    expect(idol.id).toBe(linked.find((i) => i.title === 'Idol')!.id);
    expect(idol.link).toMatchObject({ state: 'linked', via: 'manual' });
    // Ordered import: its row order wins.
    expect(titles(p.next)).toEqual(['Idol', 'Gurenge', 'Mephisto']);
  });

  it('true repeats stay two items; lengths more than 3 s apart are different recordings', () => {
    const p = planImport([], parse([row(1, 'Gurenge', 'LiSA', 238), row(2, 'Gurenge', 'LiSA', 238), row(3, 'Gurenge', 'LiSA', 90)]), { now: 1 });
    const q = planImport(p.next, parse([row(1, 'Gurenge', 'LiSA', 239), row(2, 'Gurenge', 'LiSA', 237), row(3, 'Gurenge', 'LiSA', 91)]), { now: 2 });
    expect(q.event.diff).toMatchObject({ unchanged: 3, new: 0, missing: 0 });
    expect(new Set(q.next.map((i) => i.id))).toEqual(new Set(p.next.map((i) => i.id)));
  });

  it('detects a rename (store spelling changed) and keeps the link', () => {
    const linked = first.next.map((i) => (i.title === 'Kaikai Kitan' ? setManualLink(i, { themeKey: 'song:2', anilistId: 113415, slug: 'OP1' }, 1) : i));
    const p = planImport(linked, parse([row(1, 'Gurenge', 'LiSA', 238), row(2, 'Kaikai Kitan (TV Size)', 'Eve', 221), row(3, 'Idol', 'YOASOBI', 213)]), { now: 2 });
    // "(TV Size)" is a different cut by flags, so not a rename: that's a new song and a missing one.
    expect(p.event.diff.renamed).toBe(0);
    const q = planImport(linked, parse([row(1, 'Gurenge', 'LiSA', 238), row(2, 'Kaikaikitan', 'Eve', 221), row(3, 'Idol', 'YOASOBI', 213)]), { now: 2 });
    expect(q.event.diff).toMatchObject({ renamed: 1, new: 0, missing: 0 });
    expect(q.renamed[0]!.from.title).toBe('Kaikai Kitan');
    expect(q.next.find((i) => i.title === 'Kaikaikitan')!.link).toMatchObject({ via: 'manual' });
  });

  it('an unordered re-import keeps the stored order and appends new songs', () => {
    const p = planImport(first.next, parse([row(1, 'Mephisto', 'QUEEN BEE', 237), row(2, 'Idol', 'YOASOBI', 213), row(3, 'Gurenge', 'LiSA', 238)], { format: 'shortcut', ordered: false }), { now: 2, prev: first.event });
    expect(titles(p.next)).toEqual(['Gurenge', 'Idol', 'Mephisto']);
    expect(p.orderReplaced).toBe(false);
    // The kept order came from an ordered import: still playlist order.
    expect(p.event.orderIsPlaylist).toBe(true);
  });

  it('unreliable artists: match on title alone, no renames', () => {
    const p = planImport(first.next, parse([row(1, 'Gurenge', '', 238), row(2, 'Kaikai Kitan', '', 221)], { artistsKnown: false, ordered: false, format: 'shortcut' }), { now: 2 });
    expect(p.event.diff).toMatchObject({ unchanged: 2, missing: 1, renamed: 0 });
    expect(p.next.find((i) => i.title === 'Gurenge')!.artist).toBe('LiSA');
  });
});

describe('app adds', () => {
  const first = planImport([], parse(BASE), { now: 1, importId: 'a' });
  const adds = [
    { key: '150672:ED1', trackId: 1001, title: 'Mephisto', artist: 'QUEEN BEE', durationMs: 237_000 },
    { key: 'song:77', trackId: 1002, title: 'Bling-Bang-Bang-Born', artist: 'Creepy Nuts', durationMs: 160_000, anilistId: 166610, slug: 'OP1' },
  ];

  it('appends the batch at the end, linked through the add log', () => {
    const next = appendAdds(first.next, adds, 'b9', 5);
    expect(titles(next)).toEqual(['Gurenge', 'Kaikai Kitan', 'Idol', 'Mephisto', 'Bling-Bang-Bang-Born']);
    const m = next.find((i) => i.title === 'Mephisto')!;
    expect(m).toMatchObject({ origin: 'app', trackId: 1001, addedBatch: 'b9', anilistIds: [150672] });
    expect(m.link).toMatchObject({ state: 'linked', via: 'add-log', hits: [{ themeKey: '150672:ED1', anilistId: 150672, slug: 'ED1' }] });
    expect(removeAdds(next, 'b9').map((i) => i.title)).toEqual(['Gurenge', 'Kaikai Kitan', 'Idol']);
  });

  it('a later import confirms the adds it contains; the rest stay appended as not seen', () => {
    const withAdds = appendAdds(first.next, adds, 'b9', 5);
    const p = planImport(withAdds, parse([...BASE, row(4, 'Mephisto', 'QUEEN BEE', 237), row(5, 'Odoriko', 'Vaundy', 233)]), { now: 6 });
    expect(p.event.diff).toMatchObject({ addsConfirmed: 1, addsUnseen: 1, new: 1, unchanged: 3 });
    const m = p.next.find((i) => i.title === 'Mephisto')!;
    expect(m).toMatchObject({ origin: 'import', trackId: 1001, addedBatch: 'b9' });
    expect(m.link).toMatchObject({ via: 'add-log' });
    expect(titles(p.next)).toEqual(['Gurenge', 'Kaikai Kitan', 'Idol', 'Mephisto', 'Odoriko', 'Bling-Bang-Bang-Born']);
    expect(p.unseen.map((i) => i.title)).toEqual(['Bling-Bang-Bang-Born']);
  });

  it('confirms an add under a slightly different store name', () => {
    const withAdds = appendAdds(first.next, [{ key: 'k', trackId: 5, title: 'Bling‐Bang‐Bang‐Born', artist: 'Creepy Nuts', durationMs: 160_000 }], 'b1', 5);
    const p = planImport(withAdds, parse([...BASE, row(4, 'Bling-Bang-Bang-Born', 'Creepy Nuts', 161)]), { now: 6 });
    expect(p.event.diff).toMatchObject({ addsConfirmed: 1, new: 0 });
  });
});

/* ---------------- linking ---------------- */

const show = (anilistId: number, english: string, completed: [number, number, number] | null, p: Partial<Show> = {}): Show => ({
  anilistId, idMal: null, title: { romaji: english, english, native: null }, format: 'TV', season: null, seasonYear: null,
  airingStatus: 'FINISHED', coverImage: null, status: 'COMPLETED', score: 0, progress: 0, repeat: 0,
  completedAt: completed ? { year: completed[0], month: completed[1], day: completed[2] } : { year: null, month: null, day: null },
  startedAt: { year: null, month: null, day: null }, updatedAt: 0, createdAt: 0, ...p,
});
const theme = (anilistId: number, slug: string, songId: number, title: string, artists: string[]): Theme => ({
  slug, anilistId, kind: slug.startsWith('ED') ? 'ED' : 'OP', sequence: Number(slug.slice(2)) || 1, songId, songTitle: title,
  songTitleNative: null, artists, artistsNative: [], episodes: null, appleMusicUrl: null, source: 'animethemes',
});
const SHOWS = [show(101922, 'Demon Slayer', [2019, 9, 28]), show(113415, 'Jujutsu Kaisen', [2021, 3, 27]), show(150672, 'Oshi no Ko', [2023, 6, 28])];
const THEMES: Record<number, Theme[]> = {
  101922: [theme(101922, 'OP1', 1, 'Gurenge', ['LiSA']), theme(101922, 'ED1', 2, 'from the edge', ['FictionJunction', 'LiSA'])],
  113415: [theme(113415, 'OP1', 3, 'Kaikai Kitan', ['Eve']), theme(113415, 'ED1', 4, 'Lost in Paradise', ['ALI'])],
  150672: [theme(150672, 'OP1', 5, 'Idol', ['YOASOBI']), theme(150672, 'ED1', 6, 'Mephisto', ['QUEEN BEE'])],
};
const INDEX = buildThemeIndex(SHOWS, (s) => THEMES[s.anilistId] ?? []);

describe('linking', () => {
  const first = planImport([], parse([...BASE, row(4, 'Odoriko', 'Vaundy', 233)]), { now: 1 });
  const linked = first.next.map((i) => linkItem(i, INDEX, new Map(), 2));

  it('links rows to themes by name, leaves strangers unlinked', () => {
    const g = linked.find((i) => i.title === 'Gurenge')!;
    expect(g.link).toMatchObject({ state: 'linked', via: 'fuzzy', hits: [{ themeKey: 'song:1', anilistId: 101922, slug: 'OP1' }], v: LINKER_VERSION });
    expect(g.anilistIds).toEqual([101922]);
    expect(linked.find((i) => i.title === 'Odoriko')!.link).toMatchObject({ state: 'unlinked' });
  });

  it('fills in the show of an add-log link that only had a song key', () => {
    const [it] = appendAdds([], [{ key: 'song:6', trackId: 9, title: 'Mephisto', artist: 'QUEEN BEE', durationMs: 1 }], 'b', 1);
    expect(needsLink(it!, 'new')).toBe(true);
    const done = linkItem(it!, INDEX, new Map(), 2);
    expect(done.link).toMatchObject({ via: 'add-log', hits: [{ themeKey: 'song:6', anilistId: 150672, slug: 'ED1' }] });
    expect(needsLink(done, 'all')).toBe(false);
  });

  it('never relinks a manual link or an explicit unlink', () => {
    const m = setManualLink(linked[0]!, null, 3);
    expect(needsLink(m, 'all')).toBe(false);
    expect(linkItem(m, INDEX, new Map())).toBe(m);
  });

  it('rows carry trusted theme keys; status and coverage count links', () => {
    const rows = itemsAsRows(linked);
    expect(rows.find((r) => r.title === 'Idol')!.themeKeys).toEqual(['song:5']);
    expect(rows.find((r) => r.title === 'Odoriko')!.themeKeys).toEqual([]);
    const st = computeStatus({ name: 'Mix', syncedAt: 1, lastImport: first.event }, linked, null, 2)!;
    expect(st).toMatchObject({ rowCount: 4, linked: 3, unlinked: 1, pending: 0, pendingAdds: 0, ordered: true, stale: false });
    const cov = coverage(linked, new Map([[150672, 2], [113415, 2]]));
    expect(cov.get(150672)).toEqual({ inPlaylist: 1, total: 2 });
    expect(cov.get(101922)).toEqual({ inPlaylist: 1, total: null });
  });

  it('suggests the most recently watched show with a linked song, with the ordered tail as a cross-check', () => {
    const s = suggestLastShow(linked, SHOWS, true)!;
    expect(s.anilistId).toBe(150672);
    expect(s.evidence).toContain('Idol');
    expect(s.tailAnilistId).toBeNull();
    // Reorder so the last linked row is Demon Slayer's: the cross-check flags it.
    const moved = linked.map((i) => (i.title === 'Gurenge' ? { ...i, position: 99 } : i));
    expect(suggestLastShow(moved, SHOWS, true)!.tailAnilistId).toBe(101922);
    expect(suggestLastShow([], SHOWS)).toBeNull();
  });
});
