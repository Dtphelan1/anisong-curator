import { useEffect, useMemo, useRef, useState } from 'react';
import type { SortField } from '../types';
import { displayTitle } from '../lib/anilist';
import { formatKey, isPartialDate, SORT_FIELDS, type OrderedShow, type OrderOptions } from '../lib/ordering';
import {
  invertSelection, isPlainNewer, rangeIds, selectAll, selectedIds, selectNewer, selectNone, selectOnly,
  setShows, type Selection, type SelectionContext,
} from '../lib/selection';

interface Props {
  ordered: OrderedShow[];
  order: OrderOptions;
  onOrder: (o: OrderOptions) => void;
  boundId: number | null;
  selection: Selection;
  onSelect: (patch: { selection: Selection; boundId?: number | null }) => void;
  /** Show suggested by the playlist tail (V2), if any. */
  suggestedId?: number | null;
  candidateCount: number;
  onContinue: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completed', DROPPED: 'Dropped', PAUSED: 'Paused', CURRENT: 'Watching', REPEATING: 'Rewatching',
};

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'checkbox';

/**
 * "Which anime would you like to add?" A navigable, multi-select list.
 * Starting from the last show you added (select everything newer) is the
 * quick way in, not the only one: add or remove any show on top of it.
 */
export function ShowPicker({ ordered, order, onOrder, boundId, selection, onSelect, suggestedId = null, candidateCount, onContinue }: Props) {
  const ctx: SelectionContext = useMemo(() => ({ ordered, boundId, direction: order.direction }), [ordered, boundId, order.direction]);
  const selected = useMemo(() => selectedIds(selection, ctx), [selection, ctx]);
  const [focus, setFocus] = useState(0);
  // Anchor for Shift ranges: the last row clicked/toggled, and the state it was set to.
  const anchor = useRef<{ index: number; value: boolean } | null>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const bound = boundId === null ? undefined : ordered.find((o) => o.show.anilistId === boundId);

  const set = (sel: Selection, nextBound?: number | null) => onSelect(nextBound === undefined ? { selection: sel } : { selection: sel, boundId: nextBound });
  const lastAdded = (i: number) => { const id = ordered[i]?.show.anilistId; if (id !== undefined) { anchor.current = null; set(selectNewer(), id); } };
  const toggleAt = (i: number) => {
    const id = ordered[i]?.show.anilistId;
    if (id === undefined) return;
    const value = !selected.has(id);
    anchor.current = { index: i, value };
    set(setShows(selection, [id], value, ctx));
  };
  const rangeTo = (i: number) => {
    const a = anchor.current;
    if (!a) return toggleAt(i);
    set(setShows(selection, rangeIds(ordered, a.index, i), a.value, ctx));
  };

  /** Mouse: click toggles · Shift range · Alt "last added" · Cmd/Ctrl only this. */
  const onRow = (e: React.MouseEvent, i: number) => {
    setFocus(i);
    if (e.altKey) return lastAdded(i);
    if (e.metaKey || e.ctrlKey) { const id = ordered[i]!.show.anilistId; anchor.current = { index: i, value: true }; return set(selectOnly(id)); }
    if (e.shiftKey) return rangeTo(i);
    toggleAt(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !ordered.length) return;
    const move = (to: number) => {
      const next = Math.max(0, Math.min(ordered.length - 1, to));
      if (e.shiftKey) {
        // Extend: the anchor's state spreads to each row you move onto.
        if (!anchor.current) toggleAt(focus);
        rangeTo(next);
      }
      setFocus(next);
    };
    const k = e.key;
    if (k === 'ArrowDown' || k === 'j' || k === 'J') move(focus + 1);
    else if (k === 'ArrowUp' || k === 'k' || k === 'K') move(focus - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(ordered.length - 1);
    else if (k === 'PageDown') move(focus + 10);
    else if (k === 'PageUp') move(focus - 10);
    else if (k === ' ' || k === 'x') toggleAt(focus);
    else if (k === 'l' || k === 'L') lastAdded(focus);
    else if (k === 'a' || k === 'A') { anchor.current = null; set(selectAll()); }
    else if (k === 'n' || k === 'N') { anchor.current = null; set(selectNone()); }
    else if (k === 'i' || k === 'I') { anchor.current = null; set(invertSelection(selection, ctx)); }
    else if (k === 'Enter' && candidateCount) onContinue();
    else return;
    e.preventDefault();
  };

  // Keep the focused row visible.
  useEffect(() => {
    body.current?.children[focus]?.scrollIntoView({ block: 'nearest' });
  }, [focus]);
  useEffect(() => { if (focus >= ordered.length) setFocus(Math.max(0, ordered.length - 1)); }, [ordered.length, focus]);

  const summary = isPlainNewer(selection)
    ? bound ? <>everything newer than <strong>{displayTitle(bound.show)}</strong> (last added)</> : 'all shows'
    : selection.base === 'all' ? `all shows${selection.exclude.length ? `, minus ${selection.exclude.length}` : ''}`
    : selection.base === 'none' ? (selection.include.length ? 'hand-picked' : 'nothing selected')
    : <>newer than <strong>{bound ? displayTitle(bound.show) : '—'}</strong>, with {selection.include.length + selection.exclude.length} change{selection.include.length + selection.exclude.length === 1 ? '' : 's'}</>;

  return (
    <section className="card">
      <h2>2 · Which anime would you like to add?</h2>
      <p className="muted">
        Tick the shows to look up songs for. Quick start: <strong>Alt/Option-click</strong> (or <kbd>L</kbd>) the last show whose songs
        are already in your playlist to select everything newer, then adjust. In-progress shows sit at the recent end.
      </p>
      <div className="row">
        <label>Sort by
          <select value={order.field} onChange={(e) => onOrder({ ...order, field: e.target.value as SortField })}>
            {SORT_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <button className="secondary" onClick={() => onOrder({ ...order, direction: order.direction === 'asc' ? 'desc' : 'asc' })}>
          {order.direction === 'asc' ? 'Oldest first ↓' : 'Newest first ↑'}
        </button>
        <label><input type="checkbox" checked={order.includeDropped} onChange={(e) => onOrder({ ...order, includeDropped: e.target.checked })} /> Dropped</label>
        <label><input type="checkbox" checked={order.includePaused} onChange={(e) => onOrder({ ...order, includePaused: e.target.checked })} /> Paused</label>
      </div>

      <div className="row sticky">
        <span><strong>{candidateCount}</strong> of {ordered.length} selected <span className="muted">· {summary}</span></span>
        <span className="spacer" />
        <div className="segmented small-seg" aria-label="Select">
          <button onClick={() => { anchor.current = null; set(selectAll()); }} title="Select all (A)">All <kbd>A</kbd></button>
          <button onClick={() => { anchor.current = null; set(selectNone()); }} title="Select none (N)">None <kbd>N</kbd></button>
          <button onClick={() => { anchor.current = null; set(invertSelection(selection, ctx)); }} title="Invert (I)">Invert <kbd>I</kbd></button>
          {bound && !isPlainNewer(selection) && (
            <button onClick={() => { anchor.current = null; set(selectNewer()); }} title={`Reset to everything newer than ${displayTitle(bound.show)}`}>Newer than last added</button>
          )}
        </div>
        <button onClick={onContinue} disabled={!candidateCount}>Find songs → <kbd>↵</kbd></button>
      </div>

      <div className="scroll picker" tabIndex={0} onKeyDown={onKey} aria-label="Shows: arrow keys to move, Space to toggle">
        <table className="shows" role="grid" aria-multiselectable="true">
          <thead>
            <tr><th aria-label="Included" /><th>#</th><th>{SORT_FIELDS.find((f) => f.value === order.field)?.label}</th><th>Title</th><th>Status</th><th>Season</th></tr>
          </thead>
          <tbody ref={body}>
            {ordered.map((o, i) => {
              const s = o.show;
              const on = selected.has(s.anilistId);
              const partial = order.field === 'completedAt' && o.keySource === 'primary' && isPartialDate(s.completedAt);
              return (
                <tr
                  key={s.anilistId}
                  role="row"
                  aria-selected={on}
                  className={[on ? 'sel' : 'unsel', i === focus ? 'focused' : '', s.anilistId === boundId ? 'bound' : ''].join(' ')}
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); /* no text selection on Shift-click */ }}
                  onClick={(e) => onRow(e, i)}
                >
                  <td className="check" onClick={(e) => { e.stopPropagation(); onRow(e, i); }}>
                    <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-label={`${on ? 'Exclude' : 'Include'} ${displayTitle(s)}`} />
                  </td>
                  <td className="muted">{i + 1}</td>
                  <td className="nowrap">
                    {formatKey(o, order.field)}
                    {o.keySource === 'missing' && <span className="badge warn">no date</span>}
                    {o.keySource === 'fallback' && <span className="badge" title="No completion date; using last list update">last update</span>}
                    {partial && <span className="badge" title="AniList only has part of this date">partial</span>}
                  </td>
                  <td>
                    {displayTitle(s)}
                    {s.anilistId === boundId && <span className="badge bound-badge" title="Last show whose songs are in your playlist">last added</span>}
                    {s.anilistId === suggestedId && s.anilistId !== boundId && <span className="badge suggested" title="Suggested from your playlist's last songs">suggested</span>}
                  </td>
                  <td><span className={`badge status-${s.status.toLowerCase()}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                  <td className="muted nowrap">{[s.season?.toLowerCase(), s.seasonYear].filter(Boolean).join(' ')} {s.format}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        <strong>Click</strong> or <kbd>Space</kbd> toggle · <strong>Shift</strong>-click / <kbd>Shift</kbd>+<kbd>↑</kbd><kbd>↓</kbd> range ·{' '}
        <strong>Alt/Option</strong>-click or <kbd>L</kbd> last added (select everything newer) · <strong>Cmd/Ctrl</strong>-click only this ·{' '}
        <kbd>↑</kbd><kbd>↓</kbd>/<kbd>J</kbd><kbd>K</kbd> move · <kbd>A</kbd> all · <kbd>N</kbd> none · <kbd>I</kbd> invert · <kbd>↵</kbd> find songs
      </p>
    </section>
  );
}
