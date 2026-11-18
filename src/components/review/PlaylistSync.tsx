import { loadLatestSnapshot, SNAPSHOT_SOURCE, type PlaylistSnapshot } from '../../lib/db';
import { STALE_MS } from '../../lib/playlistLibrary';
import { useCachedShows } from '../../lib/usePlaylistLibrary';
import { PlaylistImport } from '../playlist/PlaylistImport';

/** A playlist synced longer ago than this gets a gentle "sync first" prompt (the library's rule). */
export { STALE_MS };

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/**
 * Sync playlist, from the Add to playlist step: the playlist library's
 * import (what Anisong Export Playlist copied, a Mac export or ⌘C rows),
 * with the diff before saving and Undo after.
 */
export function PlaylistSync({ snapshot, playlistName, onSnapshot, open, onOpen }: {
  snapshot: PlaylistSnapshot | null; playlistName: string; onSnapshot: (s: PlaylistSnapshot) => void; open: boolean; onOpen: (v: boolean) => void;
}) {
  const shows = useCachedShows();
  const refresh = async () => { const s = await loadLatestSnapshot(); if (s) onSnapshot(s); };
  return (
    <div className="sync">
      <div className="sync-line">
        {snapshot && <span className="badge" title={snapshot.warnings.join('\n') || undefined}>{SNAPSHOT_SOURCE[snapshot.format]}</span>}
        <button className="btn-line btn-sm" onClick={() => onOpen(!open)} aria-expanded={open}>{open ? 'Close' : 'Sync playlist'}</button>
      </div>
      {open && (
        <div className="import">
          <PlaylistImport variant="settings" shows={shows} playlistName={playlistName} onDone={refresh} onCancel={() => onOpen(false)} />
        </div>
      )}
    </div>
  );
}
