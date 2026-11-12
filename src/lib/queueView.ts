/**
 * The review queue's view: sort, filter and group, with an order that stays
 * frozen while you work (docs/SPEC.md, the Review step). Pure, so it can be tested
 * without React.
 *
 * Why frozen: fixing a song (say "no match" → "your pick") changes its sort
 * key. Re-sorting live would move the row, and the current song, away from
 * the group you were working through. Instead the view keeps its order until
 * you change the sort/filter/grouping or ask it to refresh; `isStale` tells
 * the UI when a refresh would change anything.
 */

export type MatchState = 'confident' | 'your-pick' | 'check' | 'unlikely' | 'no-match' | 'error' | 'pending';
export type DecisionState = 'undecided' | 'keep' | 'skip' | 'later';

/** What the view needs to know about one song. */
export interface QueueEntry {
  key: string;
  /** Position in the original (chronological) order. */
  index: number;
  anime: string;
  title: string;
  match: MatchState;
  decision: DecisionState;
}

export type SortField = 'original' | 'status' | 'anime' | 'title' | 'decision';
export type FilterId = 'all' | 'undecided' | 'check' | 'no-match' | 'later' | 'keep' | 'skip';

export interface ViewOptions {
  sort: SortField;
  /** For `status`: confident first (desc) or no match first (asc). For the rest: A→Z / watch order (asc). */
  desc: boolean;
  filter: FilterId;
  groupByAnime: boolean;
}

export const DEFAULT_VIEW: ViewOptions = { sort: 'original', desc: false, filter: 'all', groupByAnime: true };

/** Status order, best first: confident → your pick → check me → unlikely → no match → search failed → still matching. */
const MATCH_RANK: Record<MatchState, number> = { confident: 0, 'your-pick': 1, check: 2, unlikely: 3, 'no-match': 4, error: 5, pending: 6 };
const DECISION_RANK: Record<DecisionState, number> = { undecided: 0, later: 1, keep: 2, skip: 3 };

/** In the order the sort menu lists them. "Watch order" is the order the queue is seeded in (and exported in). */
export const SORT_LABEL: Record<SortField, string> = {
  original: 'Watch order', status: 'Match status', title: 'Song title', decision: 'Decision', anime: 'Anime',
};

export const FILTERS: { id: FilterId; label: string; test: (e: QueueEntry) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'undecided', label: 'To decide', test: (e) => e.decision === 'undecided' },
  { id: 'check', label: 'Check me', test: (e) => e.match === 'check' || e.match === 'unlikely' },
  { id: 'no-match', label: 'No match', test: (e) => e.match === 'no-match' || e.match === 'error' },
  { id: 'later', label: 'Later', test: (e) => e.decision === 'later' },
  { id: 'keep', label: 'Kept', test: (e) => e.decision === 'keep' },
  { id: 'skip', label: 'Skipped', test: (e) => e.decision === 'skip' },
];

/** A stored view (localStorage) with anything unknown, such as the retired "Already have" filter, reset to the default. */
export function sanitizeView(raw: unknown): ViewOptions {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ViewOptions, unknown>>;
  return {
    sort: typeof v.sort === 'string' && v.sort in SORT_LABEL ? (v.sort as SortField) : DEFAULT_VIEW.sort,
    desc: typeof v.desc === 'boolean' ? v.desc : DEFAULT_VIEW.desc,
    filter: FILTERS.some((f) => f.id === v.filter) ? (v.filter as FilterId) : DEFAULT_VIEW.filter,
    groupByAnime: typeof v.groupByAnime === 'boolean' ? v.groupByAnime : DEFAULT_VIEW.groupByAnime,
  };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compare(a: QueueEntry, b: QueueEntry, { sort, desc }: ViewOptions): number {
  let c = 0;
  switch (sort) {
    case 'status':
      // "desc" = best first (confident at the top); pending always last.
      if (a.match === 'pending' || b.match === 'pending') c = MATCH_RANK[a.match] - MATCH_RANK[b.match];
      else c = (MATCH_RANK[a.match] - MATCH_RANK[b.match]) * (desc ? 1 : -1);
      break;
    case 'anime': c = collator.compare(a.anime, b.anime) * (desc ? -1 : 1); break;
    case 'title': c = collator.compare(a.title, b.title) * (desc ? -1 : 1); break;
    case 'decision': c = (DECISION_RANK[a.decision] - DECISION_RANK[b.decision]) * (desc ? -1 : 1); break;
    case 'original': c = (a.index - b.index) * (desc ? -1 : 1); break;
  }
  return c || a.index - b.index; // stable: ties keep the original order
}

/** Keys in view order: filtered, then sorted; grouped by anime when asked (groups in first-appearance order). */
export function computeOrder(entries: QueueEntry[], opts: ViewOptions): string[] {
  const test = FILTERS.find((f) => f.id === opts.filter)?.test ?? (() => true);
  const sorted = entries.filter(test).sort((a, b) => compare(a, b, opts));
  if (!opts.groupByAnime) return sorted.map((e) => e.key);
  const groups = new Map<string, QueueEntry[]>();
  for (const e of sorted) groups.set(e.anime, [...(groups.get(e.anime) ?? []), e]);
  return [...groups.values()].flat().map((e) => e.key);
}

/**
 * Keep a frozen order, but let the current song in even if it no longer
 * matches the filter (you're looking at it), at its original position.
 * `entries` only needs the positions (`index`), so it may be a wider list
 * than the queue's: a song that just left this phase's queue stays put too.
 */
export function withCurrent(order: string[], currentKey: string | null, entries: Pick<QueueEntry, 'key' | 'index'>[]): string[] {
  if (!currentKey || order.includes(currentKey)) return order;
  const idx = new Map(entries.map((e) => [e.key, e.index]));
  const at = idx.get(currentKey);
  if (at === undefined) return order;
  const pos = order.findIndex((k) => (idx.get(k) ?? 0) > at);
  return pos < 0 ? [...order, currentKey] : [...order.slice(0, pos), currentKey, ...order.slice(pos)];
}

/**
 * The order to show: the frozen order minus songs that left this queue
 * altogether (say, a song found in your playlist moves to its own pass),
 * plus the current song wherever it is (`withCurrent`).
 */
export function liveOrder(frozen: string[], currentKey: string | null, entries: QueueEntry[], positions: Pick<QueueEntry, 'key' | 'index'>[] = entries): string[] {
  const inQueue = new Set(entries.map((e) => e.key));
  return withCurrent(frozen.filter((k) => inQueue.has(k)), currentKey, positions);
}

export function isStale(frozen: string[], entries: QueueEntry[], opts: ViewOptions): boolean {
  const fresh = computeOrder(entries, opts);
  return fresh.length !== frozen.length || fresh.some((k, i) => k !== frozen[i]);
}

/** Next/previous key in the view, clamped at the ends. */
export function stepKey(order: string[], currentKey: string | null, dir: 1 | -1): string | null {
  if (!order.length) return null;
  const i = currentKey ? order.indexOf(currentKey) : -1;
  if (i < 0) return order[dir > 0 ? 0 : order.length - 1]!;
  return order[Math.max(0, Math.min(order.length - 1, i + dir))]!;
}

/** Next undecided key after the current one in view order (wrapping); null when none left in the view. */
export function nextUndecidedKey(order: string[], currentKey: string | null, isUndecided: (key: string) => boolean): string | null {
  const i = currentKey ? order.indexOf(currentKey) : -1;
  const rotated = [...order.slice(i + 1), ...order.slice(0, Math.max(0, i))];
  return rotated.find((k) => k !== currentKey && isUndecided(k)) ?? null;
}

export function counts(entries: QueueEntry[]): Record<FilterId, number> {
  return Object.fromEntries(FILTERS.map((f) => [f.id, entries.filter(f.test).length])) as Record<FilterId, number>;
}

/** Per-show progress: decided (keep, skip or later) over total, across every song of the show in the queue. */
export function groupProgress(entries: QueueEntry[]): Map<string, { done: number; total: number }> {
  const m = new Map<string, { done: number; total: number }>();
  for (const e of entries) {
    const p = m.get(e.anime) ?? { done: 0, total: 0 };
    p.total++;
    if (e.decision !== 'undecided') p.done++;
    m.set(e.anime, p);
  }
  return m;
}

export type QueueRow = { kind: 'group'; anime: string; done: number; total: number } | { kind: 'song'; key: string };

/**
 * Rows to render: songs in view order, with a show header before each run of
 * songs from one show when grouping is on. A show split by a sort gets a
 * header per run. Progress counts `entries` (this queue); `others` only
 * supplies rows the order still holds, like the current song after it left
 * the queue.
 */
export function queueRows(order: string[], entries: QueueEntry[], grouped: boolean, others: QueueEntry[] = []): QueueRow[] {
  const byKey = new Map([...others, ...entries].map((e) => [e.key, e]));
  const progress = groupProgress(entries);
  const rows: QueueRow[] = [];
  let last: string | null = null;
  for (const key of order) {
    const e = byKey.get(key);
    if (!e) continue;
    if (grouped && e.anime !== last) {
      const p = progress.get(e.anime) ?? { done: 0, total: 0 };
      rows.push({ kind: 'group', anime: e.anime, ...p });
    }
    last = e.anime;
    rows.push({ kind: 'song', key });
  }
  return rows;
}
