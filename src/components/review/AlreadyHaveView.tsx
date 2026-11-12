import { useEffect, useRef } from 'react';
import { displayTitle } from '../../lib/anilist';
import type { Decision } from '../../lib/db';
import type { DupHit } from '../../lib/dedupe';
import { haveReasons } from '../../lib/reasons';
import type { ReviewItem } from '../../lib/useMatching';
import { Comparison } from './Comparison';
import { decisionMark, HavePill } from './common';
import { NotItPanel } from './NotItPanel';
import { Player } from './Player';
import { SongHead, type CardShared } from './SongCard';

/** The already-have queue: every song with an in-playlist hit, in watch order. */
export function HaveQueue({ items, order, currentKey, onPick, onStep, decisions, hits }: {
  items: Map<string, ReviewItem>; order: string[]; currentKey: string | null; onPick: (key: string) => void; onStep: (dir: 1 | -1) => void;
  decisions: Map<string, Decision>; hits: Map<string, DupHit>;
}) {
  const pos = currentKey ? order.indexOf(currentKey) : -1;
  const rowEls = useRef(new Map<string, HTMLElement>());
  useEffect(() => { if (currentKey) rowEls.current.get(currentKey)?.scrollIntoView({ block: 'nearest' }); }, [currentKey]);
  return (
    <nav className="queue queue-have" aria-label="Already have queue">
      <div className="queue-tools">
        <div className="queue-top">
          <span className="eyebrow">Already in your playlist <span className="queue-pos">· {pos >= 0 ? pos + 1 : '–'} of {order.length}</span></span>
          <div className="queue-arrows">
            <button className="icon-btn" onClick={() => onStep(-1)} disabled={pos <= 0} aria-label="Previous song" title="Previous (K or ←)">←</button>
            <button className="icon-btn" onClick={() => onStep(1)} disabled={pos < 0 || pos >= order.length - 1} aria-label="Next song" title="Next (J or →)">→</button>
          </div>
        </div>
      </div>
      <div className="queue-list">
        {order.map((key) => {
          const it = items.get(key);
          if (!it) return null;
          const hit = hits.get(key);
          const d = decisions.get(key);
          const mk = d?.decision === 'keep' && !d.addAnyway ? { glyph: '✕', title: 'Held back (skipped)', cls: 'muted' } : decisionMark(d, hit);
          return (
            <button key={key} ref={(el) => { if (el) rowEls.current.set(key, el); else rowEls.current.delete(key); }}
              className={`qrow qrow-have ${key === currentKey ? 'current' : ''}`} onClick={() => onPick(key)} aria-current={key === currentKey ? 'true' : undefined}>
              <span className={`qmark ${mk.cls}`} title={mk.title}>{mk.glyph}</span>
              <span className="qtitle qtitle-2">
                <span>{it.theme.songTitle ?? 'Unknown title'}</span>
                <span className="qshow">{displayTitle(it.show)} · {it.theme.slug}</span>
              </span>
              {hit && <span className="qscore" title={hit.source === 'added' ? 'Added by the app' : `Playlist #${hit.row.position}`}>{Math.round(hit.score * 100)}%</span>}
            </button>
          );
        })}
        {!order.length && <p className="muted queue-empty">Nothing here: none of your songs are in the playlist.</p>}
      </div>
      <div className="queue-foot small"><span>Skipped unless you add them. Same keys as review: <b>1</b> add anyway, <b>2</b> skip.</span></div>
    </nav>
  );
}

interface CardProps extends CardShared {
  onAddAnyway: () => void;
  onSkip: () => void;
}

/** A song you already have (phase 2): your playlist's copy next to the match. Skip is the default. */
export function HaveCard(p: CardProps) {
  const { item, chosen, match, hit, decision } = p;
  const added = decision?.decision === 'keep' && !!decision.addAnyway;
  const skipped = decision?.decision === 'skip' || (decision?.decision === 'keep' && !decision.addAnyway);
  const others = match?.candidates.filter((c) => c.track.trackId !== match.chosenId) ?? [];
  const locked = hit?.sameTrack && hit.source === 'added';
  return (
    <>
      <SongHead item={item} pill={hit ? <HavePill hit={hit} /> : null} />
      <Comparison item={item} track={chosen?.track} status={p.status} error={p.error} onRetry={p.onRetry}
        reasons={hit ? haveReasons(hit, chosen?.track) : []} have={hit} tone={hit ? 'have' : 'ok'} />
      <Player audioRef={p.audioRef} url={chosen?.track.previewUrl} autoplay={p.autoplay} onAutoplay={p.onAutoplay} />
      <div className="decide" role="group" aria-label="Decide">
        <button className="btn-big btn-have" aria-pressed={added} onClick={p.onAddAnyway} disabled={!chosen || locked}
          title={locked ? 'The app already added this exact track' : 'Add it to the playlist even though you seem to have it'}>
          Add anyway <kbd>1</kbd>
        </button>
        <button className="btn-big btn-primary" aria-pressed={skipped} onClick={p.onSkip}>Skip <kbd>2</kbd></button>
        <span className="muted decide-note">
          {added ? <>Will be added. <button className="link" onClick={p.onUndo}>Undo</button></>
            : decision ? <>Skipped. <button className="link" onClick={p.onUndo}>Undo</button></>
            : 'Skip is the default: this one stays out of the export.'}
        </span>
      </div>
      <NotItPanel item={item} candidates={others} hit={hit} hasTrack={!!chosen} canCheck={p.canCheck} open={p.notItOpen} onToggle={p.onNotIt}
        country={p.country} prefs={p.prefs} inputRef={p.searchRef} onUse={p.onChoose} />
    </>
  );
}
