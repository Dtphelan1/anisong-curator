import { useMemo, useState } from 'react';
import { displayTitle } from '../../lib/anilist';
import type { Decision, PlaylistSnapshot } from '../../lib/db';
import {
  planExport, REASON_LABEL, shortcutLine, themeNames, withStoreName,
  type AddedRecord, type DupIndex, type ExportItem, type StoreName,
} from '../../lib/dedupe';
import { songUrl } from '../../lib/itunes';
import type { MatchResult } from '../../lib/matching';
import { groupByShow, summarize, type RecordedBatch } from '../../lib/session';
import type { ReviewItem } from '../../lib/useMatching';
import { ShowCover } from './common';
import { ago, PlaylistSync, STALE_MS } from './PlaylistSync';

type ExportFormat = 'shortcut' | 'text' | 'json';
const EXPORT_KEY = 'anisong-curator.exportFormat';
const EXPORT_FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'shortcut', label: 'Shortcut', hint: 'Title | Artist | link, one per line: Anisong Add Kept adds the links' },
  { value: 'text', label: 'Text + links', hint: 'Readable: song, artist, show, then the link' },
  { value: 'json', label: 'JSON', hint: '{country, ids}: for the spike Anisong Add Tracks shortcut' },
];

interface Props {
  items: ReviewItem[];
  byKey: Map<string, ReviewItem>;
  review: string[];
  have: string[];
  decisions: Map<string, Decision>;
  matches: Map<string, MatchResult>;
  country: string;
  playlistName: string;
  playlist: DupIndex | null;
  snapshot: PlaylistSnapshot | null;
  onSnapshot: (s: PlaylistSnapshot) => void;
  syncOpen: boolean;
  onSyncOpen: (v: boolean) => void;
  added: AddedRecord[];
  storeNames: Map<number, StoreName>;
  onRecord: (items: ExportItem[]) => Promise<string>;
  onUndo: (batchId: string) => Promise<void>;
  onAddAnyway: (keys: string[], value: boolean) => Promise<void>;
  done?: RecordedBatch;
  onDone: (b: RecordedBatch | undefined) => void;
  /** Open a song in its pass, to change the decision. */
  onPick: (key: string) => void;
  onNewSession: () => void;
}

/** Phase 3: the songs to add, grouped by show in watch order, and the three steps to get them into the playlist. */
export function AddToPlaylistView(p: Props) {
  const { items, byKey, decisions, matches, country, playlistName, playlist, snapshot, added, storeNames } = p;
  const [copied, setCopied] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const [format, setFormatState] = useState<ExportFormat>(() => {
    try { const v = localStorage.getItem(EXPORT_KEY); return EXPORT_FORMATS.some((f) => f.value === v) ? (v as ExportFormat) : 'shortcut'; } catch { return 'shortcut'; }
  });
  const setFormat = (f: ExportFormat) => { setFormatState(f); try { localStorage.setItem(EXPORT_KEY, f); } catch { /* private mode */ } };

  // "Add anyway" lives on the decision, so the review, the already-have pass and this list agree.
  const overrides = useMemo(() => new Set([...decisions.values()].filter((d) => d.decision === 'keep' && d.addAnyway).map((d) => d.key)), [decisions]);
  // Watch order: `items` is seeded oldest show first, and the export keeps it.
  const exportItems = useMemo(() => items.flatMap<ExportItem>((it) => {
    const d = decisions.get(it.key);
    if (d?.decision !== 'keep' || !d.trackId) return [];
    const t = matches.get(it.key)?.candidates.find((x) => x.track.trackId === d.trackId)?.track;
    // The theme's romaji/native names and the JP-store name catch a playlist
    // that names the song differently (勇者 vs "Yuusha", "B no Revenge" vs "Revenge of B").
    return [withStoreName({
      key: it.key, trackId: d.trackId,
      title: t?.trackName ?? it.theme.songTitle ?? '', artist: t?.artistName ?? it.theme.artists.join(', '),
      durationMs: t?.trackTimeMillis ?? null, url: songUrl(d.trackId, country),
      label: `${displayTitle(it.show)} ${it.theme.slug}`,
      ...themeNames(it.theme),
    }, storeNames.get(d.trackId))];
  }), [items, decisions, matches, country, storeNames]);
  const plan = useMemo(() => planExport(exportItems, { playlist, added, overrides }), [exportItems, playlist, added, overrides]);
  const sum = useMemo(() => summarize(p.review, p.have, decisions, plan), [p.review, p.have, decisions, plan]);
  const groups = useMemo(() => groupByShow(plan.add, (k) => byKey.get(k)?.show.anilistId), [plan.add, byKey]);

  if (p.done) {
    const done = p.done;
    const undo = async () => {
      await p.onUndo(done.id);
      if (done.anyway?.length) await p.onAddAnyway(done.anyway, true);
      p.onDone(undefined);
    };
    return <SessionDone done={done} onUndo={undo} onNewSession={p.onNewSession} />;
  }

  const output =
    format === 'shortcut' ? plan.add.map(shortcutLine).join('\n')
    : format === 'text' ? plan.add.map((i) => `${i.title} — ${i.artist} (${i.label}) ${i.url}`).join('\n')
    : JSON.stringify({ country, ids: plan.add.map((i) => i.trackId) });
  const copy = async () => {
    try { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { prompt('Copy:', output); }
  };
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator && window.isSecureContext;
  const share = async () => { try { await navigator.share({ text: output }); } catch { /* cancelled */ } };
  const markAdded = async () => {
    if (!plan.add.length) return;
    const n = plan.add.length;
    const anyway = plan.add.filter((i) => overrides.has(i.key)).map((i) => i.key);
    const id = await p.onRecord(plan.add);
    // Recorded songs are in the add log now; clear their override so they can't go out again.
    await p.onAddAnyway(anyway, false);
    p.onDone({ id, n, at: Date.now(), playlistName, ...(anyway.length ? { anyway } : {}) });
  };
  const fresh = !!snapshot && Date.now() - snapshot.importedAt <= STALE_MS;

  return (
    <div className="add-layout">
      <main className="add-main">
        <div className="add-head">
          <h1>{plan.add.length ? `Add ${plan.add.length} song${plan.add.length === 1 ? '' : 's'} to ${playlistName}` : 'Nothing to add yet'}</h1>
          <div className="summary">
            {sum.toAdd > 0 && <span className="pill tone-ok">{[sum.kept > 0 && `${sum.kept} kept`, sum.addedAnyway > 0 && `${sum.addedAnyway} added anyway`].filter(Boolean).join(' + ')}</span>}
            {(sum.skipped > 0 || sum.haveSkipped > 0) && (
              <span className="pill tone-neutral">{[sum.skipped > 0 && `${sum.skipped} skipped`, sum.haveSkipped > 0 && `${sum.haveSkipped} already have, skipped`].filter(Boolean).join(' · ')}</span>
            )}
            {sum.later > 0 && <span className="pill tone-neutral">{sum.later} left for later</span>}
            {sum.undecided > 0 && <span className="pill tone-warn">{sum.undecided} not decided</span>}
            {sum.heldBack > 0 && <span className="pill tone-neutral">{sum.heldBack} held back</span>}
          </div>
        </div>

        {plan.add.length > 0 ? (
          <section className="add-list" aria-label="Songs to add, in watch order">
            <div className="eyebrow add-list-head">In watch order</div>
            {groups.map((g, i) => {
              const show = byKey.get(g.items[0]!.key)?.show;
              return (
                <div key={`${g.show}:${i}`} className="add-group">
                  {show && <ShowCover show={show} size="sm" />}
                  <div className="add-group-body">
                    <span className="add-show">{show ? displayTitle(show) : ''}</span>
                    <span className="add-songs">
                      {g.items.map((s, j) => (
                        <span key={s.key}>
                          {j > 0 && <span className="muted"> · </span>}
                          <button className="song-link" onClick={() => p.onPick(s.key)} title={`${s.artist} · ${s.label}: open it to change your decision`}>{s.title}</button>
                          {overrides.has(s.key) && <span className="have-text" title="Added anyway: you seem to have it already"> +</span>}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
          <p className="muted">Keep some songs in the review first. Songs you already have are skipped unless you add them anyway.</p>
        )}

        {plan.held.length > 0 && (
          <details className="held">
            <summary>Held back ({plan.held.length}): not added</summary>
            <ul>
              {plan.held.map((h) => (
                <li key={h.item.key}>
                  <span className="pill tone-have">{REASON_LABEL[h.reason]}</span>{' '}
                  <strong>{h.item.title}</strong> <span className="muted">— {h.item.artist} · {h.item.label} · matches {h.detail}</span>
                  {h.overridable && <label className="small"> <input type="checkbox" checked={overrides.has(h.item.key)} onChange={() => p.onAddAnyway([h.item.key], !overrides.has(h.item.key))} /> add anyway</label>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>

      <aside className="steps" aria-label="Steps">
        <div className={`step ${fresh ? '' : 'step-warn'}`}>
          <span className={`step-mark ${fresh ? 'ok' : 'warn'}`} aria-hidden="true">{fresh ? '✓' : '!'}</span>
          <div className="step-body">
            <b>{fresh ? 'Playlist checked' : snapshot ? 'Playlist check is old' : 'Playlist not checked'}</b>
            <span className="muted small">
              {snapshot ? `Synced ${ago(snapshot.importedAt)} · ${snapshot.rows.length} songs` : 'Only songs the app added are checked. Sync to catch the rest.'}
            </span>
            <PlaylistSync snapshot={snapshot} playlistName={playlistName} onSnapshot={p.onSnapshot} open={p.syncOpen} onOpen={p.onSyncOpen} />
          </div>
        </div>

        <div className="step step-current">
          <b>Copy, then run Anisong Add Kept</b>
          <button className="btn-accent btn-wide" onClick={copy} disabled={!plan.add.length}>{copied ? 'Copied ✓' : `Copy ${plan.add.length} song${plan.add.length === 1 ? '' : 's'}`}</button>
          {canShare && <button className="btn-line btn-wide" onClick={share} disabled={!plan.add.length} title="Share sheet: pick Anisong Add Kept directly">Share to the shortcut…</button>}
          <details className="format">
            <summary className="muted small">Format: {EXPORT_FORMATS.find((f) => f.value === format)?.label}</summary>
            <div className="format-body">
              <div className="segmented" role="radiogroup" aria-label="Export format">
                {EXPORT_FORMATS.map((f) => (
                  <button key={f.value} role="radio" aria-checked={format === f.value} onClick={() => setFormat(f.value)} title={f.hint}>{f.label}</button>
                ))}
              </div>
              {plan.add.length > 0 && <textarea className="export" readOnly value={output} rows={Math.min(6, Math.max(2, plan.add.length))} onFocus={(e) => e.currentTarget.select()} aria-label="Export text" />}
            </div>
          </details>
        </div>

        <div className="step">
          <b>Did they land?</b>
          <span className="muted small">Confirming records them, so the next session starts after this one. That's when the session is done.</span>
          <div className="step-actions">
            <button className="btn-ok" onClick={markAdded} disabled={!plan.add.length}>Yes, mark as added</button>
            <button className="btn-line" onClick={() => setNotYet(true)}>Not yet</button>
          </div>
          {notYet && <span className="muted small" role="status">No rush: your place is saved. Run <b>Anisong Add Kept</b>, check {playlistName}, then come back here.</span>}
        </div>
      </aside>
    </div>
  );
}

function SessionDone({ done, onUndo, onNewSession }: { done: RecordedBatch; onUndo: () => void; onNewSession: () => void }) {
  return (
    <div className="session-done" role="status">
      <span className="done-mark" aria-hidden="true">✓</span>
      <h1>Session done</h1>
      <p>
        {done.n} song{done.n === 1 ? '' : 's'} added to <b>{done.playlistName}</b>, recorded {new Date(done.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.
      </p>
      <p className="muted">They won't be offered again. See you next season.</p>
      <div className="step-actions">
        <button className="btn-line" onClick={onNewSession}>Pick new shows</button>
        <button className="link" onClick={onUndo}>Undo: they didn't land</button>
      </div>
    </div>
  );
}
