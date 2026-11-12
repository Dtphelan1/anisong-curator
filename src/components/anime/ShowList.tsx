import { useEffect, useMemo, useRef, useState } from 'react';
import type { Show, SortField, ThemeLookup } from '../../types';
import { displayTitle } from '../../lib/anilist';
import { formatLabel } from '../../lib/mediaFormat';
import { SORT_FIELDS, type OrderedShow, type OrderOptions } from '../../lib/ordering';
import { buildPickerRows, songCount, statusLine, type GroupBy } from '../../lib/pickerRows';
import {
  invertSelection, rangeIds, selectAll, selectedIds, selectNewer, selectNone, selectOnly, setShows,
  type Selection, type SelectionContext,
} from '../../lib/selection';
import { NoSongs } from './NoSongs';

export interface ShowListProps {
  ordered: OrderedShow[];
  order: OrderOptions;
  onOrder: (o: OrderOptions) => void;
  boundId: number | null;
  selection: Selection;
  onSelect: (patch: { selection: Selection; boundId?: number | null }) => void;
  suggestedId: number | null;
  coverage: Map<number, { inPlaylist: number; total: number | null }>;
  cachedSongCounts: Map<number, number | 'none'>;
  includeInserts: boolean;
  /** While songs are being looked up: rows show their lookup state and can't be toggled. */
  lookup: { running: boolean; lookups: Map<number, ThemeLookup>; errors: Map<number, string> } | null;
  canFind: boolean;
  onFindSongs: () => void;
}

const GROUP_KEY = 'anisong-curator.anime.groupBy';
const readGroup = (): GroupBy => { try { return localStorage.getItem(GROUP_KEY) === 'none' ? 'none' : 'season'; } catch { return 'season'; } };

/** Typing in a field, or a key meant for a focused control. */
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'radio' || t.isContentEditable);

/**
 * The anime list: covers, season groups, the last-added divider, a title
 * filter, and SPEC §8.1's mouse and keyboard model (click toggles, Shift
 * range, Alt/Option "last added", Cmd/Ctrl only this; J/K or ↑/↓, Space, L,
 * A, N, I, ↵). Keys work anywhere on the page unless you're typing; `/`
 * focuses the filter and Esc clears it.
 */
export function ShowList(p: ShowListProps) {
  const { ordered, order, boundId, selection } = p;
  const [filter, setFilter] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroup);
  const [focus, setFocus] = useState(0);
  const anchor = useRef<{ index: number; value: boolean } | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const locked = p.lookup !== null;

  useEffect(() => { try { localStorage.setItem(GROUP_KEY, groupBy); } catch { /* private mode */ } }, [groupBy]);

  const ctx: SelectionContext = useMemo(() => ({ ordered, boundId, direction: order.direction }), [ordered, boundId, order.direction]);
  const selected = useMemo(() => selectedIds(selection, ctx), [selection, ctx]);
  const { rows, visible } = useMemo(
    () => buildPickerRows({ ordered, field: order.field, direction: order.direction, groupBy, filter, boundId }),
    [ordered, order.field, order.direction, groupBy, filter, boundId],
  );
  useEffect(() => { if (focus >= visible.length) setFocus(Math.max(0, visible.length - 1)); }, [visible.length, focus]);

  const set = (sel: Selection, nextBound?: number | null) => p.onSelect(nextBound === undefined ? { selection: sel } : { selection: sel, boundId: nextBound });
  const idAt = (i: number) => visible[i]?.show.anilistId;
  const lastAdded = (i: number) => { const id = idAt(i); if (id !== undefined) { anchor.current = null; set(selectNewer(), id); } };
  const toggleAt = (i: number) => {
    const id = idAt(i);
    if (id === undefined) return;
    const value = !selected.has(id);
    anchor.current = { index: i, value };
    set(setShows(selection, [id], value, ctx));
  };
  const rangeTo = (i: number) => {
    const a = anchor.current;
    if (!a) return toggleAt(i);
    set(setShows(selection, rangeIds(visible, a.index, i), a.value, ctx));
  };
  const onRow = (e: React.MouseEvent, i: number) => {
    setFocus(i);
    if (locked) return;
    if (e.altKey) return lastAdded(i);
    if (e.metaKey || e.ctrlKey) { const id = idAt(i)!; anchor.current = { index: i, value: true }; return set(selectOnly(id)); }
    if (e.shiftKey) return rangeTo(i);
    toggleAt(i);
  };
  const toggleGroup = (ids: number[]) => {
    if (locked) return;
    const allOn = ids.every((id) => selected.has(id));
    anchor.current = null;
    set(setShows(selection, ids, !allOn, ctx));
  };

  // Page-wide keys. The handler is rebuilt each render, so read state through a ref.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && e.target === filterRef.current) { setFilter(''); filterRef.current?.blur(); e.preventDefault(); return; }
    if (isTyping(e.target)) return;
    if (e.key === '/') { filterRef.current?.focus(); e.preventDefault(); return; }
    // Space/Enter on a focused button or link belong to it.
    if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return;
    if (e.key === 'Enter') { if (p.canFind) { p.onFindSongs(); e.preventDefault(); } return; }
    if (!visible.length) return;
    const move = (to: number) => {
      const next = Math.max(0, Math.min(visible.length - 1, to));
      if (e.shiftKey && !locked) {
        if (!anchor.current) toggleAt(focus);
        rangeTo(next);
      }
      setFocus(next);
    };
    const k = e.key;
    if (k === 'ArrowDown' || k === 'j' || k === 'J') move(focus + 1);
    else if (k === 'ArrowUp' || k === 'k' || k === 'K') move(focus - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(visible.length - 1);
    else if (k === 'PageDown') move(focus + 10);
    else if (k === 'PageUp') move(focus - 10);
    else if (locked) return;
    else if (k === ' ' || k === 'x') toggleAt(focus);
    else if (k === 'l' || k === 'L') lastAdded(focus);
    else if (k === 'a' || k === 'A') { anchor.current = null; set(selectAll()); }
    else if (k === 'n' || k === 'N') { anchor.current = null; set(selectNone()); }
    else if (k === 'i' || k === 'I') { anchor.current = null; set(invertSelection(selection, ctx)); }
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Keep the focused row in view (scroll-margin clears the sticky footer).
  const focusedId = idAt(focus);
  useEffect(() => {
    if (focusedId !== undefined) document.getElementById(`ap-row-${focusedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  const isDateSort = !!SORT_FIELDS.find((f) => f.value === order.field)?.isDate;

  return (
    <div className="ap-list-wrap">
      <div className="ap-toolbar">
        <label className="ap-filter">
          <kbd aria-hidden="true">/</kbd>
          <input ref={filterRef} type="search" value={filter} onChange={(e) => { setFilter(e.target.value); setFocus(0); }}
            placeholder="Filter titles" aria-label="Filter titles (press / to focus, Esc to clear)" />
        </label>
        <label className="ap-tool">Sort
          <select value={order.field} onChange={(e) => p.onOrder({ ...order, field: e.target.value as SortField })}>
            {SORT_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <button className="btn-line" onClick={() => p.onOrder({ ...order, direction: order.direction === 'asc' ? 'desc' : 'asc' })}
          title="Review and export always run oldest → newest">
          {order.direction === 'desc' ? 'Newest first ↓' : 'Oldest first ↑'}
        </button>
        <label className="ap-tool">Group
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} disabled={!isDateSort}
            title={isDateSort ? undefined : 'Season groups follow a date sort'}>
            <option value="season">Season</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>

      {filter && <p className="ap-filter-note muted">{visible.length} of {ordered.length} shows match “{filter}” · <button className="link" onClick={() => setFilter('')}>clear</button> (selection is unchanged)</p>}
      {!visible.length && <p className="muted ap-empty">{ordered.length ? 'No titles match.' : 'No shows on your list yet.'}</p>}

      <div className={`ap-list ${locked ? 'locked' : ''}`} role="listbox" aria-multiselectable="true" aria-label="Shows"
        aria-activedescendant={focusedId !== undefined ? `ap-row-${focusedId}` : undefined}>
        {rows.map((r) => {
          if (r.type === 'group') {
            const on = r.ids.filter((id) => selected.has(id)).length;
            return (
              <div key={`g-${r.key}`} className="ap-group" role="presentation">
                <span className="ap-group-label">{r.label}</span>
                <span className="ap-group-rule" />
                <button className="ap-group-toggle" onClick={() => toggleGroup(r.ids)} disabled={locked}
                  title={on === r.ids.length ? 'Deselect this group' : 'Select this group'}>
                  {on} of {r.ids.length} · toggle
                </button>
              </div>
            );
          }
          if (r.type === 'divider') {
            return (
              <div key="divider" className="ap-divider" role="presentation" title="Everything above this line is newer than the last show whose songs are in your playlist">
                <span>Last show added · {r.title}</span>
              </div>
            );
          }
          const s = r.o.show;
          const on = selected.has(s.anilistId);
          const line = statusLine(s);
          const fmt = s.format && s.format !== 'TV' ? formatLabel(s.format) : null;
          return (
            <div key={s.anilistId} id={`ap-row-${s.anilistId}`} role="option" aria-selected={on}
              className={['ap-row', on ? 'on' : '', r.index === focus ? 'focused' : '', s.anilistId === boundId ? 'bound' : ''].join(' ')}
              onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
              onClick={(e) => onRow(e, r.index)}>
              <span className="ap-check" aria-hidden="true">{on && <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>}</span>
              {s.coverImage ? <img className="ap-cover" src={s.coverImage} alt="" loading="lazy" /> : <span className="ap-cover" />}
              <span className="ap-title">
                <span className="ap-name">
                  {displayTitle(s)}{fmt && <span className="ap-fmt"> · {fmt}</span>}
                  {s.anilistId === p.suggestedId && s.anilistId !== boundId && <span className="ap-chip suggest" title="Your playlist ends with songs from this show">suggested</span>}
                </span>
                <span className={`ap-status ${line.tone}`}>{line.text}</span>
              </span>
              <SongCell show={s} selected={on} {...p} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The right-hand cell: lookup state while looking up, else cached ♪ count and playlist coverage. */
function SongCell({ show, selected, lookup, cachedSongCounts, coverage, includeInserts }: { show: Show; selected: boolean } & ShowListProps) {
  const id = show.anilistId;
  const cov = coverage.get(id);
  const covChip = cov && cov.inPlaylist > 0
    ? <span className="ap-chip have" title="Songs from this show already in your playlist">{cov.inPlaylist}{cov.total ? `/${cov.total}` : ''} in playlist</span>
    : null;
  if (lookup && selected) {
    const err = lookup.errors.get(id);
    if (err) return <span className="ap-songs"><span className="ap-nosongs bad" title={err}>lookup failed</span></span>;
    const l = lookup.lookups.get(id);
    if (!l) return <span className="ap-songs muted">{lookup.running ? 'looking…' : ''}</span>;
    const n = songCount(l, includeInserts);
    return <span className="ap-songs">{covChip}{n ? <span className="ap-count">♪ {n}</span> : <NoSongs show={show} incomplete={l.incomplete} />}</span>;
  }
  const c = cachedSongCounts.get(id);
  return (
    <span className="ap-songs">
      {covChip}
      <span className="ap-count" title={c === undefined ? 'Not looked up yet' : c === 'none' ? 'No openings or endings listed' : `${c} songs`}>
        ♪ {c === undefined ? '?' : c === 'none' ? '–' : c}
      </span>
    </span>
  );
}
