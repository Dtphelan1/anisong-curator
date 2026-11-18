import type { FuzzyDate, Show, SortField, ThemeLookup } from '../types';
import { displayTitle } from './anilist';
import { SORT_FIELDS, type OrderedShow } from './ordering';
import { songsOptional } from './mediaFormat';

/**
 * The anime page's list as rows to render: season groups, the "last show
 * added" divider and the shows themselves, after the title filter.
 */
export type PickerRow =
  | { type: 'group'; key: string; label: string; ids: number[] }
  | { type: 'divider'; anilistId: number; title: string }
  | { type: 'show'; o: OrderedShow; index: number };

export type GroupBy = 'season' | 'none';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASONS = ['Winter', 'Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall'];
const FIELD_VERB: Partial<Record<SortField, string>> = {
  completedAt: 'Finished', startedAt: 'Started', updatedAt: 'Updated', createdAt: 'Added to list',
};

/** yyyymmdd → "Fall 2026" (or "2026" when the month is unknown). */
export function seasonLabel(key: number): string {
  const y = Math.floor(key / 10_000), m = Math.floor(key / 100) % 100;
  return m >= 1 && m <= 12 ? `${SEASONS[m - 1]} ${y}` : String(y);
}

/** Lower-cased titles in every script, for the filter. */
function haystack(s: Show): string {
  return [displayTitle(s), s.title.romaji, s.title.english, s.title.native].filter(Boolean).join(' ').toLocaleLowerCase();
}

export function matchesFilter(s: Show, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return q.split(/\s+/).every((w) => haystack(s).includes(w));
}

export interface BuildOptions {
  ordered: OrderedShow[];
  field: SortField;
  direction: 'asc' | 'desc';
  groupBy: GroupBy;
  filter: string;
  boundId: number | null;
}

/** Rows to render, plus the visible shows in order (what J/K and ranges move over). */
export function buildPickerRows({ ordered, field, direction, groupBy, filter, boundId }: BuildOptions): { rows: PickerRow[]; visible: OrderedShow[] } {
  const visible = ordered.filter((o) => matchesFilter(o.show, filter));
  const isDate = !!SORT_FIELDS.find((f) => f.value === field)?.isDate;
  const groupOf = (o: OrderedShow): { key: string; label: string } | null => {
    if (groupBy === 'none') return null;
    if (o.bucket === 'B') return { key: 'B', label: 'Watching now' };
    if (!isDate) return null;
    if (typeof o.key !== 'number' || o.keySource === 'missing') return { key: 'none', label: 'No date' };
    const season = seasonLabel(o.key);
    return { key: season, label: `${FIELD_VERB[field] ?? ''} · ${season}` };
  };

  const rows: PickerRow[] = [];
  let group: Extract<PickerRow, { type: 'group' }> | null = null;
  visible.forEach((o, index) => {
    const g = groupOf(o);
    if (g && g.key !== group?.key) {
      group = { type: 'group', key: g.key, label: g.label, ids: [] };
      rows.push(group);
    }
    if (g && group) group.ids.push(o.show.anilistId);
    const isBound = o.show.anilistId === boundId;
    // The divider separates "newer than the last show added" from the rest:
    // above the bound when newest-first, below it when oldest-first.
    if (isBound && direction === 'desc') rows.push({ type: 'divider', anilistId: o.show.anilistId, title: displayTitle(o.show) });
    rows.push({ type: 'show', o, index });
    if (isBound && direction === 'asc') rows.push({ type: 'divider', anilistId: o.show.anilistId, title: displayTitle(o.show) });
  });
  return { rows, visible };
}

/** "Nov 3", with the year when it isn't `thisYear`; "2026" or "Aug 2026" for partial dates. */
export function formatFuzzy(d: FuzzyDate, thisYear: number): string | null {
  if (!d.year) return null;
  if (!d.month) return String(d.year);
  const month = MONTHS[d.month - 1];
  if (!d.day) return `${month} ${d.year}`;
  return d.year === thisYear ? `${month} ${d.day}` : `${month} ${d.day}, ${d.year}`;
}

function formatUnix(sec: number, thisYear: number): string | null {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  return formatFuzzy({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }, thisYear);
}

/** The second line of a row: "Completed Nov 3", "Watching · ep 7 · airing", "Dropped · updated Sep 2". */
export function statusLine(s: Show, now = new Date()): { text: string; tone: 'muted' | 'accent' | 'warn' } {
  const y = now.getFullYear();
  switch (s.status) {
    case 'COMPLETED': {
      const at = formatFuzzy(s.completedAt, y);
      return { text: at ? `Completed ${at}` : 'Completed · no date', tone: at ? 'muted' : 'warn' };
    }
    case 'CURRENT':
    case 'REPEATING': {
      const verb = s.status === 'CURRENT' ? 'Watching' : 'Rewatching';
      const parts = [verb, s.progress ? `ep ${s.progress}` : null, s.airingStatus === 'RELEASING' ? 'airing' : null];
      return { text: parts.filter(Boolean).join(' · '), tone: 'accent' };
    }
    case 'DROPPED':
    case 'PAUSED': {
      const at = formatUnix(s.updatedAt, y);
      return { text: `${s.status === 'DROPPED' ? 'Dropped' : 'Paused'}${at ? ` · updated ${at}` : ''}`, tone: 'warn' };
    }
    default:
      return { text: s.status, tone: 'muted' };
  }
}

/* ---------------- Songs per show ---------------- */

/** Songs a lookup contributes to a review (insert songs only when asked). */
export function songCount(lookup: ThemeLookup, includeInserts: boolean): number {
  return lookup.themes.filter((t) => includeInserts || t.kind !== 'IN').length;
}

export type NoSongsKind = 'airing' | 'optional' | 'series';

/** Why a show has no songs, for wording: expected (airing, movie…) or notable (a finished series). */
export function noSongsKind(s: Show): NoSongsKind {
  if (s.airingStatus && s.airingStatus !== 'FINISHED') return 'airing';
  return songsOptional(s.format) ? 'optional' : 'series';
}

export interface LookupSummary {
  songs: number;
  withSongs: number;
  none: { airing: number; optional: number; series: number };
  /** Shows that couldn't be checked on MyAnimeList (provisional "none"). */
  unchecked: number;
  errors: number;
}

export function summarizeLookup(shows: Show[], lookups: Map<number, ThemeLookup>, errors: Map<number, string>, includeInserts: boolean): LookupSummary {
  const out: LookupSummary = { songs: 0, withSongs: 0, none: { airing: 0, optional: 0, series: 0 }, unchecked: 0, errors: 0 };
  for (const s of shows) {
    if (errors.has(s.anilistId)) { out.errors++; continue; }
    const l = lookups.get(s.anilistId);
    if (!l) continue;
    const n = songCount(l, includeInserts);
    if (n) { out.songs += n; out.withSongs++; continue; }
    out.none[noSongsKind(s)]++;
    if (l.status === 'none' && l.incomplete) out.unchecked++;
  }
  return out;
}

/** "2 without songs (1 movie or special, 1 airing)". */
export function describeNone(n: LookupSummary['none']): string | null {
  const total = n.airing + n.optional + n.series;
  if (!total) return null;
  const parts = [
    n.optional && (n.optional === 1 ? '1 movie or special' : `${n.optional} movies or specials`),
    n.airing && `${n.airing} still airing`,
    n.series && `${n.series} series`,
  ].filter(Boolean);
  return `${total} without songs listed (${parts.join(', ')})`;
}
