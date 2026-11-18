import { fuzzyDateKey, type OrderedShow } from './ordering';

/**
 * Which shows to look up songs for (SPEC §8): a base set (a "quick start")
 * plus explicit per-show additions and removals.
 *
 * - `newer`: everything more recent than the "last show added" (`boundId`),
 *   or everything when there's no bound. New shows you finish later land
 *   here automatically, which is why the bound stays the default.
 * - `since`: shows completed on or after `since` (yyyy-mm-dd, completion
 *   date only): "everything I finished since my last session".
 * - `latest`: the `count` most recently completed shows.
 * - `all` / `none`: everything / nothing.
 *
 * `newer`, `since` and `latest` always include shows in progress (Watching,
 * Rewatching) and never pre-select Dropped or Paused ones: those are listed
 * and can be ticked by hand.
 *
 * `include` and `exclude` are AniList ids toggled on top of the base, so a
 * hand-picked change survives the list growing or being re-sorted.
 */
export type SelectionBase = 'newer' | 'since' | 'latest' | 'all' | 'none';

export interface Selection {
  base: SelectionBase;
  include: number[];
  exclude: number[];
  /** For `since`: yyyy-mm-dd. Kept when switching quick starts, so it's remembered. */
  since?: string;
  /** For `latest`: how many finished shows. */
  count?: number;
}

export const DEFAULT_SELECTION: Selection = { base: 'newer', include: [], exclude: [] };
export const DEFAULT_LATEST_COUNT = 10;

export interface SelectionContext {
  ordered: OrderedShow[];
  boundId: number | null;
  direction: 'asc' | 'desc';
}

const IN_PROGRESS = new Set(['CURRENT', 'REPEATING']);
const NOT_PRESELECTED = new Set(['DROPPED', 'PAUSED']);

/** 'yyyy-mm-dd' → yyyymmdd, comparable with fuzzyDateKey. */
export function dateInputKey(date: string | undefined): number | null {
  const m = (date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Number(m[1]) * 10_000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

/** Ids in the base set, before additions/removals. */
export function baseIds(sel: Selection, { ordered, boundId, direction }: SelectionContext): Set<number> {
  if (sel.base === 'none') return new Set();
  if (sel.base === 'all') return new Set(ordered.map((o) => o.show.anilistId));
  const inProgress = ordered.filter((o) => IN_PROGRESS.has(o.show.status)).map((o) => o.show.anilistId);
  // Completed shows with a completion date (partial dates count from the start of their year/month).
  const finished = () => ordered
    .filter((o) => o.show.status === 'COMPLETED')
    .map((o) => ({ id: o.show.anilistId, key: fuzzyDateKey(o.show.completedAt) }))
    .filter((x): x is { id: number; key: number } => x.key !== null);

  if (sel.base === 'since') {
    const from = dateInputKey(sel.since);
    const ids = from === null ? [] : finished().filter((x) => x.key >= from).map((x) => x.id);
    return new Set([...inProgress, ...ids]);
  }
  if (sel.base === 'latest') {
    const n = Math.max(0, sel.count ?? DEFAULT_LATEST_COUNT);
    const ids = finished().sort((a, b) => b.key - a.key).slice(0, n).map((x) => x.id);
    return new Set([...inProgress, ...ids]);
  }

  // newer: after the bound when ascending, before it when descending.
  const i = boundId === null ? -1 : ordered.findIndex((o) => o.show.anilistId === boundId);
  const range = i < 0 ? ordered : direction === 'asc' ? ordered.slice(i + 1) : ordered.slice(0, i);
  return new Set(range.filter((o) => !NOT_PRESELECTED.has(o.show.status)).map((o) => o.show.anilistId));
}

export function selectedIds(sel: Selection, ctx: SelectionContext): Set<number> {
  const out = baseIds(sel, ctx);
  for (const id of sel.exclude) out.delete(id);
  const present = new Set(ctx.ordered.map((o) => o.show.anilistId));
  for (const id of sel.include) if (present.has(id)) out.add(id);
  return out;
}

/** Selected shows, in list order. */
export function selectedShows(sel: Selection, ctx: SelectionContext): OrderedShow[] {
  const ids = selectedIds(sel, ctx);
  return ctx.ordered.filter((o) => ids.has(o.show.anilistId));
}

/** Set some shows to included (true) or excluded (false), on top of the base. */
export function setShows(sel: Selection, ids: number[], value: boolean, ctx: SelectionContext): Selection {
  const base = baseIds(sel, ctx);
  const include = new Set(sel.include);
  const exclude = new Set(sel.exclude);
  for (const id of ids) {
    if (value) {
      exclude.delete(id);
      if (!base.has(id)) include.add(id);
    } else {
      include.delete(id);
      if (base.has(id)) exclude.add(id);
    }
  }
  return { ...sel, include: [...include], exclude: [...exclude] };
}

export function toggleShow(sel: Selection, id: number, ctx: SelectionContext): Selection {
  return setShows(sel, [id], !selectedIds(sel, ctx).has(id), ctx);
}

export const selectAll = (): Selection => ({ base: 'all', include: [], exclude: [] });
export const selectNone = (): Selection => ({ base: 'none', include: [], exclude: [] });
export const selectOnly = (id: number): Selection => ({ base: 'none', include: [id], exclude: [] });
/** "Everything newer than this" — pair with setting `boundId` to the show. */
export const selectNewer = (): Selection => ({ base: 'newer', include: [], exclude: [] });

/**
 * Switch the quick start, keeping hand edits and the remembered date/count.
 * "Pick by hand" (`none`) starts from nothing, keeping only additions.
 */
export function withBase(sel: Selection, base: SelectionBase, patch: { since?: string; count?: number } = {}): Selection {
  return { ...sel, ...patch, base, exclude: base === 'none' ? [] : sel.exclude };
}

/** Drop the hand edits, keeping the quick start. */
export const resetEdits = (sel: Selection): Selection => ({ ...sel, include: [], exclude: [] });

export const handEdits = (sel: Selection): number => sel.include.length + sel.exclude.length;

export function invertSelection(sel: Selection, ctx: SelectionContext): Selection {
  const ids = selectedIds(sel, ctx);
  return { ...sel, base: 'none', include: ctx.ordered.map((o) => o.show.anilistId).filter((id) => !ids.has(id)), exclude: [] };
}

/** Ids of rows between two list positions, inclusive, in list order. */
export function rangeIds(ordered: OrderedShow[], a: number, b: number): number[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return ordered.slice(Math.max(0, lo), hi + 1).map((o) => o.show.anilistId);
}

/** True when the selection is exactly "newer than the last show added", with no hand edits. */
export function isPlainNewer(sel: Selection): boolean {
  return sel.base === 'newer' && !sel.include.length && !sel.exclude.length;
}
