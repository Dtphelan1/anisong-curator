export type ListStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';

/** AniList FuzzyDate: any component may be null. */
export interface FuzzyDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/** One entry on the user's AniList anime list, flattened with its media. */
export interface Show {
  anilistId: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  format: string | null;
  season: string | null;
  seasonYear: number | null;
  /** Media airing status, e.g. FINISHED / RELEASING. Not the list status. */
  airingStatus: string | null;
  coverImage: string | null;
  status: ListStatus;
  score: number;
  progress: number;
  repeat: number;
  completedAt: FuzzyDate;
  startedAt: FuzzyDate;
  /** Unix seconds; changes on any list edit. 0 = unknown. */
  updatedAt: number;
  /** Unix seconds; 0 for some legacy entries. */
  createdAt: number;
}

export type SortField =
  | 'completedAt'
  | 'startedAt'
  | 'updatedAt'
  | 'createdAt'
  | 'score'
  | 'progress'
  | 'repeat'
  | 'title';

export type ThemeKind = 'OP' | 'ED' | 'IN';

export interface Theme {
  /** Stable key within a show: e.g. "OP1", "ED2", "OP1-v2". */
  slug: string;
  anilistId: number;
  kind: ThemeKind;
  sequence: number;
  /** AnimeThemes song id; null for Jikan-sourced themes. */
  songId: number | null;
  songTitle: string | null;
  /** Native-script title when the source provides one and it differs from songTitle. */
  songTitleNative: string | null;
  artists: string[];
  episodes: string | null;
  /** Apple Music link curated on AnimeThemes, when present (rare as of 2026-11). */
  appleMusicUrl: string | null;
  source: 'animethemes' | 'jikan';
}

export interface ThemeLookup {
  anilistId: number;
  status: 'found' | 'none';
  themes: Theme[];
  source: 'animethemes' | 'jikan' | null;
  fetchedAt: number;
}
