import type { OrderedShow } from './ordering';

/**
 * Which shows to look up songs for (SPEC §8): a base set plus explicit
 * per-show additions and removals.
 *
 * - `newer`: everything more recent than the "last show added" (`boundId`),
 *   or everything when there's no bound. New shows you finish later land
 *   here automatically, which is why the bound stays the default.
 * - `all` / `none`: everything / nothing.
 *
 * `include` and `exclude` are AniList ids toggled on top of the base, so a
 * hand-picked change survives the list growing or being re-sorted.
 */
export type SelectionBase = 'newer' | 'all' | 'none';

export interface Selection {
  base: SelectionBase;
  include: number[];
  exclude: number[];
}

export const DEFAULT_SELECTION: Selection = { base: 'newer', include: [], exclude: [] };

export interface SelectionContext {
  ordered: OrderedShow[];
  boundId: number | null;
  direction: 'asc' | 'desc';
}

/** Ids in the base set, before additions/removals. */
export function baseIds(sel: Selection, { ordered, boundId, direction }: SelectionContext): Set<number> {
  if (sel.base === 'none') return new Set();
  const ids = ordered.map((o) => o.show.anilistId);
  if (sel.base === 'all' || boundId === null) return new Set(ids);
  const i = ids.indexOf(boundId);
  if (i < 0) return new Set(ids);
  // "Newer than the bound" is after it when ascending, before it when descending.
  return new Set(direction === 'asc' ? ids.slice(i + 1) : ids.slice(0, i));
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
  return { base: sel.base, include: [...include], exclude: [...exclude] };
}

export function toggleShow(sel: Selection, id: number, ctx: SelectionContext): Selection {
  return setShows(sel, [id], !selectedIds(sel, ctx).has(id), ctx);
}

export const selectAll = (): Selection => ({ base: 'all', include: [], exclude: [] });
export const selectNone = (): Selection => ({ base: 'none', include: [], exclude: [] });
export const selectOnly = (id: number): Selection => ({ base: 'none', include: [id], exclude: [] });
/** "Everything newer than this" — pair with setting `boundId` to the show. */
export const selectNewer = (): Selection => ({ base: 'newer', include: [], exclude: [] });

export function invertSelection(sel: Selection, ctx: SelectionContext): Selection {
  const ids = selectedIds(sel, ctx);
  return { base: 'none', include: ctx.ordered.map((o) => o.show.anilistId).filter((id) => !ids.has(id)), exclude: [] };
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
