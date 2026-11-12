import type { FuzzyDate, ListStatus, Show, SortField } from '../types';
import { displayTitle } from './anilist';

/**
 * Ordering rules (SPEC §8):
 *  - Bucket A (finished-ish): COMPLETED, DROPPED, PAUSED — sorted by the chosen field.
 *  - Bucket B (in progress):  CURRENT, REPEATING — always at the "recent" end:
 *    after A when ascending, before A when descending.
 *  - PLANNING is excluded.
 */
export const BUCKET_A: ListStatus[] = ['COMPLETED', 'DROPPED', 'PAUSED'];
export const BUCKET_B: ListStatus[] = ['CURRENT', 'REPEATING'];

export interface OrderOptions {
  field: SortField;
  direction: 'asc' | 'desc';
  includeDropped: boolean;
  includePaused: boolean;
}

/** Newest first by default; review and export still run oldest → newest (playlist order). */
export const DEFAULT_ORDER: OrderOptions = {
  field: 'completedAt',
  direction: 'desc',
  includeDropped: true,
  includePaused: true,
};

export type KeySource = 'primary' | 'fallback' | 'missing';

export interface OrderedShow {
  show: Show;
  bucket: 'A' | 'B';
  /** Comparable key; -Infinity when missing. Strings only for 'title'. */
  key: number | string;
  keySource: KeySource;
}

export const SORT_FIELDS: { value: SortField; label: string; isDate: boolean }[] = [
  { value: 'completedAt', label: 'Completed date', isDate: true },
  { value: 'startedAt', label: 'Started date', isDate: true },
  { value: 'updatedAt', label: 'Last list update', isDate: true },
  { value: 'createdAt', label: 'Added to list', isDate: true },
  { value: 'score', label: 'Score', isDate: false },
  { value: 'progress', label: 'Episodes watched', isDate: false },
  { value: 'repeat', label: 'Rewatch count', isDate: false },
  { value: 'title', label: 'Title', isDate: false },
];

/** yyyymmdd as a number; unknown month/day sort to the start of the year/month. */
export function fuzzyDateKey(d: FuzzyDate): number | null {
  if (!d.year) return null;
  return d.year * 10_000 + (d.month ?? 0) * 100 + (d.day ?? 0);
}

/** Unix seconds → yyyymmdd (UTC) so it compares with fuzzy dates. */
export function unixToDateKey(sec: number): number | null {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function isPartialDate(d: FuzzyDate): boolean {
  return !!d.year && (!d.month || !d.day);
}

function keyFor(show: Show, field: SortField): { key: number | string; keySource: KeySource } {
  const primary = (): number | string | null => {
    switch (field) {
      case 'completedAt': return fuzzyDateKey(show.completedAt);
      case 'startedAt': return fuzzyDateKey(show.startedAt);
      case 'updatedAt': return unixToDateKey(show.updatedAt);
      case 'createdAt': return unixToDateKey(show.createdAt);
      case 'score': return show.score;
      case 'progress': return show.progress;
      case 'repeat': return show.repeat;
      case 'title': return displayTitle(show).toLocaleLowerCase();
    }
  };
  const p = primary();
  if (p !== null) return { key: p, keySource: 'primary' };

  // Shows that can't have a completion date (dropped, paused, in progress)
  // fall back to the last list update, which is a proxy for "when I stopped".
  // A COMPLETED show with no date stays missing, so the UI can flag it.
  if (field === 'completedAt' && show.status !== 'COMPLETED') {
    const fb = unixToDateKey(show.updatedAt);
    if (fb !== null) return { key: fb, keySource: 'fallback' };
  }
  return { key: -Infinity, keySource: 'missing' };
}

function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return (a as number) - (b as number) || 0;
}

export function orderShows(shows: Show[], opts: OrderOptions): OrderedShow[] {
  const included = shows.filter((s) => {
    if (s.status === 'PLANNING') return false;
    if (s.status === 'DROPPED' && !opts.includeDropped) return false;
    if (s.status === 'PAUSED' && !opts.includePaused) return false;
    return true;
  });

  const ordered = included.map<OrderedShow>((show) => ({
    show,
    bucket: BUCKET_B.includes(show.status) ? 'B' : 'A',
    ...keyFor(show, opts.field),
  }));

  const sign = opts.direction === 'asc' ? 1 : -1;
  ordered.sort((x, y) => {
    if (x.bucket !== y.bucket) return (x.bucket === 'A' ? -1 : 1) * sign;
    // -Infinity - -Infinity is NaN; treat equal-missing as a tie.
    const c = x.key === y.key ? 0 : compareKeys(x.key, y.key);
    if (c) return c * sign;
    // Stable, meaningful tie-breakers: last update, then title.
    return (x.show.updatedAt - y.show.updatedAt) * sign || displayTitle(x.show).localeCompare(displayTitle(y.show));
  });
  return ordered;
}

/**
 * Candidates for review given the "last show already in the playlist".
 * "More recent than the bound" means after it when ascending, before it when
 * descending. A null bound or an unknown id means everything is a candidate.
 */
export function candidatesAfterBound(ordered: OrderedShow[], boundId: number | null, direction: 'asc' | 'desc'): OrderedShow[] {
  if (boundId === null) return ordered;
  const i = ordered.findIndex((o) => o.show.anilistId === boundId);
  if (i < 0) return ordered;
  return direction === 'asc' ? ordered.slice(i + 1) : ordered.slice(0, i);
}

export function formatKey(o: OrderedShow, field: SortField): string {
  if (o.keySource === 'missing') return '—';
  const meta = SORT_FIELDS.find((f) => f.value === field);
  if (meta?.isDate && typeof o.key === 'number') {
    const y = Math.floor(o.key / 10_000), m = Math.floor(o.key / 100) % 100, d = o.key % 100;
    return [y, m && String(m).padStart(2, '0'), d && String(d).padStart(2, '0')].filter(Boolean).join('-');
  }
  if (field === 'title') return '';
  return String(o.key);
}
