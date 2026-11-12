import type { SortField } from '../types';
import { displayTitle } from '../lib/anilist';
import { formatKey, isPartialDate, SORT_FIELDS, type OrderedShow, type OrderOptions } from '../lib/ordering';

interface Props {
  ordered: OrderedShow[];
  order: OrderOptions;
  onOrder: (o: OrderOptions) => void;
  boundId: number | null;
  onBound: (id: number | null) => void;
  /** Show suggested by the playlist tail (V2), if any. */
  suggestedId?: number | null;
  candidateCount: number;
  onContinue: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completed', DROPPED: 'Dropped', PAUSED: 'Paused', CURRENT: 'Watching', REPEATING: 'Rewatching',
};

export function ShowPicker({ ordered, order, onOrder, boundId, onBound, suggestedId = null, candidateCount, onContinue }: Props) {
  const boundIndex = boundId === null ? -1 : ordered.findIndex((o) => o.show.anilistId === boundId);
  const isCandidate = (i: number) =>
    boundIndex < 0 || (order.direction === 'asc' ? i > boundIndex : i < boundIndex);
  const bound = boundIndex >= 0 ? ordered[boundIndex] : undefined;

  return (
    <section className="card">
      <h2>2 · Which show did you last add songs from?</h2>
      <p className="muted">
        Click that show. Everything watched after it becomes a candidate. In-progress shows always sit at the recent end.
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
        <span>
          {bound ? <>Last added: <strong>{displayTitle(bound.show)}</strong> · </> : 'No show picked: all shows are candidates · '}
          <strong>{candidateCount}</strong> candidate shows
        </span>
        {bound && <button className="secondary" onClick={() => onBound(null)}>Clear</button>}
        <button onClick={onContinue} disabled={!candidateCount}>Find songs →</button>
      </div>

      <div className="scroll">
        <table className="shows">
          <thead>
            <tr><th>#</th><th>{SORT_FIELDS.find((f) => f.value === order.field)?.label}</th><th>Title</th><th>Status</th><th>Season</th></tr>
          </thead>
          <tbody>
            {ordered.map((o, i) => {
              const s = o.show;
              const partial = order.field === 'completedAt' && o.keySource === 'primary' && isPartialDate(s.completedAt);
              return (
                <tr
                  key={s.anilistId}
                  className={[s.anilistId === boundId ? 'bound' : '', isCandidate(i) ? 'candidate' : 'done'].join(' ')}
                  onClick={() => onBound(s.anilistId)}
                  title="Click to mark as the last show already in your playlist"
                >
                  <td className="muted">{i + 1}</td>
                  <td className="nowrap">
                    {formatKey(o, order.field)}
                    {o.keySource === 'missing' && <span className="badge warn">no date</span>}
                    {o.keySource === 'fallback' && <span className="badge" title="No completion date; using last list update">last update</span>}
                    {partial && <span className="badge" title="AniList only has part of this date">partial</span>}
                  </td>
                  <td>{displayTitle(s)}{s.anilistId === suggestedId && <span className="badge suggested" title="Suggested from your playlist's last songs">suggested</span>}</td>
                  <td><span className={`badge status-${s.status.toLowerCase()}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                  <td className="muted nowrap">{[s.season?.toLowerCase(), s.seasonYear].filter(Boolean).join(' ')} {s.format}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
