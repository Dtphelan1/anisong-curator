import { useState } from 'react';
import { saveSnapshot, SNAPSHOT_SOURCE, snapshotFromParse, type PlaylistSnapshot } from '../../lib/db';
import { parsePlaylist, type ParseResult } from '../../lib/playlistImport';

/** A snapshot older than this gets a gentle "sync first" prompt. */
export const STALE_MS = 7 * 24 * 3600 * 1000;

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
 * Sync playlist: a paste box for what Anisong Export Playlist copied (or a
 * Mac export / ⌘C rows). Saving replaces the snapshot with the same name.
 */
export function PlaylistSync({ snapshot, playlistName, onSnapshot, open, onOpen }: {
  snapshot: PlaylistSnapshot | null; playlistName: string; onSnapshot: (s: PlaylistSnapshot) => void; open: boolean; onOpen: (v: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const onText = (v: string) => { setText(v); setParsed(v.trim() ? parsePlaylist(v) : null); setSaved(null); };
  const save = async () => {
    if (!parsed?.rows.length) return;
    const s = snapshotFromParse(parsed, playlistName);
    await saveSnapshot(s);
    onSnapshot(s);
    setSaved(s.rows.length); setText(''); setParsed(null); onOpen(false);
  };
  const otherName = parsed?.playlistName && parsed.playlistName.trim() !== playlistName.trim() ? parsed.playlistName : null;

  return (
    <div className="sync">
      <div className="sync-line">
        {snapshot && <span className="badge" title={snapshot.warnings.join('\n') || undefined}>{SNAPSHOT_SOURCE[snapshot.format]}</span>}
        <button className="btn-line btn-sm" onClick={() => onOpen(!open)} aria-expanded={open}>{open ? 'Close' : 'Sync playlist'}</button>
        {saved !== null && <span className="ok small">Synced {saved} songs ✓</span>}
      </div>
      {open && (
        <div className="import">
          <p className="muted small">
            Run <strong>Anisong Export Playlist</strong> on your iPhone and paste what it copied. A Music.app export or rows copied with <kbd>⌘C</kbd> work too.
          </p>
          <textarea className="paste" value={text} onChange={(e) => onText(e.target.value)} rows={4} spellCheck={false} placeholder="anisong-playlist v2 …" aria-label="Paste playlist to sync" />
          {parsed && (
            <>
              <p className="small">
                <strong>{parsed.rows.length} songs</strong>{parsed.playlistName && <> from <strong>{parsed.playlistName}</strong></>}
                <span className="muted"> · {parsed.format === 'shortcut' ? 'iPhone shortcut' : parsed.format === 'export' ? 'Mac export' : parsed.format === 'pasted' ? 'pasted rows' : ''}</span>
              </p>
              {otherName && <p className="warn small">This is “{otherName}”, not your target playlist “{playlistName}”.</p>}
              {parsed.warnings.length > 0 && <ul className="warnings small">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </>
          )}
          <div className="sync-line">
            <button className="btn-accent btn-sm" onClick={save} disabled={!parsed?.rows.length}>Save {parsed?.rows.length ? `${parsed.rows.length} songs` : 'snapshot'}</button>
            <button className="btn-line btn-sm" onClick={() => { onOpen(false); onText(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
