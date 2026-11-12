import { useEffect, useMemo, useState } from 'react';
import type { Show, ThemeLookup } from '../types';
import { displayTitle } from '../lib/anilist';
import { db, deleteSnapshot, saveSnapshot, SNAPSHOT_SOURCE, snapshotFromParse, themeCache, type PlaylistSnapshot } from '../lib/db';
import type { MatchResult } from '../lib/matching';
import type { OrderedShow } from '../lib/ordering';
import { describeMapping, parsePlaylist, type ParseResult, type PlaylistRow } from '../lib/playlistImport';
import { buildThemeIndex, inferTail, TAIL_DEFAULT, type ThemeHit, type TailRow } from '../lib/tailInference';
import { resolveThemes, type ResolveProgress } from '../lib/themes';

interface Props {
  snapshot: PlaylistSnapshot | null;
  onSnapshot: (s: PlaylistSnapshot | null) => void;
  shows: Show[];
  ordered: OrderedShow[];
  direction: 'asc' | 'desc';
  boundId: number | null;
  onBound: (id: number) => void;
  onSuggest: (id: number | null) => void;
  playlistName?: string;
}

const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '');

/**
 * Import the playlist (Music.app export, pasted rows, or the Anisong Export
 * Playlist shortcut's text), keep it as a snapshot, and suggest the "last
 * show already in the playlist" from its tail. The tail only means something
 * for an ordered snapshot.
 */
export function PlaylistPanel({ snapshot, onSnapshot, shows, ordered, direction, boundId, onBound, onSuggest, playlistName }: Props) {
  const [importing, setImporting] = useState(false);
  const showForm = importing || !snapshot;

  async function save(s: PlaylistSnapshot) {
    await saveSnapshot(s);
    onSnapshot(s);
    setImporting(false);
  }
  async function remove() {
    if (!snapshot) return;
    await deleteSnapshot(snapshot.name);
    onSnapshot(null);
  }

  return (
    <section className="card">
      <h2>Import your playlist <span className="muted small">optional · suggests the last show below</span></h2>
      {snapshot && !importing && (
        <div className="row">
          <span>
            <strong>{snapshot.name}</strong> · {snapshot.rows.length} songs · imported {new Date(snapshot.importedAt).toLocaleString()}
            {' '}<span className="badge" title={snapshot.format === 'pasted' ? 'Columns were guessed from pasted rows' : undefined}>{SNAPSHOT_SOURCE[snapshot.format]}</span>
          </span>
          <button className="secondary" onClick={() => setImporting(true)}>Re-import</button>
          <button className="link" onClick={remove}>Remove</button>
        </div>
      )}
      {showForm && <ImportForm defaultName={playlistName} onSave={save} onCancel={snapshot ? () => setImporting(false) : undefined} />}
      {snapshot && !importing && (snapshot.ordered
        ? <TailView snapshot={snapshot} shows={shows} ordered={ordered} direction={direction} boundId={boundId} onBound={onBound} onSuggest={onSuggest} />
        : <UnorderedNotice snapshot={snapshot} onSuggest={onSuggest} />)}
    </section>
  );
}

/** No "last show" from a snapshot whose row order isn't playlist order. */
function UnorderedNotice({ snapshot, onSuggest }: { snapshot: PlaylistSnapshot; onSuggest: (id: number | null) => void }) {
  useEffect(() => { onSuggest(null); }, [onSuggest]);
  const why = snapshot.format === 'shortcut'
    ? 'Songs from Anisong Export Playlist may not come in playlist order'
    : `This ${snapshot.format === 'export' ? 'export' : 'list'} is sorted${snapshot.sortedBy ? ` by ${{ title: 'Name', artist: 'Artist', album: 'Album' }[snapshot.sortedBy.field]}` : ''}, not in playlist order`;
  return (
    <p className="warn-text small unordered">
      {why}, so it can't suggest the last show. It's still used to catch duplicates. For a suggestion, export from Music on a Mac
      with <strong>View → Sort By → Playlist Order</strong>, then <strong>File → Library → Export Playlist…</strong>, and re-import.
    </p>
  );
}

function ImportForm({ onSave, onCancel, defaultName = '' }: { onSave: (s: PlaylistSnapshot) => void; onCancel?: () => void; defaultName?: string }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [name, setName] = useState(defaultName);
  const [fileErr, setFileErr] = useState<string | null>(null);

  function onText(v: string) {
    setText(v);
    const p = v.trim() ? parsePlaylist(v) : null;
    setParsed(p);
    if (p?.playlistName) setName(p.playlistName);
    else if (!name) setName(defaultName || 'Pasted rows');
  }
  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileErr(null);
    try {
      setParsed(parsePlaylist(await f.arrayBuffer()));
      setText('');
      setName(f.name.replace(/\.(txt|tsv|csv)$/i, ''));
    } catch (e) {
      setFileErr((e as Error).message);
    }
  }

  return (
    <div className="import">
      <p className="muted small">
        In Music on a Mac, select the playlist, choose <strong>View → Sort By → Playlist Order</strong>, then <strong>File → Library → Export Playlist…</strong> and save as <em>Plain Text</em>.
        Or paste what <strong>Anisong Export Playlist</strong> copied on your iPhone (duplicate checks only: its order isn't playlist order),
        or select songs in the playlist, press <kbd>⌘C</kbd>, and paste them below.
      </p>
      <div className="row">
        <label>Export file <input type="file" accept=".txt,text/plain,text/tab-separated-values" onChange={(e) => onFile(e.target.files?.[0])} /></label>
      </div>
      <textarea
        className="paste"
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder="…or paste here (⌘V)"
        rows={4}
        spellCheck={false}
        aria-label="Paste playlist rows"
      />
      {fileErr && <p className="bad">{fileErr}</p>}
      {parsed && <ParsePreview parsed={parsed} />}
      <div className="row">
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" size={18} /></label>
        <button
          disabled={!parsed?.rows.length}
          onClick={() => parsed && onSave({ ...snapshotFromParse(parsed, name), name: name.trim() || parsed.playlistName || 'Playlist' })}
        >
          Save {parsed?.rows.length ? `${parsed.rows.length} songs` : 'snapshot'}
        </button>
        {onCancel && <button className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function ParsePreview({ parsed }: { parsed: ParseResult }) {
  const { rows } = parsed;
  const head = rows.slice(0, 5);
  const tail = rows.length > 8 ? rows.slice(-3) : rows.slice(5);
  return (
    <div className="preview">
      <div className="row">
        <strong>{rows.length} songs</strong>
        <span className="muted">{parsed.format === 'export' ? 'Music.app export' : parsed.format === 'pasted' ? 'pasted rows' : parsed.format === 'shortcut' ? 'Anisong Export Playlist' : ''}{parsed.encoding !== 'text' && ` · ${parsed.encoding}`}</span>
      </div>
      {parsed.guessed && (
        <p className="warn-text small">Columns guessed: {describeMapping(parsed.mapping)}. Check that the rows below look right.</p>
      )}
      {parsed.warnings.length > 0 && <ul className="warnings small">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {rows.length > 0 && (
        <div className="scroll">
          <table className="rows">
            <thead><tr><th>#</th><th>Name</th><th>Artist</th><th>Album</th><th>Time</th></tr></thead>
            <tbody>
              {head.map((r) => <RowCells key={r.position} r={r} />)}
              {rows.length > 8 && <tr><td colSpan={5} className="muted">… {rows.length - 8} more …</td></tr>}
              {tail.map((r) => <RowCells key={r.position} r={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const RowCells = ({ r }: { r: PlaylistRow }) => (
  <tr><td className="muted">{r.position}</td><td>{r.title}</td><td>{r.artist}</td><td className="muted">{r.album}</td><td className="muted nowrap">{mmss(r.durationMs)}</td></tr>
);

function TailView({ snapshot, shows, ordered, direction, boundId, onBound, onSuggest }: Omit<Props, 'onSnapshot'> & { snapshot: PlaylistSnapshot }) {
  const listShows = useMemo(() => shows.filter((s) => s.status !== 'PLANNING'), [shows]);
  const [lookups, setLookups] = useState<Map<number, ThemeLookup> | null>(null);
  const [progress, setProgress] = useState<ResolveProgress | null>(null);
  const [failed, setFailed] = useState(0);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [n, setN] = useState(TAIL_DEFAULT);
  const [attempt, setAttempt] = useState(0);

  // Themes for the WHOLE list (not just candidates): one batched AnimeThemes
  // call per 50 shows, cached. Jikan is skipped here to keep it to a few
  // requests; only found lookups are cached, so the Jikan fallback still
  // runs for candidates later.
  useEffect(() => {
    if (!listShows.length) return;
    let cancelled = false;
    setLookups(null); setFailed(0);
    const cache = themeCache();
    resolveThemes(listShows, {
      cache: { get: cache.get, put: (l) => (l.status === 'found' ? cache.put(l) : Promise.resolve()) },
      jikan: async () => [],
      onProgress: (p) => { if (!cancelled) setProgress(p); },
    }).then(({ lookups, errors }) => {
      if (cancelled) return;
      setLookups(lookups); setFailed(errors.size);
    });
    db.matches.toArray().then((m) => { if (!cancelled) setMatches(m); });
    return () => { cancelled = true; };
  }, [listShows, attempt]);

  const index = useMemo(() => (lookups ? buildThemeIndex(listShows, (s) => lookups.get(s.anilistId)?.themes ?? []) : null), [lookups, listShows]);
  const result = useMemo(
    () => (index ? inferTail({ rows: snapshot.rows, index, ordered, direction, matches, n }) : null),
    [index, snapshot.rows, ordered, direction, matches, n],
  );
  const suggested = result?.suggestion ?? null;
  useEffect(() => { onSuggest(suggested?.show.anilistId ?? null); }, [suggested?.show.anilistId, onSuggest]);

  if (!listShows.length) return <p className="muted">Load your AniList list to map the playlist onto shows.</p>;
  if (!result || !index) {
    return (
      <p className="muted">
        Looking up OP/ED songs for your {listShows.length} shows…{progress && progress.total > 0 && ` ${progress.done}/${progress.total}`}
      </p>
    );
  }

  const withThemes = listShows.filter((s) => lookups?.get(s.anilistId)?.themes.length).length;
  return (
    <div className="tail">
      <div className={`suggestion ${suggested ? '' : 'none'}`}>
        {suggested ? (
          <>
            <div>
              Suggested last show: <strong>{displayTitle(suggested.show)}</strong>
              <span className="muted"> · from “{snapshot.rows.find((r) => r.position === suggested.rowPosition)?.title}” ({suggested.hit.theme.slug})</span>
              {suggested.weak && <span className="badge warn" title="Only one song points here, and the match is not certain">check this</span>}
            </div>
            <div className="row">
              {boundId === suggested.show.anilistId
                ? <span className="ok-text">✓ Set as the last show</span>
                : <button onClick={() => onBound(suggested.show.anilistId)}>Use as last show</button>}
              <span className="muted small">It's the mapped show that comes latest in your current sort order. You can still click any show below.</span>
            </div>
          </>
        ) : (
          <span>No song in the last {n} matched a show on your list. Pick the last show by hand below.</span>
        )}
      </div>

      <div className="row small">
        <label>Last <input type="number" min={5} max={500} step={5} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || TAIL_DEFAULT))} style={{ width: 64 }} /> songs</label>
        <span className="muted">
          {result.mapped} mapped · {result.unmatched} not on your list{result.excluded > 0 && ` · ${result.excluded} hidden by filters`}
          {' · '}themes known for {withThemes}/{listShows.length} shows
        </span>
        {failed > 0 && <><span className="bad">AnimeThemes lookup failed for {failed} shows.</span><button className="link" onClick={() => setAttempt((a) => a + 1)}>retry</button></>}
      </div>

      <details open>
        <summary>Playlist tail → shows</summary>
        <div className="scroll">
          <table className="tail-map">
            <tbody>
              {result.tail.map((t) => (
                <TailRowView key={t.row.position} t={t} isSuggestion={!!suggested && t.row.position === suggested.rowPosition} />
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function confBadge(h: ThemeHit) {
  if (h.method === 'exact') return <span className="badge conf-high" title="Same track as a match you already reviewed">exact</span>;
  return h.confidence >= 0.8
    ? <span className="badge conf-high">{Math.round(h.confidence * 100)}</span>
    : <span className="badge conf-check" title="Likely: title and artist (or show name) agree">{Math.round(h.confidence * 100)}</span>;
}

function TailRowView({ t, isSuggestion }: { t: TailRow; isSuggestion: boolean }) {
  const { row, pick } = t;
  return (
    <tr className={[isSuggestion ? 'bound' : '', pick ? '' : 'unmatched'].join(' ')}>
      <td className="muted nowrap">{row.position}</td>
      <td>{row.title} <span className="muted">— {row.artist}</span></td>
      <td>
        {pick ? (
          <>
            {displayTitle(pick.show)} <span className="muted">· {pick.theme.slug}</span>
            {t.orderIndex === null && <span className="badge warn" title="This show is hidden by the current filters (dropped/paused)">hidden</span>}
            {t.hits.length > 1 && <span className="badge" title={t.hits.map((h) => displayTitle(h.show)).join(', ')}>+{t.hits.length - 1} other show{t.hits.length > 2 ? 's' : ''}</span>}
          </>
        ) : (
          <span className="muted" title={t.nearest ? `Closest: ${displayTitle(t.nearest.show)} ${t.nearest.theme.slug} (${Math.round(t.nearest.confidence * 100)})` : undefined}>
            not on your list / not an anisong
          </span>
        )}
      </td>
      <td className="nowrap">{pick && confBadge(pick)}</td>
    </tr>
  );
}
