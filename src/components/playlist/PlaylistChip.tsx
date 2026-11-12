import { useEffect, useRef, useState } from 'react';
import type { PlaylistItem, PlaylistStatus } from '../../lib/playlistLibrary';
import { usePlaylistLibrary } from '../../lib/usePlaylistLibrary';
import './playlist.css';

interface Props {
  /** Open the "Your playlist" page (optionally on a filter). */
  onOpen: (filter?: 'unseen') => void;
  /** Open the import (Settings → Playlist, or setup's step). */
  onResync: () => void;
  /** Settings → Playlist. Shown as a link in the popover when given. */
  onSettings?: () => void;
  /** Fallback name before any import names the playlist (settings.playlistName). */
  playlistName?: string;
}

const WEEK = 7 * 24 * 3600 * 1000;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const SOURCE: Record<string, string> = { export: 'Mac export', shortcut: 'iPhone shortcut', pasted: 'pasted rows' };

/** App adds by state: not seen in a sync made after them, or added since the last sync. */
export function addsState(items: PlaylistItem[], syncedAt: number | null) {
  const app = items.filter((i) => i.origin === 'app');
  const unseen = syncedAt === null ? [] : app.filter((i) => (i.addedAt ?? 0) < syncedAt);
  return { unseen, since: app.filter((i) => !unseen.includes(i)) };
}

/** The playlist's status in the header: synced, out of date, linking, or none yet. */
export function PlaylistChip({ onOpen, onResync, onSettings, playlistName }: Props) {
  const { status, items } = usePlaylistLibrary();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!status || (!status.rowCount && !status.syncedAt)) {
    return (
      <button className="pl-chip is-empty" onClick={onResync} title="Duplicate checks only know the songs the app added until you import the playlist">
        <span className="pl-dot tone-empty" aria-hidden="true" />No playlist yet · Import
      </button>
    );
  }

  const name = status.name || playlistName || 'Playlist';
  const tone = status.linking ? 'accent' : status.stale ? 'warn' : 'ok';
  const detail = status.linking
    ? status.linking.phase === 'themes' ? 'linking…' : `linking ${status.linking.done} of ${status.linking.total}`
    : status.stale && status.syncedAt ? `synced ${Math.max(1, Math.round((Date.now() - status.syncedAt) / WEEK))} wk ago`
    : status.stale ? 'not synced' : String(status.rowCount);

  return (
    <div className="pl-chip-wrap" ref={ref}>
      <button className="pl-chip" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <span className={`pl-dot tone-${tone}`} aria-hidden="true" />
        <span>{name}</span><span className="muted">· {detail}</span>
      </button>
      {open && <Popover status={status} items={items} name={name} onOpen={(f) => { setOpen(false); onOpen(f); }} onResync={() => { setOpen(false); onResync(); }} onSettings={onSettings && (() => { setOpen(false); onSettings(); })} />}
    </div>
  );
}

function Popover({ status, items, name, onOpen, onResync, onSettings }: {
  status: PlaylistStatus; items: PlaylistItem[]; name: string; onOpen: (f?: 'unseen') => void; onResync: () => void; onSettings?: () => void;
}) {
  const { unseen, since } = addsState(items, status.syncedAt);
  const shows = new Set(items.flatMap((i) => i.anilistIds)).size;
  const pct = status.rowCount ? Math.round((status.linked / status.rowCount) * 100) : 0;
  const ev = status.lastImport;
  return (
    <div className="pl-pop" role="dialog" aria-label={`${name}: playlist status`}>
      <h3>{name}</h3>
      <p className="small">
        {status.rowCount} songs{since.length > 0 && ` · ${since.length} added since the last sync`}
        <br />
        <span className="muted">
          {status.syncedAt ? `Last sync ${fmtDate(status.syncedAt)}${ev ? ` · ${SOURCE[ev.format] ?? ev.format} · ${ev.orderIsPlaylist ? 'in playlist order' : 'in import order'}` : ''}` : 'Not synced yet: only the app’s own adds'}
        </span>
      </p>
      <div>
        <div className="pl-pop-row"><span>{status.linked} linked to {shows} shows</span><span className="muted">{pct}%</span></div>
        <div className="pl-bar tone-have"><span style={{ width: `${pct}%` }} /></div>
        <p className="muted small" style={{ marginTop: 4 }}>
          {status.linking ? `Linking ${status.linking.phase === 'themes' ? '…' : `${status.linking.done} of ${status.linking.total}`}`
            : status.unlinked ? `${status.unlinked} unlinked, mostly shows that aren't on your AniList list` : status.pending ? `${status.pending} not linked yet` : 'Every song is linked'}
        </p>
      </div>
      {unseen.length > 0 && (
        <div className="pl-pop-note">
          <span>{unseen.length} song{unseen.length === 1 ? '' : 's'} you added {unseen.length === 1 ? "isn't" : "aren't"} in the playlist yet</span>
          <button className="link" onClick={() => onOpen('unseen')}>Show →</button>
        </div>
      )}
      <div className="pl-pop-actions">
        <button className="btn-primary" onClick={() => onOpen()}>Open playlist</button>
        <button className="btn-line" onClick={onResync}>Re-sync…</button>
      </div>
      {onSettings && <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={onSettings}>Playlist settings</button>}
    </div>
  );
}
