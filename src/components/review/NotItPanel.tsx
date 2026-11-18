import { useState } from 'react';
import { displayTitle } from '../../lib/anilist';
import type { DupHit } from '../../lib/dedupe';
import { lookup, parseAppleMusicUrl, searchSongs, type ItunesTrack } from '../../lib/itunes';
import { rankTracks, type Flag, type MatchPrefs } from '../../lib/matcher';
import type { Candidate } from '../../lib/matching';
import { toggleSample, usePlayingSample } from '../../lib/sampler';
import type { ReviewItem } from '../../lib/useMatching';
import { hitWhere, mmss } from './common';

const FLAG_LABEL: Record<Flag, string> = {
  tv: 'TV size', instrumental: 'instrumental', karaoke: 'karaoke', live: 'live', firstTake: 'THE FIRST TAKE',
  remix: 'remix', acoustic: 'acoustic', cover: 'cover', altVersion: 'alt version', soundtrack: 'soundtrack album',
};
/** Covers, karaoke and instrumentals are rarely what you want: tucked away by default. */
const NOISE: Flag[] = ['cover', 'karaoke', 'instrumental'];
/** Below this score a result is collapsed behind "show more". */
const LOW_SCORE = 0.2;

interface Props {
  item: ReviewItem;
  candidates: Candidate[];
  /** In-playlist check for the chosen track; undefined = not found. */
  hit?: DupHit;
  /** A track is chosen, so there is something to check. */
  hasTrack: boolean;
  /** A playlist snapshot or add log exists to check against. */
  canCheck: boolean;
  open: boolean;
  onToggle: () => void;
  country: string;
  prefs: MatchPrefs;
  inputRef: React.RefObject<HTMLInputElement>;
  onUse: (t: ItunesTrack) => void;
}

/**
 * "Not it?": the tools for checking and fixing a match. The first line
 * (YouTube, the in-playlist check, search or paste a link) is always there;
 * the other candidates and search results open below it (`C`).
 */
export function NotItPanel({ item, candidates, hit, hasTrack, canCheck, open, onToggle, country, prefs, inputRef, onUse }: Props) {
  return (
    <section className="notit" aria-label="Fix the match">
      <div className="notit-line">
        <button className="notit-toggle" onClick={onToggle} aria-expanded={open} title="Other candidates (C)">
          <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span> Not it? <kbd>C</kbd>
        </button>
        <YouTubeSearch item={item} />
        {hasTrack && <PlaylistCheckChip hit={hit} canCheck={canCheck} />}
        <ManualSearch key={item.key} item={item} country={country} prefs={prefs} inputRef={inputRef} onUse={onUse} />
      </div>
      {open && (candidates.length
        ? <CandidateList candidates={candidates} onUse={onUse} />
        : <p className="muted small notit-empty">No other candidates. Search above, or paste a music.apple.com link.</p>)}
    </section>
  );
}

function PlaylistCheckChip({ hit, canCheck }: { hit?: DupHit; canCheck: boolean }) {
  if (hit) {
    const name = `${hit.row.title}${hit.row.artist ? ` — ${hit.row.artist}` : ''}`;
    const text = hit.source === 'added' ? 'Added by the app' : `${hit.tier === 'duplicate' ? 'In your playlist' : hit.tier === 'likely-duplicate' ? 'Likely in your playlist' : 'Other version in your playlist'}: ${hitWhere(hit)}`;
    return <span className="check-chip tone-have" title={`${name} (match ${Math.round(hit.score * 100)}%)`}>{text}</span>;
  }
  if (!canCheck) return <span className="check-chip tone-neutral" title="Sync your playlist in Add to playlist to check">Playlist not synced</span>;
  return <span className="check-chip tone-ok">Not in your playlist</span>;
}

/** YouTube search for the song: title, artists, anime and OP/ED slug. Opens a separate, reused window. */
export function YouTubeSearch({ item }: { item: ReviewItem }) {
  const q = [item.theme.songTitle, item.theme.artists.join(' '), displayTitle(item.show), item.theme.slug].filter(Boolean).join(' ');
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  return (
    <a className="btn-chip" href={url} target="_blank" rel="noopener noreferrer"
      onClick={(e) => {
        // A separate, reused window; if the popup is blocked, the link opens a normal tab instead.
        const w = window.open(url, 'anisong-youtube', 'popup,width=1100,height=800');
        if (w) { w.opener = null; e.preventDefault(); }
      }}
      title={`Search YouTube for: ${q}`}>
      YouTube ↗
    </a>
  );
}

/** ▶/■ for a preview, through the shared sampler (one plays at a time, the card's player included). */
function SampleButton({ url, label }: { url: string | null; label: string }) {
  const playing = usePlayingSample();
  if (!url) return <span className="sample sample-none" title="No preview">–</span>;
  const on = playing === url;
  return (
    <button className={`sample ${on ? 'on' : ''}`} onClick={() => toggleSample(url)} aria-pressed={on} aria-label={`${on ? 'Stop' : 'Play'} preview of ${label}`}>
      {on ? '■' : '▶'}
    </button>
  );
}

/**
 * Candidates or search results: strong ones first; low scores and
 * covers/karaoke/instrumentals collapse behind "show N more".
 */
export function CandidateList({ candidates, onUse }: { candidates: Candidate[]; onUse: (t: ItunesTrack) => void }) {
  const [showAll, setShowAll] = useState(false);
  const isNoise = (c: Candidate) => c.score < LOW_SCORE || c.flags.some((f) => NOISE.includes(f));
  const main = candidates.filter((c) => !isNoise(c));
  const rest = candidates.filter(isNoise);
  const shown = showAll || !main.length ? candidates : main;
  return (
    <div className="cands">
      {!main.length && rest.length > 0 && <p className="muted small">No strong matches: showing low-scoring, cover and karaoke results too.</p>}
      <ul>
        {shown.map((c) => {
          const noise = c.flags.find((f) => NOISE.includes(f));
          const [flagText, flagTone] = noise ? [FLAG_LABEL[noise], 'bad']
            : c.artistSim < 0.6 ? ['different artist', 'warn']
            : c.flags[0] ? [FLAG_LABEL[c.flags[0]], 'neutral'] : ['', 'neutral'];
          return (
            <li key={c.track.trackId} className={`cand ${isNoise(c) ? 'noise' : ''}`}>
              <SampleButton url={c.track.previewUrl} label={c.track.trackName} />
              <div className="cand-body">
                <span className="cand-title">{c.track.trackName}</span>
                <span className="cand-detail">{[c.track.artistName, c.track.collectionName, mmss(c.track.trackTimeMillis)].filter(Boolean).join(' · ')}</span>
              </div>
              {flagText && <span className={`cand-flag tone-${flagTone}`}>{flagText}</span>}
              <span className="cand-score" title={`Match score ${Math.round(c.score * 100)}%`}>{Math.round(c.score * 100)}%</span>
              <button className="btn-quiet-line" onClick={() => onUse(c.track)}>Use</button>
            </li>
          );
        })}
      </ul>
      {main.length > 0 && rest.length > 0 && (
        <button className="link small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide' : 'Show'} {rest.length} low-scoring, cover or karaoke result{rest.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

/** Search Apple Music, or paste a music.apple.com song link (resolved exactly with Lookup). */
function ManualSearch({ item, country, prefs, inputRef, onUse }: {
  item: ReviewItem; country: string; prefs: MatchPrefs; inputRef: React.RefObject<HTMLInputElement>; onUse: (t: ItunesTrack) => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const done = (t: ItunesTrack) => { onUse(t); setQ(''); setResults(null); inputRef.current?.blur(); };

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
          done(t); return;
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
      <form onSubmit={(e) => { e.preventDefault(); run(); }} role="search">
        <label className="sr-only" htmlFor="manual-search">Search Apple Music or paste a link</label>
        <input id="manual-search" ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Escape') { setResults(null); e.currentTarget.blur(); } }}
          placeholder={busy ? 'Searching…' : 'Search Apple Music or paste a link  /'} />
      </form>
      {err && <p className="bad small">{err}</p>}
      {results && (
        <div className="manual-results">
          <div className="manual-head"><span className="muted small">{results.length} result{results.length === 1 ? '' : 's'}</span><button className="link small" onClick={() => setResults(null)}>Close</button></div>
          {results.length ? <CandidateList candidates={results} onUse={done} /> : <p className="muted small">No results.</p>}
        </div>
      )}
    </div>
  );
}
