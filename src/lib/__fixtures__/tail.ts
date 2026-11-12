/**
 * Realistic tail-inference fixture: the six shows of animethemes-gql.json
 * (real AnimeThemes data) and a playlist tail whose rows use the names the
 * US store gives those songs, copied from itunes-recording.json (real iTunes
 * data): translations ("Revenge of B"), mistranslations ("Golden Time
 * Rubber"), localized artists ("QUEEN BEE" for 女王蜂 / Ziyoou-vachi), plus
 * non-anisong and cover rows with colliding titles.
 */
import type { FuzzyDate, Show } from '../../types';
import type { PlaylistRow } from '../playlistImport';

const d = (year: number, month: number, day: number): FuzzyDate => ({ year, month, day });
const show = (anilistId: number, title: Show['title'], completedAt: FuzzyDate, extra: Partial<Show> = {}): Show => ({
  anilistId, idMal: null, title, format: 'TV', season: null, seasonYear: completedAt.year, airingStatus: 'FINISHED', coverImage: null,
  status: 'COMPLETED', score: 0, progress: 12, repeat: 0, completedAt, startedAt: { year: null, month: null, day: null },
  updatedAt: 0, createdAt: 0, ...extra,
});

/** Ascending by completedAt, this is the watch order. */
export const SHOWS: Show[] = [
  show(5114, { romaji: 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST', english: 'Fullmetal Alchemist: Brotherhood', native: '鋼の錬金術師 FULLMETAL ALCHEMIST' }, d(2011, 2, 1)),
  show(101922, { romaji: 'Kimetsu no Yaiba', english: 'Demon Slayer: Kimetsu no Yaiba', native: '鬼滅の刃' }, d(2019, 9, 28)),
  show(99425, { romaji: 'Promare', english: 'PROMARE', native: 'プロメア' }, d(2020, 1, 5), { format: 'MOVIE' }),
  show(182587, { romaji: '【Oshi no Ko】 3rd Season', english: '[Oshi No Ko] Season 3', native: '【推しの子】第3期' }, d(2026, 3, 25)),
  show(172463, { romaji: 'Jujutsu Kaisen: Shimetsu Kaiyuu - Zenpen', english: 'JUJUTSU KAISEN Season 3: The Culling Game Part 1', native: '呪術廻戦 死滅回游 前編' }, d(2026, 3, 27)),
  show(166613, { romaji: 'Jigokuraku 2nd Season', english: "Hell's Paradise Season 2", native: '地獄楽 第二期' }, d(2026, 3, 29)),
];
export const FIXTURE_IDS = SHOWS.map((s) => s.anilistId);

/** [title, artist, album, ms, expected "anilistId:slug" or null for "not on the list"] */
type Spec = [string, string, string, number | null, string | null];
const SPEC: Spec[] = [
  ['Again', 'YUI', 'again - EP', 257507, '5114:OP1'],
  ['Personal', 'Jessie J', 'Sweet Talker', 234912, null],
  ['Golden Time Rubber', 'Sukimaswitch', 'Nayuta To Fukashigi', 369453, '5114:OP3'],
  ['Uso', 'Sid', 'Uso - Single', 208120, '5114:ED1'],
  ['Let It Out', 'Miho Fukuhara', 'LET IT OUT - EP', 260680, '5114:ED2'],
  ['Golden Time Lover (from "Fullmetal Alchemist: Brotherhood")', 'AmaLee', 'Nostalgia V', 341280, null],
  ['Gurenge', 'LiSA', 'Gurenge - EP', 238587, '101922:OP1'],
  ['From the Edge (feat. LiSA)', 'FictionJunction', 'PARADE', 280933, '101922:ED1'],
  ['Kori Ni Tojikomete', 'Superfly', 'Ambitious - Single', 270893, '99425:ED2'],
  ['INFERNO', 'Bella Poarch & Sub Urban', 'INFERNO - Single', 133134, null],
  ['Inferno', 'Mrs. GREEN APPLE', 'Attitude', 211600, null],
  ['PERSONAL (ED Theme to Hell\'s Paradise: Jigokuraku Season 2)', 'QUEEN BEE', 'PERSONAL - EP', 275493, '166613:ED1'],
  ['Kasuka na Hana (OP Theme to Hell\'s Paradise: Jigokuraku Season 2) [feat. BABYMETAL]', 'Tatsuya Kitani', 'Kasuka na Hana (OP Theme to Hell\'s Paradise: Jigokuraku Season 2) [feat. BABYMETAL] - Single', 187467, '166613:OP1'],
  ['Golden Time', 'Fujifabric', 'Golden Time - Single', 192240, null],
  ['Revenge of B', 'B KOMACHI RUBY(CV: YURIE IGOMA), ARIMA KANA(CV: MEGUMI HAN), MEMCHO (CV: RUMI OKUBO)', 'Song from Tv Series "【Oshi No Ko】 " Vol.5', 181893, '182587:OP1'],
  ['AIZO', 'King Gnu', 'AIZO - Single', 215858, '172463:OP1'],
  ['Yoake no uta', 'jo0ji', 'Yoake no uta - JUJUTSU KAISEN The Culling Game part1 Ending Theme Song - Single', 199613, '172463:ED1'],
  ['TEST ME', 'Chanmina', 'LEGEND', 172466, '182587:OP2'],
  // The last row is NOT from the most recently watched show.
  ['Serenade', 'natori', 'The Abyss', 219733, '182587:ED1'],
];

export const TAIL_ROWS: PlaylistRow[] = SPEC.map(([title, artist, album, durationMs], i) => ({ position: 100 + i + 1, title, artist, album, durationMs }));
export const EXPECTED: (string | null)[] = SPEC.map((s) => s[4]);

/** Hard row: translated title, composer as artist, singer only as "feat." in the title. */
export const OST_ROW: PlaylistRow = {
  position: 999, title: 'Tanjiro Kamado\'s Song -OST version- (feat. Nami Nakagawa)', artist: 'Go Shiina',
  album: 'Anime "Kimetsu no Yaiba" Tanjiro Kamado, Unwavering Resolve Arc Original Soundtrack', durationMs: 330427,
};
export const OST_TRACK_ID = 1568442751;

/** Music.app export header (en, Music 1.4). */
export const EXPORT_HEADER = [
  'Name', 'Artist', 'Composer', 'Album', 'Grouping', 'Work', 'Movement Number', 'Movement Count', 'Movement Name', 'Genre', 'Size', 'Time',
  'Disc Number', 'Disc Count', 'Track Number', 'Track Count', 'Year', 'Date Modified', 'Date Added', 'Bit Rate', 'Sample Rate',
  'Volume Adjustment', 'Kind', 'Equalizer', 'Comments', 'Plays', 'Last Played', 'Skips', 'Last Skipped', 'My Rating', 'Location',
];

/** Build an export as Music.app writes it: tab-separated, CR line endings. */
export function exportText(rows: Pick<PlaylistRow, 'title' | 'artist' | 'album' | 'durationMs'>[], header = EXPORT_HEADER, eol = '\r'): string {
  const lines = [header.join('\t')];
  rows.forEach((r, i) => {
    const v: Record<string, string> = {
      Name: r.title, Artist: r.artist, Album: r.album, Composer: '', Genre: 'Anime', Size: String(8_000_000 + i),
      Time: r.durationMs === null ? '' : String(Math.round(r.durationMs / 1000)), 'Disc Number': '1', 'Disc Count': '1',
      'Track Number': String(i + 1), 'Track Count': '12', Year: '2026', 'Date Modified': '11/1/26, 9:41 PM', 'Date Added': '11/1/26, 9:41 PM',
      'Bit Rate': '256', 'Sample Rate': '44100', Kind: 'Apple Music AAC audio file', Plays: '3', 'Last Played': '11/2/26, 8:00 AM',
    };
    lines.push(header.map((h) => v[h] ?? '').join('\t'));
  });
  return lines.join(eol) + eol;
}

/** UTF-16LE with BOM, like Music.app. */
export function utf16le(text: string, bom = true): Uint8Array {
  const out = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
  let o = 0;
  if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[o++] = c & 0xff; out[o++] = c >> 8; }
  return out;
}

export function utf16be(text: string): Uint8Array {
  const le = utf16le(text);
  for (let i = 0; i < le.length; i += 2) { const t = le[i]!; le[i] = le[i + 1]!; le[i + 1] = t; }
  return le;
}
