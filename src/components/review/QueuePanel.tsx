import { useEffect, useMemo, useRef } from 'react';
import type { Show } from '../../types';
import type { Decision } from '../../lib/db';
import type { DupHit } from '../../lib/dedupe';
import {
  counts as filterCounts, FILTERS, queueRows, SORT_LABEL, type QueueEntry, type SortField, type ViewOptions,
} from '../../lib/queueView';
import type { ReviewItem } from '../../lib/useMatching';
import { decisionMark, ShowCover, STATE_TEXT, STATE_TONE } from './common';

interface Props {
  items: Map<string, ReviewItem>;
  /** This pass's songs. */
  entries: QueueEntry[];
  /** Every song, for rows the order holds beyond this pass (the current song after it moved on). */
  allEntries: QueueEntry[];
  order: string[];
  currentKey: string | null;
  onPick: (key: string) => void;
  onStep: (dir: 1 | -1) => void;
  decisions: Map<string, Decision>;
  hits: Map<string, DupHit>;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
  stale: boolean;
  onRefresh: () => void;
  /** Songs in the already-have pass. */
  haveCount: number;
  /** A playlist snapshot or add log exists to check against. */
  canCheck: boolean;
  onSync: () => void;
}

const FILTER_TONE: Partial<Record<string, string>> = { check: 'tone-warn', 'no-match': 'tone-bad' };

/** The review queue (phase 1): position and ←/→, sort, By show, filters, and the rows. */
export function QueuePanel({ items, entries, allEntries, order, currentKey, onPick, onStep, decisions, hits, view, onView, stale, onRefresh, haveCount, canCheck, onSync }: Props) {
  const entryByKey = useMemo(() => new Map(allEntries.map((e) => [e.key, e])), [allEntries]);
  const showByAnime = useMemo(() => {
    const m = new Map<string, Show>();
    for (const e of entries) { const it = items.get(e.key); if (it && !m.has(e.anime)) m.set(e.anime, it.show); }
    return m;
  }, [entries, items]);
  const n = useMemo(() => filterCounts(entries), [entries]);
  const rows = useMemo(() => queueRows(order, entries, view.groupByAnime, allEntries), [order, entries, view.groupByAnime, allEntries]);
  const pos = currentKey ? order.indexOf(currentKey) : -1;
  const rowEls = useRef(new Map<string, HTMLElement>());
  // Keep the current song visible in the list as you move through it.
  useEffect(() => { if (currentKey) rowEls.current.get(currentKey)?.scrollIntoView({ block: 'nearest' }); }, [currentKey]);

  return (
    <nav className="queue" aria-label="Queue">
      <div className="queue-tools">
        <div className="queue-top">
          <span className="eyebrow">
            Queue <span className="queue-pos">· {pos >= 0 ? pos + 1 : '–'} of {order.length}{view.filter !== 'all' && <> · {entries.length} in all</>}</span>
          </span>
          <div className="queue-arrows">
            <button className="icon-btn" onClick={() => onStep(-1)} disabled={pos <= 0} aria-label="Previous song" title="Previous (K or ←)">←</button>
            <button className="icon-btn" onClick={() => onStep(1)} disabled={pos < 0 || pos >= order.length - 1} aria-label="Next song" title="Next (J or →)">→</button>
          </div>
        </div>
        <div className="queue-sort">
          <label>
            <span className="sr-only">Sort</span>
            <select value={view.sort} onChange={(e) => onView({ ...view, sort: e.target.value as SortField, desc: e.target.value === 'status' })}>
              {(Object.keys(SORT_LABEL) as SortField[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
          <button className="tool-btn" onClick={() => onView({ ...view, desc: !view.desc })} aria-label="Reverse order"
            title={view.sort === 'status' ? (view.desc ? 'Confident first' : 'No match first') : view.desc ? 'Reversed' : 'In order'}>
            {view.desc ? '↑' : '↓'}
          </button>
          <button className="tool-btn" aria-pressed={view.groupByAnime} onClick={() => onView({ ...view, groupByAnime: !view.groupByAnime })}>By show</button>
          {stale && <button className="stale-pill" onClick={onRefresh} title="Statuses changed since this order was set; the list stays put until you refresh">Order changed · refresh</button>}
        </div>
        <div className="filters" role="radiogroup" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.id} role="radio" aria-checked={view.filter === f.id} className={`filter ${FILTER_TONE[f.id] ?? ''}`}
              onClick={() => onView({ ...view, filter: f.id })} disabled={!n[f.id] && view.filter !== f.id && f.id !== 'all'}>
              {f.label} <span className="filter-n">{n[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="queue-list">
        {rows.map((r, i) => {
          if (r.kind === 'group') {
            const show = showByAnime.get(r.anime);
            return (
              <div key={`g:${r.anime}:${i}`} className="group-head">
                {show && <ShowCover show={show} size="sm" />}
                <span className="group-title">{r.anime}</span>
                <span className="group-n" title={`${r.done} of ${r.total} decided`}>{r.done} / {r.total}</span>
              </div>
            );
          }
          const it = items.get(r.key);
          const e = entryByKey.get(r.key);
          if (!it) return null;
          const mk = decisionMark(decisions.get(r.key), hits.get(r.key));
          const state = e?.match ?? 'pending';
          return (
            <button key={r.key} ref={(el) => { if (el) rowEls.current.set(r.key, el); else rowEls.current.delete(r.key); }}
              className={`qrow ${view.groupByAnime ? 'grouped' : ''} ${r.key === currentKey ? 'current' : ''}`}
              onClick={() => onPick(r.key)} aria-current={r.key === currentKey ? 'true' : undefined}>
              <span className={`qmark ${mk.cls}`} title={mk.title}>{mk.glyph}</span>
              <span className="qslug">{it.theme.slug}</span>
              <span className="qtitle">
                {it.theme.songTitle ?? 'Unknown title'}
                {!view.groupByAnime && <span className="qshow"> · {e?.anime}</span>}
              </span>
              <span className={`dot tone-${STATE_TONE[state]}`} title={STATE_TEXT[state]} aria-label={STATE_TEXT[state]} />
            </button>
          );
        })}
        {!order.length && <p className="muted queue-empty">Nothing matches this filter.</p>}
      </div>

      <div className="queue-foot">
        {haveCount > 0
          ? <><span className="dot tone-have" aria-hidden="true" /><span><b>{haveCount}</b> already in your playlist · their own pass next</span></>
          : canCheck
            ? <span className="muted">None of these are in your playlist so far.</span>
            : <span className="muted">Playlist not synced: <button className="link" onClick={onSync}>sync it</button> to set aside songs you already have.</span>}
      </div>
    </nav>
  );
}
