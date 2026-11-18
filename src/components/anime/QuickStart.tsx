import { useId, useState } from 'react';
import { displayTitle } from '../../lib/anilist';
import type { OrderedShow } from '../../lib/ordering';
import { DEFAULT_LATEST_COUNT, withBase, type Selection, type SelectionBase } from '../../lib/selection';

interface Props {
  ordered: OrderedShow[];
  boundId: number | null;
  selection: Selection;
  onSelect: (patch: { selection: Selection; boundId?: number | null }) => void;
  suggestion: { anilistId: number; evidence: string } | null;
  lastSessionAt: number | null;
  locked: boolean;
}

const DAY = 86_400_000;
/** Local yyyy-mm-dd, as a date input wants it. */
export const isoDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * "Start from": the quick starts that set the selection's base. Hand edits
 * made in the list stay on top of whichever one is chosen.
 */
export function QuickStart({ ordered, boundId, selection, onSelect, suggestion, lastSessionAt, locked }: Props) {
  const name = useId();
  const [whyOpen, setWhyOpen] = useState(false);
  const bound = boundId === null ? undefined : ordered.find((o) => o.show.anilistId === boundId);
  const suggested = suggestion && suggestion.anilistId !== boundId ? ordered.find((o) => o.show.anilistId === suggestion.anilistId) : undefined;
  // "Since" defaults to your last session, else three months back (sessions are quarterly).
  const lastSession = lastSessionAt ? isoDate(lastSessionAt) : null;
  const since = selection.since ?? lastSession ?? isoDate(Date.now() - 90 * DAY);
  const count = selection.count ?? DEFAULT_LATEST_COUNT;
  const finished = ordered.filter((o) => o.bucket === 'A');

  const pick = (base: SelectionBase, patch: { since?: string; count?: number } = {}) => onSelect({ selection: withBase(selection, base, patch) });
  // Clicking anywhere in an option, its fields included, chooses it.
  const option = (base: SelectionBase, title: string, body: React.ReactNode, patch?: { since?: string; count?: number }, aside?: React.ReactNode) => {
    const on = selection.base === base;
    return (
      <div className={`qs ${on ? 'on' : ''}`} onClick={() => { if (!on && !locked) pick(base, patch); }}>
        <div className="qs-head">
          <label>
            <input type="radio" name={name} checked={on} disabled={locked} onChange={() => pick(base, patch)} />
            <span>{title}</span>
          </label>
          {aside}
        </div>
        {body && <div className="qs-body">{body}</div>}
      </div>
    );
  };

  return (
    <div className="qs-list" role="radiogroup" aria-label="Start from">
      {option('newer', 'After the last show added', (
        <>
          <label className="qs-bound">
            <span className="sr-only">Last show added</span>
            {bound?.show.coverImage && <img className="qs-cover" src={bound.show.coverImage} alt="" />}
            <select value={boundId ?? ''} disabled={locked}
              onChange={(e) => onSelect({ selection: withBase(selection, 'newer'), boundId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{bound ? '' : 'None yet: choose a show'}</option>
              {finished.map((o) => <option key={o.show.anilistId} value={o.show.anilistId}>{displayTitle(o.show)}</option>)}
            </select>
          </label>
          {!bound && <p className="qs-hint">Or Alt/Option-click a row, or press <kbd>L</kbd> on it.</p>}
          {suggested && (
            <div className="qs-suggest" title={suggestion?.evidence}>
              <span>Your playlist now ends with songs from <b>{displayTitle(suggested.show)}</b>. Start after that?</span>
              <button className="btn-line" disabled={locked}
                onClick={(e) => { e.stopPropagation(); onSelect({ selection: withBase(selection, 'newer'), boundId: suggested.show.anilistId }); }}>Use</button>
            </div>
          )}
        </>
      ))}

      {option('since', 'Finished since', (
        <>
          <div className="qs-row">
            <input type="date" value={since} disabled={locked} aria-label="Finished on or after"
              onChange={(e) => pick('since', { since: e.target.value })} />
            {since === lastSession && <span className="qs-hint">your last session</span>}
          </div>
          {whyOpen && (
            <p className="qs-note">
              Counts shows by their AniList <b>completion date</b> only: “everything I finished since my last session”.
              Dropped or paused shows have no completion date, so they're left out (tick them by hand). Shows you're watching
              are always in. If “After the last show added” already covers this for you, this option may go.
            </p>
          )}
        </>
      ), { since }, (
        <button className="qs-why" aria-expanded={whyOpen} aria-label="What counts as finished since?" title="What counts?"
          onClick={(e) => { e.stopPropagation(); setWhyOpen(!whyOpen); }}>?</button>
      ))}

      {option('latest', 'The last shows I finished', (
        <div className="qs-row">
          <span>Last</span>
          <input type="number" min={1} max={500} value={count} disabled={locked} aria-label="Number of shows"
            onChange={(e) => pick('latest', { count: Math.max(1, Number(e.target.value) || 1) })} />
          <span>shows</span>
        </div>
      ), { count })}

      {option('none', 'Pick by hand', <span className="qs-hint">Start with nothing selected.</span>)}

      {selection.base === 'all' && <p className="qs-hint">Every listed show is selected (<kbd>A</kbd>). Pick a quick start to narrow it.</p>}
    </div>
  );
}
