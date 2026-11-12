import { useState } from 'react';
import type { DupHit } from '../../lib/dedupe';
import { songUrl, type ItunesTrack } from '../../lib/itunes';
import type { MatchStatus, ReviewItem } from '../../lib/useMatching';
import type { Reason } from '../../lib/reasons';
import { hitWhere, mmss, ReasonChips } from './common';

interface Props {
  item: ReviewItem;
  track?: ItunesTrack;
  status?: MatchStatus;
  error?: string;
  onRetry: () => void;
  reasons: Reason[];
  /** Already-have pass: the left column is the playlist's copy instead of the theme. */
  have?: DupHit;
  tone: 'ok' | 'warn' | 'bad' | 'wait' | 'have';
}

/** Two columns, From the show (or In your playlist) | Apple Music match, and the reasons below. */
export function Comparison({ item, track, status, error, onRetry, reasons, have, tone }: Props) {
  const t = item.theme;
  return (
    <section className={`compare compare-${tone}`} aria-label={have ? 'Playlist entry and match' : 'Theme and match'}>
      {have ? (
        <div className="compare-col">
          <span className="eyebrow have-text">{have.source === 'added' ? 'Added by the app' : `In your playlist · ${hitWhere(have)}`}</span>
          <span className="compare-title">{have.row.title}</span>
          <span className="compare-artist">{have.row.artist || <span className="muted">Artist unknown</span>}</span>
          <span className="compare-meta">{[have.row.album, mmss(have.row.durationMs)].filter(Boolean).join(' · ')}</span>
        </div>
      ) : (
        <div className="compare-col">
          <span className="eyebrow">From the show</span>
          <span className="compare-title">
            {t.songTitle ?? 'Unknown title'}
            {t.songTitleNative && <span className="compare-native"> {t.songTitleNative}</span>}
          </span>
          <span className="compare-artist">{t.artists.join(', ') || <span className="muted">Artist unknown</span>}</span>
          <span className="compare-meta">{t.source === 'jikan' ? 'MyAnimeList' : 'AnimeThemes'}</span>
        </div>
      )}
      <div className="compare-col compare-match">
        <MatchColumn track={track} status={status} error={error} onRetry={onRetry} />
      </div>
      {reasons.length > 0 && <div className="compare-reasons"><ReasonChips reasons={reasons} /></div>}
    </section>
  );
}

function MatchColumn({ track, status, error, onRetry }: { track?: ItunesTrack; status?: MatchStatus; error?: string; onRetry: () => void }) {
  // Errors first: a failed search stores no match, so checking for a track
  // first would show "Queued" forever.
  if (status === 'error') {
    return (
      <div className="match-empty">
        <span className="eyebrow">Apple Music match</span>
        <span className="compare-title bad">Search failed</span>
        {error && <span className="compare-meta">{error}</span>}
        <div><button className="btn-line" onClick={onRetry}>Try again</button></div>
      </div>
    );
  }
  if (!track) {
    const pending = status === 'matching' || status === 'queued' || status === undefined;
    return (
      <div className="match-empty">
        <span className="eyebrow">Apple Music match</span>
        <span className="compare-title muted">{status === 'matching' ? 'Searching Apple Music…' : pending ? 'Queued for matching…' : 'No match in this store'}</span>
        {!pending && <span className="compare-meta">Search below or paste a music.apple.com link.</span>}
      </div>
    );
  }
  return (
    <>
      <Artwork key={track.trackId} url={track.artworkUrl100} />
      <div className="compare-col-inner">
        <span className="eyebrow">Apple Music match</span>
        <span className="compare-title">{track.trackName}</span>
        <span className="compare-artist">{track.artistName}</span>
        <span className="compare-meta">
          {[track.collectionName, mmss(track.trackTimeMillis)].filter(Boolean).join(' · ')}
          {' · '}<a href={songUrl(track.trackId, track.country)} target="_blank" rel="noopener noreferrer">Open ↗</a>
        </span>
      </div>
    </>
  );
}

/** Album art, or a plain placeholder of the same size when there is none or it fails to load. */
function Artwork({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return url && !failed
    ? <img className="art" src={url.replace('100x100bb', '200x200bb')} alt="" width={96} height={96} onError={() => setFailed(true)} />
    : <span className="art art-ph" aria-hidden="true">♪</span>;
}
