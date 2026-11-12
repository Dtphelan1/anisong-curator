import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { displayTitle } from '../lib/anilist';
import { saveSnapshot, SNAPSHOT_SOURCE, snapshotFromParse, type Decision, type DecisionValue, type PlaylistSnapshot } from '../lib/db';
import { lookup, parseAppleMusicUrl, searchSongs, songUrl, type ItunesTrack } from '../lib/itunes';
import { confidenceOf, rankTracks, type Flag, type MatchPrefs } from '../lib/matcher';
import type { Candidate, MatchResult } from '../lib/matching';
import { chosenTrack } from '../lib/tailInference';
import {
  addedAsRows, checkSources, indexRows, planExport, REASON_LABEL, shortcutLine, themeNames, TIER_LABEL,
  withStoreName, type AddedRecord, type DupHit, type DupIndex, type ExportItem, type StoreName,
} from '../lib/dedupe';
import { parsePlaylist, type ParseResult } from '../lib/playlistImport';
import { useAdded } from '../lib/useAdded';
import { useStoreNames } from '../lib/useStoreNames';
import { useDecisions, useMatching, type ReviewItem } from '../lib/useMatching';
import { claim, stopSample, toggleSample, usePlayingSample } from '../lib/sampler';
import {
  computeOrder, counts as filterCounts, DEFAULT_VIEW, FILTERS, isStale, nextUndecidedKey, SORT_LABEL, stepKey, withCurrent,
  type MatchState, type QueueEntry, type SortField as QueueSort, type ViewOptions,
} from '../lib/queueView';

interface Props {
  items: ReviewItem[];
  country: string;
  prefs: MatchPrefs;
  autoplay: boolean;
  /** Synced playlist snapshot, for the "already in playlist" check. */
  snapshot: PlaylistSnapshot | null;
  onSnapshot: (s: PlaylistSnapshot) => void;
  playlistName: string;
  onSettings: (patch: { country?: string; preferTvSize?: boolean; autoplay?: boolean; playlistName?: string }) => void;
  onBack: () => void;
}

const FLAG_LABEL: Record<Flag, string> = {
  tv: 'TV size', instrumental: 'instrumental', karaoke: 'karaoke', live: 'live', firstTake: 'THE FIRST TAKE',
  remix: 'remix', acoustic: 'acoustic', cover: 'cover?', altVersion: 'alt version', soundtrack: 'soundtrack album',
};
const STOREFRONTS = ['us', 'ca', 'gb', 'au', 'jp', 'de', 'fr', 'es', 'it', 'nl', 'se', 'br', 'mx', 'kr', 'tw', 'hk', 'sg', 'ph', 'in'];
const CONF_LABEL = { high: 'confident', check: 'check me', low: 'unlikely', none: 'no match' } as const;
const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '');
const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

export function Review({ items, country, prefs, autoplay, snapshot, onSnapshot, playlistName, onSettings, onBack }: Props) {
  // The current song is tracked by key, not position: re-sorting, filtering or a
  // status change never swaps the song you're looking at.
  const [currentKey, setCurrentKey] = useState<string | null>(items[0]?.key ?? null);
  const index = Math.max(0, items.findIndex((i) => i.key === currentKey));
  const setIndex = useCallback((i: number) => setCurrentKey(items[i]?.key ?? null), [items]);
  const [tab, setTab] = useState<'queue' | 'kept' | 'later'>('queue');
  const cardRef = useRef<HTMLElement>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const { matches, status, errors, choose, rematch } = useMatching(items, country, prefs, index);
  const { decisions, decide, setAddAnyway } = useDecisions(useMemo(() => items.map((i) => i.key), [items]));
  const audio = useRef<HTMLAudioElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  const item = items[index];
  const match = item ? matches.get(item.key) : undefined;
  const chosen = match?.candidates.find((c) => c.track.trackId === match.chosenId);
  const decision = item ? decisions.get(item.key) : undefined;

  const { added, record, undoBatch } = useAdded();
  const playlist = useMemo(() => (snapshot ? indexRows(snapshot.rows, { artistsKnown: snapshot.artistsKnown !== false }) : null), [snapshot]);
  const addedIndex = useMemo(() => (added.length ? indexRows(addedAsRows(added)) : null), [added]);
  // JP-store names of kept tracks (勇者 for "Yuusha"): extra alt names for the check.
  const keptIds = useMemo(() => [...decisions.values()].flatMap((d) => (d.decision === 'keep' && d.trackId ? [d.trackId] : [])), [decisions]);
  const storeNames = useStoreNames(keptIds, country);
  // Same scoring as the export plan, so the badges and the held-back list agree.
  const inPlaylist = useMemo(() => {
    const m = new Map<string, DupHit>();
    if (!playlist && !addedIndex) return m;
    for (const it of items) {
      const t = chosenTrack(matches.get(it.key));
      if (!t) continue;
      const hit = checkSources(
        withStoreName({ trackId: t.trackId, title: t.trackName, artist: t.artistName, durationMs: t.trackTimeMillis, ...themeNames(it.theme) }, storeNames.get(t.trackId)),
        { playlist, added, addedIndex },
      );
      if (hit) m.set(it.key, hit);
    }
    return m;
  }, [playlist, added, addedIndex, items, matches, storeNames]);
  // Every song gets an explicit decision: songs already in the playlist are
  // flagged (banner, colour, queue marker), never hidden or skipped for you.
  const have = item ? inPlaylist.get(item.key) : undefined;

  // ---- Queue view: sort/filter/group with a frozen order (see queueView.ts) ----
  const entries = useMemo<QueueEntry[]>(() => items.map((it, i) => ({
    key: it.key, index: i, anime: displayTitle(it.show), title: it.theme.songTitle ?? '',
    match: matchState(matches.get(it.key), status.get(it.key)),
    decision: decisions.get(it.key)?.decision ?? 'undecided',
    have: inPlaylist.has(it.key),
  })), [items, matches, status, decisions, inPlaylist]);
  const [view, setViewState] = useState<ViewOptions>(loadView);
  const [frozen, setFrozen] = useState<string[]>(() => computeOrder(entries, view));
  // The order changes only when you change the view or ask for a refresh.
  const setView = useCallback((v: ViewOptions) => { setViewState(v); setFrozen(computeOrder(entries, v)); saveView(v); }, [entries]);
  const refreshOrder = useCallback(() => setFrozen(computeOrder(entries, view)), [entries, view]);
  const order = useMemo(() => withCurrent(frozen, currentKey, entries), [frozen, currentKey, entries]);
  const stale = useMemo(() => isStale(frozen, entries, view), [frozen, entries, view]);

  const step = useCallback((dir: 1 | -1) => {
    const k = stepKey(order, currentKey, dir);
    if (k) setCurrentKey(k);
  }, [order, currentKey]);
  const nextUndecided = useCallback(() => {
    const undecided = (k: string) => !decisions.has(k);
    // Next undecided in the visible order; if the view has none left, anywhere.
    const k = nextUndecidedKey(order, currentKey, undecided) ?? items.find((i) => i.key !== currentKey && undecided(i.key))?.key ?? null;
    if (k) setCurrentKey(k); else step(1);
  }, [order, currentKey, decisions, items, step]);
  const pick = useCallback((key: string) => {
    setCurrentKey(key);
    // Single-column layout: bring the card back into view.
    if (window.matchMedia('(max-width: 899px)').matches) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const doDecide = useCallback(async (d: DecisionValue, addAnyway = false) => {
    if (!item) return;
    if (d === 'keep' && !match?.chosenId) return; // nothing to keep yet
    await decide(item.key, d, d === 'keep' ? match?.chosenId ?? null : null, addAnyway);
    nextUndecided();
  }, [item, match, decide, nextUndecided]);
  /** A: keep a song you already have and export it anyway; on an already-kept song, toggle the override in place. */
  const addAnywayKey = useCallback(async () => {
    if (!item || !have || have.sameTrack && have.source === 'added') return;
    if (decision?.decision === 'keep') await setAddAnyway([item.key], !decision.addAnyway);
    else await doDecide('keep', true);
  }, [item, have, decision, setAddAnyway, doDecide]);

  // On open, jump to the first undecided song (once decisions have loaded).
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !decisions.size) return;
    landed.current = true;
    const first = items.findIndex((i) => !decisions.has(i.key));
    if (first > 0) setIndex(first);
  }, [decisions, items]);

  // Reset per-item UI; autoplay the preview.
  useEffect(() => { setShowCandidates(false); stopSample(); }, [currentKey]);
  // The card's player and the candidate sampler never play at once.
  useEffect(() => (audio.current ? claim(audio.current) : undefined), [currentKey, !!chosen]);
  useEffect(() => {
    const el = audio.current;
    if (!el || !chosen?.track.previewUrl) return;
    el.src = chosen.track.previewUrl;
    if (autoplay) el.play().catch(() => { /* blocked until first interaction */ });
  }, [chosen?.track.previewUrl, autoplay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'k') doDecide('keep');
      else if (k === 's') doDecide('skip');
      else if (k === 'l') doDecide('later');
      else if (k === 'a') addAnywayKey();
      else if (k === 'arrowright' || k === 'j') step(1);
      else if (k === 'arrowleft' || k === 'h') step(-1);
      else if (k === 'c') setShowCandidates((v) => !v);
      else if (k === '/') { e.preventDefault(); searchBox.current?.focus(); }
      else if (k === ' ') {
        e.preventDefault();
        const el = audio.current;
        if (el) (el.paused ? el.play() : (el.pause(), Promise.resolve())).catch(() => {});
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doDecide, step, addAnywayKey]);

  const counts = useMemo(() => {
    let keep = 0, skip = 0, later = 0;
    for (const d of decisions.values()) d.decision === 'keep' ? keep++ : d.decision === 'skip' ? skip++ : later++;
    const pending = items.filter((i) => status.get(i.key) !== 'done' && status.get(i.key) !== 'error').length;
    return { keep, skip, later, pending };
  }, [decisions, items, status]);

  if (!item) return <section className="card"><p>No songs to review.</p><button className="secondary" onClick={onBack}>← Back</button></section>;

  return (
    <div className="review-layout">
      <section className="card review review-main" ref={cardRef} aria-label="Song under review">
        <div className="row">
          <button className="secondary" onClick={onBack}>← Songs</button>
          <strong>{index + 1}/{items.length}</strong>
          <span className="muted">kept {counts.keep} · skipped {counts.skip} · later {counts.later}</span>
          {counts.pending > 0 && <span className="muted">· matching {counts.pending} more (~{Math.ceil(counts.pending * 1.7 * 3 / 60)} min)</span>}
          <span className="spacer" />
        </div>

        <div className="song-head">
          <div className="muted">{displayTitle(item.show)} · <strong>{item.theme.slug}</strong>{item.theme.episodes && ` · eps ${item.theme.episodes}`}</div>
          <h2 className="song-title">
            {item.theme.songTitle ?? 'Unknown title'}
            {item.theme.songTitleNative && <span className="muted"> · {item.theme.songTitleNative}</span>}
          </h2>
          <div>{item.theme.artists.join(', ') || <span className="muted">artist unknown</span>}</div>
        </div>

        {have && chosen && <HaveBanner hit={have} addAnyway={decision?.decision === 'keep' && !!decision.addAnyway} />}
        <MatchView item={item} match={match} chosen={chosen} status={status.get(item.key)} error={errors.get(item.key)} audioRef={audio} inPlaylist={have} />

        <div className="row actions">
          <button onClick={() => doDecide('keep')} disabled={!chosen} className={`${have ? 'have-btn' : ''} ${decision?.decision === 'keep' && !decision.addAnyway ? 'on' : ''}`}
            title={have ? "Keep it, but hold it back from the export: it's already in your playlist" : undefined}>
            {have ? 'Keep (held back)' : 'Keep'} <kbd>K</kbd>
          </button>
          {have && !(have.sameTrack && have.source === 'added') && (
            <button className={`secondary have-btn ${decision?.decision === 'keep' && decision.addAnyway ? 'on' : ''}`} onClick={addAnywayKey} disabled={!chosen}
              title="Keep and export it even though it looks like it's already in your playlist">
              Keep &amp; add anyway <kbd>A</kbd>
            </button>
          )}
          <button className={`secondary ${decision?.decision === 'skip' ? 'on' : ''}`} onClick={() => doDecide('skip')}>Skip <kbd>S</kbd></button>
          <button className={`secondary ${decision?.decision === 'later' ? 'on' : ''}`} onClick={() => doDecide('later')}>Later <kbd>L</kbd></button>
          {decision && <button className="link" onClick={() => decide(item.key, null, null)}>undo</button>}
          <span className="spacer" />
          <button className="secondary" onClick={() => step(-1)}>← <kbd>←</kbd></button>
          <button className="secondary" onClick={() => step(1)}><kbd>→</kbd> →</button>
        </div>

        {match && match.candidates.length > 1 && (
          <details open={showCandidates} onToggle={(e) => setShowCandidates((e.target as HTMLDetailsElement).open)}>
            <summary>Other candidates ({match.candidates.length - 1}) <kbd>C</kbd></summary>
            <CandidateList candidates={match.candidates.filter((c) => c.track.trackId !== match.chosenId)} onUse={(t) => choose(item, t)} />
          </details>
        )}

        <ManualSearch key={item.key} item={item} country={country} prefs={prefs} inputRef={searchBox} onUse={(t) => choose(item, t)} />
        {match && match.method !== 'manual' && <button className="link" onClick={() => rematch(item)}>re-run search</button>}

        <p className="muted small">
          <kbd>K</kbd> keep · <kbd>A</kbd> keep &amp; add anyway (songs you already have) · <kbd>S</kbd> skip · <kbd>L</kbd> later · <kbd>←</kbd>/<kbd>→</kbd> move · <kbd>space</kbd> play/pause · <kbd>C</kbd> candidates · <kbd>/</kbd> search
        </p>
        <div className="row small">
          <label>Store
            <select value={country} onChange={(e) => onSettings({ country: e.target.value })} title="Apple Music storefront: matches are re-run for a new store">
              {[...new Set([country, ...STOREFRONTS])].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </label>
          <label><input type="checkbox" checked={prefs.preferTvSize} onChange={(e) => onSettings({ preferTvSize: e.target.checked })} /> Prefer TV size</label>
          <label><input type="checkbox" checked={autoplay} onChange={(e) => onSettings({ autoplay: e.target.checked })} /> Autoplay previews</label>
          <label>Playlist <input value={playlistName} onChange={(e) => onSettings({ playlistName: e.target.value })} size={18} title="Name of your running Apple Music playlist" /></label>
        </div>
      </section>

      <aside className="review-side" aria-label="Queue, kept and later songs">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>Queue <span className="muted">{items.length}</span></button>
          <button role="tab" aria-selected={tab === 'kept'} className={tab === 'kept' ? 'on' : ''} onClick={() => setTab('kept')}>Kept <span className="muted">{counts.keep}</span></button>
          <button role="tab" aria-selected={tab === 'later'} className={tab === 'later' ? 'on' : ''} onClick={() => setTab('later')}>Later <span className="muted">{counts.later}</span></button>
        </div>
        {tab === 'queue' && (
          <Queue items={items} entries={entries} order={order} currentKey={currentKey} onPick={pick} matches={matches} decisions={decisions} inPlaylist={inPlaylist}
            view={view} onView={setView} stale={stale} onRefresh={refreshOrder} />
        )}
        {tab === 'kept' && (<div className="side-scroll">
          <KeptSummary items={items} matches={matches} decisions={decisions} country={country} playlistName={playlistName} playlist={playlist} snapshot={snapshot} onSnapshot={onSnapshot} added={added} storeNames={storeNames} onRecord={record} onUndo={undoBatch} onAddAnyway={setAddAnyway} />
        </div>)}
        {tab === 'later' && (<div className="side-scroll">
          <LaterList items={items} decisions={decisions} inPlaylist={inPlaylist} onPick={(i) => pick(items[i]!.key)} />
          {!counts.later && <p className="muted card">No songs marked Later.</p>}
        </div>)}
      </aside>
    </div>
  );
}

const VIEW_KEY = 'anisong-curator.queueView';
function loadView(): ViewOptions {
  try { return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<ViewOptions>) }; } catch { return DEFAULT_VIEW; }
}
function saveView(v: ViewOptions) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}

function matchState(m: MatchResult | undefined, st: string | undefined): MatchState {
  if (st !== 'done' && st !== 'error') return 'pending';
  if (!m || st === 'error') return 'no-match';
  if (m.userPicked) return 'your-pick';
  const c = confidenceOf(m.score);
  return c === 'high' ? 'confident' : c === 'check' ? 'check' : c === 'low' ? 'unlikely' : 'no-match';
}

function Flags({ c, theme }: { c: Candidate; theme: ReviewItem['theme'] }) {
  return (
    <>
      {c.flags.map((f) => <span key={f} className={`badge ${f === 'cover' || f === 'karaoke' || f === 'instrumental' ? 'bad' : 'warn'}`}>{FLAG_LABEL[f]}</span>)}
      {theme.artists.length > 0 && c.artistSim < 0.6 && !c.flags.includes('cover') && <span className="badge warn" title="Artist differs from AnimeThemes; could be a cover, or a localized/alias name">different artist</span>}
    </>
  );
}

function InPlaylistBadge({ hit }: { hit?: DupHit }) {
  if (!hit) return null;
  const name = `${hit.row.title}${hit.row.artist ? ` — ${hit.row.artist}` : ''}`;
  const where = hit.source === 'added' ? `Added by the app: ${name}` : `Playlist #${hit.row.position}: ${name}`;
  const label = hit.source === 'added' && hit.tier !== 'other-version' ? 'already added' : TIER_LABEL[hit.tier];
  return <span className={`badge have have-${hit.tier}`} title={`${where} (match ${Math.round(hit.score * 100)}%)`}>{label}</span>;
}

const HAVE_HEADLINE: Record<DupHit['tier'], string> = {
  duplicate: 'Already in your playlist',
  'likely-duplicate': 'Probably already in your playlist',
  'other-version': 'Another version is in your playlist',
};

/** Shown above the match on the review card for a song you (probably) already have. */
function HaveBanner({ hit, addAnyway }: { hit: DupHit; addAnyway: boolean }) {
  const name = `${hit.row.title}${hit.row.artist ? ` — ${hit.row.artist}` : ''}`;
  const where = hit.source === 'added' ? `added by the app: ${name}` : `#${hit.row.position}: ${name}`;
  const exact = hit.sameTrack && hit.source === 'added';
  return (
    <div className={`have-banner have-${hit.tier}`} role="status">
      <strong>{hit.source === 'added' && hit.tier !== 'other-version' ? 'Already added by the app' : HAVE_HEADLINE[hit.tier]}</strong>
      <span className="muted"> · matches {where}{exact ? '' : ` (${Math.round(hit.score * 100)}%)`}</span>
      <div className="small">
        {addAnyway
          ? 'You chose to add it anyway: it will be exported.'
          : exact
            ? 'Keeping it holds it back from the export.'
            : <>Keeping it holds it back from the export. Press <kbd>A</kbd> to keep it and add it anyway.</>}
      </div>
    </div>
  );
}

function MatchView({ item, match, chosen, status, error, audioRef, inPlaylist }: {
  item: ReviewItem; match?: MatchResult; chosen?: Candidate; status?: string; error?: string; audioRef: React.RefObject<HTMLAudioElement>; inPlaylist?: DupHit;
}) {
  if (!match || status === 'matching' || status === 'queued') {
    return <div className="match pending">{status === 'matching' ? 'Searching Apple Music…' : 'Queued for matching…'}<audio ref={audioRef} /></div>;
  }
  if (status === 'error') return <div className="match none"><span className="bad">Search failed: {error}</span><audio ref={audioRef} /></div>;
  if (!chosen) return <div className="match none">No match in this store. Search or paste an Apple Music link below.<audio ref={audioRef} /></div>;
  const t = chosen.track;
  const conf = match.userPicked ? 'high' : confidenceOf(match.score);
  return (
    <div className={`match${inPlaylist ? ` have-frame have-${inPlaylist.tier}` : ''}`}>
      {t.artworkUrl100
        ? <img src={t.artworkUrl100.replace('100x100bb', '200x200bb')} alt="" width={88} height={88} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <div className="art" />}
      <div className="match-body">
        <div>
          <strong>{t.trackName}</strong>
          <span className={`badge conf-${conf}`}>{match.userPicked ? 'your pick' : CONF_LABEL[conf]}</span>
          {match.method === 'animethemes-link' && <span className="badge" title="Linked on AnimeThemes; no search needed">linked</span>}
          <Flags c={chosen} theme={item.theme} />
          <InPlaylistBadge hit={inPlaylist} />
        </div>
        <div>{t.artistName}</div>
        <div className="muted">{t.collectionName} · {mmss(t.trackTimeMillis)}</div>
        <div className="row">
          <audio ref={audioRef} controls preload="none" />
          <a href={songUrl(t.trackId, t.country)} target="_blank" rel="noopener noreferrer">Open in Apple Music ↗</a>
        </div>
      </div>
    </div>
  );
}

/** Covers, karaoke and instrumentals are rarely what you want: tucked away by default. */
const NOISE: Flag[] = ['cover', 'karaoke', 'instrumental'];
/** Below this score a result is collapsed behind "show more". */
const LOW_SCORE = 0.2;

/** ▶/■ for a preview, through the shared sampler (one plays at a time). */
function SampleButton({ url, label }: { url: string | null; label: string }) {
  const playing = usePlayingSample();
  if (!url) return <span className="muted small">no preview</span>;
  const on = playing === url;
  return (
    <button className={`secondary sample ${on ? 'on' : ''}`} onClick={() => toggleSample(url)} aria-pressed={on} aria-label={`${on ? 'Stop' : 'Play'} preview of ${label}`} title={on ? 'Stop preview' : 'Play preview'}>
      {on ? '■' : '▶'}
    </button>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <span className="score" title={`Match score ${pct}%`} aria-label={`Match score ${pct}%`}>
      <span className="score-bar"><span style={{ width: `${pct}%` }} className={pct >= 80 ? 'hi' : pct >= 55 ? 'mid' : 'lo'} /></span>
      <span className="score-num">{pct}%</span>
    </span>
  );
}

/**
 * Candidates / search results in a height-capped, scrollable list. Strong
 * results show first; low scores and covers/karaoke/instrumentals collapse
 * behind "show N more" so the list stays scannable.
 */
function CandidateList({ candidates, onUse }: { candidates: Candidate[]; onUse: (t: ItunesTrack) => void }) {
  const [showAll, setShowAll] = useState(false);
  const isNoise = (c: Candidate) => c.score < LOW_SCORE || c.flags.some((f) => NOISE.includes(f));
  const main = candidates.filter((c) => !isNoise(c));
  const rest = candidates.filter(isNoise);
  const shown = showAll || !main.length ? candidates : main;
  return (
    <div className="cands-wrap">
      {!main.length && rest.length > 0 && <p className="muted small cands-note">No strong matches: showing low-scoring, cover and karaoke results too.</p>}
      <table className="cands">
        <tbody>
          {shown.map((c) => (
            <tr key={c.track.trackId} className={isNoise(c) ? 'noise' : ''}>
              <td className="nowrap"><ScoreBar score={c.score} /></td>
              <td>
                <strong>{c.track.trackName}</strong><br />
                <span className="muted">{c.track.artistName} · {c.track.collectionName} · {mmss(c.track.trackTimeMillis)}</span>{' '}
                {c.flags.map((f) => <span key={f} className={`badge ${NOISE.includes(f) ? 'bad' : 'warn'}`}>{FLAG_LABEL[f]}</span>)}
              </td>
              <td className="nowrap"><SampleButton url={c.track.previewUrl} label={c.track.trackName} /></td>
              <td><button className="secondary" onClick={() => onUse(c.track)}>Use</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {main.length > 0 && rest.length > 0 && (
        <button className="link small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide' : 'Show'} {rest.length} low-scoring, cover or karaoke result{rest.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function ManualSearch({ item, country, prefs, inputRef, onUse }: {
  item: ReviewItem; country: string; prefs: MatchPrefs; inputRef: React.RefObject<HTMLInputElement>; onUse: (t: ItunesTrack) => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    const term = q.trim();
    if (!term) return;
    setBusy(true); setErr(null);
    try {
      const ref = parseAppleMusicUrl(term);
      let tracks: ItunesTrack[];
      if (ref) {
        tracks = await lookup([ref.id], country);
        if (ref.kind === 'song') {
          const t = tracks.find((x) => x.trackId === ref.id);
          if (!t) throw new Error(`That song isn't available in the "${country}" store.`);
          onUse(t); setQ(''); setResults(null); inputRef.current?.blur(); return;
        }
      } else {
        tracks = await searchSongs(term, country, 25);
      }
      setResults(rankTracks(item.ctx, tracks, prefs).map((s) => ({ track: s.track, score: s.score, flags: s.flags, titleSim: s.titleSim, artistSim: s.artistSim })));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="manual">
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }} placeholder="Search Apple Music, or paste a music.apple.com link" />
        <button className="secondary" disabled={busy}>{busy ? '…' : 'Search'} <kbd>/</kbd></button>
      </form>
      {err && <p className="bad">{err}</p>}
      {results && (results.length ? <CandidateList candidates={results} onUse={(t) => { onUse(t); setResults(null); setQ(''); inputRef.current?.blur(); }} /> : <p className="muted">No results.</p>)}
    </div>
  );
}

/** Queue marker: what will happen to the song. */
function marker(d: Decision | undefined, have: DupHit | undefined): { glyph: string; title: string; cls: string } {
  if (!d) return { glyph: '', title: 'Not decided yet', cls: '' };
  if (d.decision === 'skip') return { glyph: '✕', title: 'Skipped', cls: 'muted' };
  if (d.decision === 'later') return { glyph: '…', title: 'Later', cls: 'muted' };
  if (!have) return { glyph: '✓', title: 'Kept: will be exported', cls: 'ok' };
  if (d.addAnyway) return { glyph: '✓+', title: 'Kept, add anyway: will be exported even though you seem to have it', cls: 'have-text' };
  return { glyph: '⊘', title: "Kept, held back: it's already in your playlist", cls: 'have-text' };
}

function Queue({ items, entries, order, currentKey, onPick, matches, decisions, inPlaylist, view, onView, stale, onRefresh }: {
  items: ReviewItem[]; entries: QueueEntry[]; order: string[]; currentKey: string | null; onPick: (key: string) => void;
  matches: Map<string, MatchResult>; decisions: Map<string, Decision>; inPlaylist: Map<string, DupHit>;
  view: ViewOptions; onView: (v: ViewOptions) => void; stale: boolean; onRefresh: () => void;
}) {
  const byKey = useMemo(() => new Map(items.map((it) => [it.key, it])), [items]);
  const entryByKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const n = useMemo(() => filterCounts(entries), [entries]);
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  // Keep the current song visible in the list as you move through it.
  useEffect(() => { if (currentKey) rows.current.get(currentKey)?.scrollIntoView({ block: 'nearest' }); }, [currentKey]);
  const progress = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const e of entries) { const p = m.get(e.anime) ?? { done: 0, total: 0 }; p.total++; if (e.decision !== 'undecided') p.done++; m.set(e.anime, p); }
    return m;
  }, [entries]);
  const STATUS_TEXT: Record<MatchState, string> = { confident: 'confident', 'your-pick': 'your pick', check: 'check me', unlikely: 'unlikely', 'no-match': 'no match', pending: '' };
  const STATUS_CLASS: Record<MatchState, string> = { confident: 'conf-high', 'your-pick': 'conf-high', check: 'conf-check', unlikely: 'conf-low', 'no-match': 'conf-none', pending: '' };

  return (
    <section className="card queue-card">
      <div className="row queue-tools">
        <label>Sort
          <select value={view.sort} onChange={(e) => onView({ ...view, sort: e.target.value as QueueSort, desc: e.target.value === 'status' })}>
            {(Object.keys(SORT_LABEL) as QueueSort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
        </label>
        <button className="secondary small-btn" onClick={() => onView({ ...view, desc: !view.desc })} title="Reverse the order">
          {view.sort === 'status' ? (view.desc ? 'Confident first' : 'No match first') : view.desc ? 'Z→A ↑' : 'A→Z ↓'}
        </button>
        <label><input type="checkbox" checked={view.groupByAnime} onChange={(e) => onView({ ...view, groupByAnime: e.target.checked })} /> Group by anime</label>
        {stale && <button className="pill" onClick={onRefresh} title="Statuses changed since this order was set; the list stays put until you refresh">Order out of date · refresh</button>}
      </div>
      <div className="chips" role="radiogroup" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} role="radio" aria-checked={view.filter === f.id} className={`chip ${view.filter === f.id ? 'on' : ''} ${f.id === 'have' ? 'chip-have' : ''}`}
            onClick={() => onView({ ...view, filter: f.id })} disabled={!n[f.id] && view.filter !== f.id && f.id !== 'all'}>
            {f.label} <span className="chip-n">{n[f.id]}</span>
          </button>
        ))}
      </div>
      <p className="muted small legend">
        <span className="ok">✓</span> exported · <span className="have-text">⊘</span> held back · <span className="have-text">✓+</span> add anyway · … later · ✕ skipped
      </p>
      <div className="queue-scroll">
        <table className="queue">
          <tbody>
            {order.map((key, i) => {
              const it = byKey.get(key);
              const e = entryByKey.get(key);
              if (!it || !e) return null;
              const hit = inPlaylist.get(key);
              const mk = marker(decisions.get(key), hit);
              const m = matches.get(key);
              const header = view.groupByAnime && entryByKey.get(order[i - 1] ?? '')?.anime !== e.anime;
              const p = progress.get(e.anime);
              return [
                header ? (
                  <tr key={`h:${e.anime}`} className="group-head"><td colSpan={4}>{e.anime} <span className="muted">· {p?.done}/{p?.total} decided</span></td></tr>
                ) : null,
                <tr key={key} ref={(el) => { if (el) rows.current.set(key, el); else rows.current.delete(key); }}
                  className={`${key === currentKey ? 'current' : ''} ${hit ? 'have-row' : ''}`} onClick={() => onPick(key)} aria-current={key === currentKey ? 'true' : undefined}>
                  <td className={`nowrap marker ${mk.cls}`} title={mk.title}>{mk.glyph}</td>
                  <td className="nowrap muted">{it.theme.slug}</td>
                  <td>{it.theme.songTitle}{!view.groupByAnime && <span className="muted"> · {e.anime}</span>}<InPlaylistBadge hit={hit} /></td>
                  <td className="nowrap">
                    {e.match === 'pending'
                      ? <span className="muted small">matching…</span>
                      : <span className={`badge ${STATUS_CLASS[e.match]}`} title={m?.method === 'animethemes-link' ? 'Linked on AnimeThemes' : undefined}>{STATUS_TEXT[e.match]}</span>}
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
        {!order.length && <p className="muted">Nothing matches this filter.</p>}
      </div>
    </section>
  );
}

type ExportFormat = 'shortcut' | 'text' | 'json';
const EXPORT_KEY = 'anisong-curator.exportFormat';
const EXPORT_FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'shortcut', label: 'Shortcut', hint: 'Title | Artist | link, one per line: Anisong Add Kept adds the links' },
  { value: 'text', label: 'Text + links', hint: 'Readable: song, artist, show, then the link' },
  { value: 'json', label: 'JSON', hint: '{country, ids}: for the spike Anisong Add Tracks shortcut' },
];

/** A snapshot older than this gets a gentle "sync first" prompt. */
const STALE_MS = 7 * 24 * 3600 * 1000;

function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function KeptSummary({ items, matches, decisions, country, playlistName, playlist, snapshot, onSnapshot, added, storeNames, onRecord, onUndo, onAddAnyway }: {
  items: ReviewItem[]; matches: Map<string, MatchResult>; decisions: Map<string, Decision>; onAddAnyway: (keys: string[], value: boolean) => Promise<void>;
  country: string; playlistName: string; playlist: DupIndex | null; snapshot: PlaylistSnapshot | null; onSnapshot: (s: PlaylistSnapshot) => void;
  added: AddedRecord[]; storeNames: Map<number, StoreName>; onRecord: (items: ExportItem[]) => Promise<string>; onUndo: (batchId: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  // "Add anyway" lives on the decision, so the review card and this list agree and it survives reloads.
  const overrides = useMemo(() => new Set([...decisions.values()].filter((d) => d.decision === 'keep' && d.addAnyway).map((d) => d.key)), [decisions]);
  const [lastBatch, setLastBatch] = useState<{ id: string; n: number } | null>(null);
  const [format, setFormatState] = useState<ExportFormat>(() => {
    try { const v = localStorage.getItem(EXPORT_KEY); return EXPORT_FORMATS.some((f) => f.value === v) ? (v as ExportFormat) : 'shortcut'; } catch { return 'shortcut'; }
  });
  const setFormat = (f: ExportFormat) => { setFormatState(f); try { localStorage.setItem(EXPORT_KEY, f); } catch { /* private mode */ } };

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
  // Always offer Sync playlist, even before anything is kept: the review's
  // "already in your playlist" flags need a synced copy to compare against.
  if (!exportItems.length && !lastBatch) {
    return (
      <section className="card">
        <h2>Kept</h2>
        <PlaylistSync snapshot={snapshot} playlistName={playlistName} onSnapshot={onSnapshot} />
        <p className="muted">Nothing kept yet. Sync your playlist first, so songs you already have are flagged while you review.</p>
      </section>
    );
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
  const toggle = (key: string) => onAddAnyway([key], !overrides.has(key));
  const markAdded = async () => {
    if (!plan.add.length) return;
    if (!confirm(`Record ${plan.add.length} song(s) as added to "${playlistName}"? They'll be held back from future exports.`)) return;
    const n = plan.add.length;
    const id = await onRecord(plan.add);
    // Recorded songs are now in the add log; clear their override so they can't re-export.
    await onAddAnyway(plan.add.map((i) => i.key), false);
    setLastBatch({ id, n });
  };

  return (
    <section className="card">
      <h2>Kept · {plan.add.length} to add{plan.held.length > 0 && <span className="muted"> · {plan.held.length} held back</span>}</h2>
      <PlaylistSync snapshot={snapshot} playlistName={playlistName} onSnapshot={onSnapshot} />
      <p className="muted">
        In playlist order (oldest show first). Copy, run <strong>Anisong Add Kept</strong> to add them to{' '}
        <strong>{playlistName}</strong> (or a new staging playlist), then press <strong>I added these</strong> so they're never exported again.
      </p>
      <div className="row">
        <div className="segmented" role="radiogroup" aria-label="Export format">
          {EXPORT_FORMATS.map((f) => (
            <button key={f.value} role="radio" aria-checked={format === f.value} className={format === f.value ? 'on' : ''} onClick={() => setFormat(f.value)} title={f.hint}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={copy} disabled={!plan.add.length}>{copied ? 'Copied ✓' : 'Copy'}</button>
        {canShare && <button className="secondary" onClick={share} disabled={!plan.add.length} title="Share sheet: pick Anisong Add Kept directly">Share…</button>}
        <span className="spacer" />
        <button className="secondary" onClick={markAdded} disabled={!plan.add.length} title="Record these as added so they're held back from future exports">I added these ({plan.add.length})</button>
      </div>
      {lastBatch && (
        <p className="ok small">
          Recorded {lastBatch.n} song(s) as added.{' '}
          <button className="link" onClick={async () => { await onUndo(lastBatch.id); setLastBatch(null); }}>Undo</button>
        </p>
      )}
      {plan.add.length > 0 && <textarea className="export" readOnly value={output} rows={Math.min(8, Math.max(2, plan.add.length))} onFocus={(e) => e.currentTarget.select()} aria-label="Export" />}
      <ol className="kept">
        {plan.add.map((i) => (
          <li key={i.key}>
            <a href={i.url} target="_blank" rel="noopener noreferrer">{i.title}</a>
            <span className="muted"> — {i.artist} · {i.label}</span>
            {overrides.has(i.key) && <button className="link small" onClick={() => toggle(i.key)}>hold back again</button>}
          </li>
        ))}
      </ol>
      {plan.held.length > 0 && (
        <details className="held" open={plan.held.length <= 5}>
          <summary>Held back ({plan.held.length}): likely duplicates aren't exported</summary>
          <ul>
            {plan.held.map((h) => (
              <li key={h.item.key} data-reason={h.reason} data-tier={h.hit?.tier}>
                <span className={`badge have ${h.reason === 'likely-in-playlist' ? 'have-likely-duplicate' : h.reason === 'other-version' ? 'have-other-version' : h.reason === 'repeat-in-batch' ? '' : 'have-duplicate'}`}>{REASON_LABEL[h.reason]}</span>{' '}
                <strong>{h.item.title}</strong> <span className="muted">— {h.item.artist} · {h.item.label} · matches {h.detail}</span>
                {h.overridable && <label className="small"> <input type="checkbox" checked={overrides.has(h.item.key)} onChange={() => toggle(h.item.key)} /> add anyway</label>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Songs marked Later, with the same "already have" indicator; click to go back to one. */
function LaterList({ items, decisions, inPlaylist, onPick }: {
  items: ReviewItem[]; decisions: Map<string, Decision>; inPlaylist: Map<string, DupHit>; onPick: (i: number) => void;
}) {
  const later = items.flatMap((it, i) => (decisions.get(it.key)?.decision === 'later' ? [{ it, i }] : []));
  if (!later.length) return null;
  return (
    <section className="card">
      <h2>Later ({later.length})</h2>
      <p className="muted small">Not exported until you decide. Click one to review it again.</p>
      <ul className="later">
        {later.map(({ it, i }) => (
          <li key={it.key} className={inPlaylist.has(it.key) ? 'have-row' : ''}>
            <button className="link" onClick={() => { onPick(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{it.theme.songTitle ?? 'Unknown title'}</button>
            <span className="muted"> · {displayTitle(it.show)} {it.theme.slug}</span>
            <InPlaylistBadge hit={inPlaylist.get(it.key)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Playlist status plus a paste box, so the snapshot can be refreshed right
 * before exporting: paste what Anisong Export Playlist copied (or a Mac
 * export / ⌘C rows). Saving replaces the snapshot with the same name.
 */
function PlaylistSync({ snapshot, playlistName, onSnapshot }: { snapshot: PlaylistSnapshot | null; playlistName: string; onSnapshot: (s: PlaylistSnapshot) => void }) {
  const stale = !snapshot || Date.now() - snapshot.importedAt > STALE_MS;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const onText = (v: string) => { setText(v); setParsed(v.trim() ? parsePlaylist(v) : null); setSaved(null); };
  const save = async () => {
    if (!parsed?.rows.length) return;
    const s = snapshotFromParse(parsed, playlistName);
    await saveSnapshot(s);
    onSnapshot(s);
    setSaved(s.rows.length); setText(''); setParsed(null); setOpen(false);
  };
  const otherName = parsed?.playlistName && parsed.playlistName.trim() !== playlistName.trim() ? parsed.playlistName : null;

  return (
    <div className="sync">
      <div className="row small">
        {snapshot ? (
          <span>
            Playlist: <strong>{snapshot.name}</strong> · {snapshot.rows.length} songs · synced {ago(snapshot.importedAt)}
            {' '}<span className="badge" title={snapshot.warnings.join('\n') || undefined}>{SNAPSHOT_SOURCE[snapshot.format]}</span>
          </span>
        ) : <span className="muted">No playlist synced: only songs added through the app (its add log) are checked.</span>}
        <button className="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Close' : 'Sync playlist'}</button>
        {saved !== null && <span className="ok-text">Synced {saved} songs ✓</span>}
      </div>
      {stale && !open && (
        <p className="warn-text small">
          {snapshot ? `Your playlist snapshot is ${ago(snapshot.importedAt)} old.` : 'Sync your playlist to catch songs added outside the app.'}{' '}
          Run <strong>Anisong Export Playlist</strong> on your iPhone, then <button className="link" onClick={() => setOpen(true)}>paste it here</button>.
          {' '}The add log still covers songs added through the app.
        </p>
      )}
      {open && (
        <div className="import">
          <p className="muted small">
            Paste what <strong>Anisong Export Playlist</strong> copied. A Music.app export or rows copied with <kbd>⌘C</kbd> work too.
          </p>
          <textarea className="paste" value={text} onChange={(e) => onText(e.target.value)} rows={4} spellCheck={false} placeholder="anisong-playlist v2 …" aria-label="Paste playlist to sync" />
          {parsed && (
            <>
              <p className="small">
                <strong>{parsed.rows.length} songs</strong>{parsed.playlistName && <> from <strong>{parsed.playlistName}</strong></>}
                <span className="muted"> · {parsed.format === 'shortcut' ? 'iPhone shortcut' : parsed.format === 'export' ? 'Mac export' : parsed.format === 'pasted' ? 'pasted rows' : ''}</span>
              </p>
              {otherName && <p className="warn-text small">This is “{otherName}”, not your target playlist “{playlistName}”.</p>}
              {parsed.warnings.length > 0 && <ul className="warnings small">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </>
          )}
          <div className="row">
            <button onClick={save} disabled={!parsed?.rows.length}>Save {parsed?.rows.length ? `${parsed.rows.length} songs` : 'snapshot'}</button>
            <button className="secondary" onClick={() => { setOpen(false); onText(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
