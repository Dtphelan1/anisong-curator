import { useEffect, useMemo, useRef, useState } from 'react';
import type { Show } from '../../types';
import { describeMapping, parsePlaylist, type ParseResult } from '../../lib/playlistImport';
import type { ImportPreview, LinkProgress, PlaylistItem } from '../../lib/playlistLibrary';
import { hitLabel, usePlaylistLibrary } from '../../lib/usePlaylistLibrary';
import './playlist.css';

interface Props {
  /** setup: first import, no diff or undo; settings: diff, then Save sync and Undo. */
  variant: 'setup' | 'settings';
  /** The AniList list: linking needs it, and it names the linked shows. */
  shows: Show[];
  onDone?: () => void;
  onCancel?: () => void;
  /** Setup only: "Skip for now". */
  onSkip?: () => void;
  /** Name to use when the input doesn't name the playlist (settings.playlistName). */
  playlistName?: string;
}

const FORMAT_LABEL: Record<string, string> = { export: 'Music.app export', pasted: 'rows copied with ⌘C', shortcut: 'Anisong Export Playlist', empty: '' };

/**
 * Add the playlist, check what changed, save. Used by setup ("Your
 * playlist") and Settings ("Re-sync"). Nothing is written until Save.
 */
export function PlaylistImport({ variant, shows, onDone, onCancel, onSkip, playlistName = '' }: Props) {
  const { status, lib } = usePlaylistLibrary();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [linked, setLinked] = useState<PlaylistItem[] | null>(null);
  const [progress, setProgress] = useState<LinkProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ n: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const showsById = useMemo(() => new Map(shows.map((s) => [s.anilistId, s])), [shows]);
  const run = useRef(0);

  useEffect(() => { lib.canUndo().then(setCanUndo); }, [lib, saved]);

  async function load(p: ParseResult) {
    const id = ++run.current;
    setParsed(p); setPreview(null); setLinked(null); setSaved(null); setError(null);
    if (!p.rows.length) return;
    try {
      const pv = await lib.preview(p);
      if (id !== run.current) return;
      setPreview(pv);
      // Link the new songs in memory, so the preview says where they go. No Apple Music lookups.
      if (shows.length && pv.added.length) {
        setProgress({ phase: 'themes', done: 0, total: 1 });
        const next = await lib.linkPreview(pv.next, (pr) => { if (id === run.current) setProgress(pr); });
        if (id !== run.current) return;
        setLinked(next);
      }
    } catch (e) {
      if (id === run.current) setError((e as Error).message);
    } finally {
      if (id === run.current) setProgress(null);
    }
  }
  const onText = (v: string) => { setText(v); setFileName(null); if (v.trim()) load(parsePlaylist(v)); else { setParsed(null); setPreview(null); } };
  async function onFile(f: File | undefined) {
    if (!f) return;
    try { setText(''); setFileName(f.name); load(parsePlaylist(await f.arrayBuffer())); } catch (e) { setError((e as Error).message); }
  }
  function reset() { run.current++; setText(''); setFileName(null); setParsed(null); setPreview(null); setLinked(null); setProgress(null); }

  async function save() {
    if (!preview) return;
    const next = linked ?? preview.next;
    await lib.commit({ ...preview, next }, playlistName);
    setSaved({ n: next.length });
    reset();
    onDone?.();
  }
  async function undo() {
    await lib.undoLastImport();
    setSaved(null);
    setCanUndo(false);
  }

  const items = linked ?? preview?.next ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const added = (preview?.added ?? []).map((i) => byId.get(i.id) ?? i);
  const linkedCount = items.filter((i) => i.link?.state === 'linked').length;
  const linkedShows = new Set(items.flatMap((i) => i.anilistIds)).size;
  const first = variant === 'setup' || !status?.rowCount;
  const otherName = preview?.playlistName && playlistName && preview.playlistName.trim() !== playlistName.trim() ? preview.playlistName : null;

  if (saved && !preview) {
    return (
      <div className="pl-import">
        <div className="pl-done" role="status">
          <span className="ok">✓ Saved {saved.n} songs.</span>
          {variant === 'settings' && canUndo && <button className="btn-line btn-sm" onClick={undo}>Undo last sync</button>}
          <button className="link" onClick={() => setSaved(null)}>Sync again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pl-import">
      {!first && (
        <ol className="pl-steps" aria-label="Steps">
          <li className={parsed ? 'done' : 'current'}>1 · Add the playlist{parsed ? ' ✓' : ''}</li>
          <li className={preview ? 'current' : ''}>2 · Check the changes</li>
          <li>3 · Save</li>
        </ol>
      )}

      {!parsed ? (
        <div className="pl-add">
          <p className="muted small">
            On a Mac: in Music, choose <b>View → Sort By → Playlist Order</b>, then <b>File → Library → Export Playlist…</b> as <i>Plain Text</i>, and add the file.
            On an iPhone: run <b>Anisong Export Playlist</b> and paste what it copied (its order isn't playlist order, so it adds songs without reordering).
            Rows copied with <kbd>⌘C</kbd> work too.
          </p>
          <label className="pl-drop">
            <input type="file" accept=".txt,text/plain,text/tab-separated-values" onChange={(e) => onFile(e.target.files?.[0])} />
            <span>Add the exported file…</span>
          </label>
          <textarea className="paste" value={text} onChange={(e) => onText(e.target.value)} rows={4} spellCheck={false}
            placeholder="…or paste here (⌘V)" aria-label="Paste the playlist" />
        </div>
      ) : (
        <div className="pl-file">
          <span>
            <b>{fileName ?? (parsed.playlistName || 'Pasted text')}</b>
            <span className="muted"> · {FORMAT_LABEL[parsed.format]} · {parsed.rows.length} songs · {parsed.ordered ? 'in playlist order' : parsed.sortedBy ? `sorted by ${parsed.sortedBy.field}, so not in playlist order` : 'not in playlist order'}</span>
          </span>
          <button className="link" onClick={reset}>Use a different file or paste</button>
        </div>
      )}

      {parsed && !parsed.rows.length && <p className="bad small">No songs found in that. Check it's a plain-text export or the shortcut's text.</p>}
      {parsed?.guessed && <p className="warn small">Columns guessed: {describeMapping(parsed.mapping)}. Check the songs below look right.</p>}
      {parsed && parsed.warnings.length > 0 && <ul className="warnings small">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {otherName && <p className="warn small">This is “{otherName}”, not “{playlistName}”.</p>}
      {error && <p className="bad small">{error}</p>}

      {preview && (
        <>
          {first ? (
            <p className="pl-first">
              <b>{preview.next.length} songs</b>
              {linked ? <> · <b>{linkedCount}</b> linked to {linkedShows} shows · {preview.next.length - linkedCount} unlinked <span className="muted">(fine: songs from shows that aren't on your AniList list stay unlinked)</span></>
                : !shows.length ? <span className="muted"> · they'll be linked to your shows once your AniList list is loaded</span> : null}
            </p>
          ) : (
            <div className="pl-cards">
              <Card n={`+${preview.event.diff.new}`} label="new" />
              <Card n={preview.event.diff.missing} label="missing" />
              <Card n={preview.event.diff.renamed} label="renamed, link kept" />
              {status && status.pendingAdds + preview.confirmed.length > 0 && (
                <Card n={`${preview.confirmed.length} of ${preview.confirmed.length + preview.unseen.length}`} label="your adds confirmed" tone="have" />
              )}
              <Card n={preview.event.diff.unchanged} label="unchanged" muted />
            </div>
          )}

          {progress && (
            <div className="pl-progress" role="status">
              <div className="pl-progress-line">
                <span>{progress.phase === 'themes' ? 'Looking up the openings and endings of your shows' : `Linking ${first ? 'the songs' : `the ${added.length} new songs`} to your shows`} · no Apple Music lookups</span>
                <span className="muted">{progress.total > 1 ? `${progress.done} of ${progress.total}` : ''}</span>
              </div>
              <div className="pl-bar"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
            </div>
          )}

          {!first && (
            <div className="pl-diff">
              <section>
                <div className="eyebrow">New · {added.length}</div>
                <ul className="pl-list">
                  {added.slice(0, 8).map((it) => (
                    <li key={it.id}>
                      <span className="muted">#{it.position + 1}</span>
                      <span className="pl-name"><b>{it.title}</b> <span className="muted">· {it.artist}</span></span>
                      <span className="pl-link-cell">{it.link?.state === 'linked' ? hitLabel(it.link.hits[0]!, showsById) : it.link ? <span className="muted">not linked</span> : progress ? <span className="accent-text">linking…</span> : ''}</span>
                    </li>
                  ))}
                </ul>
                {added.length > 8 && <p className="muted small">+ {added.length - 8} more</p>}
              </section>
              <section>
                {(preview.confirmed.length > 0 || preview.unseen.length > 0) && (
                  <>
                    <div className="eyebrow">Your adds</div>
                    <ul className="pl-list">
                      {preview.confirmed.map((it) => <li key={it.id}><span className="ok" aria-label="confirmed">✓</span><span className="pl-name">{it.title} <span className="muted">· now #{it.position + 1}</span></span></li>)}
                      {preview.unseen.map((it) => <li key={it.id}><span className="warn" aria-label="not seen">!</span><span className="pl-name">{it.title} · <span className="warn">still not in your playlist, stays at the end</span></span></li>)}
                    </ul>
                  </>
                )}
                {(preview.renamed.length > 0 || preview.missing.length > 0) && (
                  <>
                    <div className="eyebrow">Renamed · {preview.renamed.length} &amp; missing · {preview.missing.length}</div>
                    <ul className="pl-list">
                      {preview.renamed.slice(0, 5).map((r) => (
                        <li key={r.item.id}><span className="pl-name">{r.from.title} → {r.item.title} <span className="muted">· {r.item.artist}{r.item.link?.state === 'linked' ? ` · still ${hitLabel(r.item.link.hits[0]!, showsById)}` : ''}</span></span></li>
                      ))}
                      {preview.missing.slice(0, 6).map((it) => <li key={it.id}><span className="pl-name">{it.title} <span className="muted">· {it.artist} · missing</span></span></li>)}
                    </ul>
                    {preview.missing.length > 0 && <p className="muted small">Missing songs drop out of the library. If one comes up in a review again, it's suggested like any other song.</p>}
                  </>
                )}
                {!preview.orderReplaced && <p className="muted small">This list isn't in playlist order, so the stored order stays and new songs go to the end.</p>}
              </section>
            </div>
          )}
        </>
      )}

      <div className="pl-actions">
        {variant === 'setup' ? (
          <>
            <button className="btn-accent" onClick={save} disabled={!preview?.next.length}>Continue</button>
            {onSkip && <button className="btn-line" onClick={onSkip}>Skip for now</button>}
            <span className="muted small">You can import or re-sync later from the playlist button.</span>
          </>
        ) : (
          <>
            <button className="btn-accent" onClick={save} disabled={!preview?.next.length}>Save sync</button>
            <button className="btn-line" onClick={() => { reset(); onCancel?.(); }}>Cancel</button>
            {canUndo && !preview && <button className="link" onClick={undo}>Undo last sync</button>}
            <span className="muted small">Nothing changes until you save.{canUndo ? ' Undo last sync puts back the previous version.' : ''}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ n, label, tone, muted }: { n: number | string; label: string; tone?: 'have'; muted?: boolean }) {
  return (
    <div className={`pl-card${tone ? ` tone-${tone}` : ''}${muted ? ' is-muted' : ''}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}
