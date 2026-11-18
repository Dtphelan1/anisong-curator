import { displayTitle } from '../../lib/anilist';
import type { Decision, DecisionValue } from '../../lib/db';
import type { DupHit } from '../../lib/dedupe';
import type { ItunesTrack } from '../../lib/itunes';
import type { MatchPrefs } from '../../lib/matcher';
import type { Candidate, MatchResult } from '../../lib/matching';
import type { MatchState } from '../../lib/queueView';
import { matchReasons } from '../../lib/reasons';
import { themeLabel } from '../../lib/themeLabel';
import type { MatchStatus, ReviewItem } from '../../lib/useMatching';
import { Comparison } from './Comparison';
import { ConfidencePill, ShowCover, STATE_TONE } from './common';
import { NotItPanel } from './NotItPanel';
import { Player } from './Player';

/** Cover, show, "Opening 3", and a pill on the right. */
export function SongHead({ item, pill }: { item: ReviewItem; pill: React.ReactNode }) {
  return (
    <div className="song-head">
      <ShowCover show={item.show} size="lg" />
      <div className="song-head-text">
        <span className="song-show">{displayTitle(item.show)}</span>
        <h2 className="song-label">{themeLabel(item.theme)}</h2>
      </div>
      {pill}
    </div>
  );
}

const DECISION_TEXT: Record<DecisionValue, string> = { keep: 'Kept', skip: 'Skipped', later: 'Later' };

export interface CardShared {
  item: ReviewItem;
  match?: MatchResult;
  chosen?: Candidate;
  status?: MatchStatus;
  error?: string;
  decision?: Decision;
  /** In-playlist hit for the chosen track. */
  hit?: DupHit;
  canCheck: boolean;
  prefs: MatchPrefs;
  country: string;
  autoplay: boolean;
  onAutoplay: (on: boolean) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
  searchRef: React.RefObject<HTMLInputElement>;
  notItOpen: boolean;
  onNotIt: () => void;
  onChoose: (t: ItunesTrack) => void;
  onRetry: () => void;
  onUndo: () => void;
}

interface Props extends CardShared {
  state: MatchState;
  onDecide: (d: DecisionValue) => void;
  onAddAnyway: () => void;
  onLaterShow: () => void;
  /** Undecided songs of this show in the review, the current one included. */
  showUndecided: number;
}

/** The song under review (phase 1): comparison, player, decisions, and "Not it?". */
export function SongCard(p: Props) {
  const { item, match, chosen, status, error, decision, hit, state } = p;
  const reasons = chosen ? matchReasons(item.theme, chosen, { userPicked: match?.userPicked, linked: match?.method === 'animethemes-link', preferTvSize: p.prefs.preferTvSize }) : [];
  const others = match?.candidates.filter((c) => c.track.trackId !== match.chosenId) ?? [];
  const keptPlain = decision?.decision === 'keep' && !decision.addAnyway;
  const canOverride = hit && !(hit.sameTrack && hit.source === 'added');

  return (
    <>
      <SongHead item={item} pill={<ConfidencePill state={state} score={match?.score} />} />
      <Comparison item={item} track={chosen?.track} status={status} error={error} onRetry={p.onRetry} reasons={reasons} tone={STATE_TONE[state]} />
      <Player audioRef={p.audioRef} url={chosen?.track.previewUrl} autoplay={p.autoplay} onAutoplay={p.onAutoplay} />

      <div className="decide" role="group" aria-label="Decide">
        <button className={`btn-big btn-primary ${hit ? 'btn-have-primary' : ''}`} aria-pressed={keptPlain} disabled={!chosen} onClick={() => p.onDecide('keep')}
          title={hit ? "You already have it: hold it back from the export" : 'Keep it: it goes to the playlist'}>
          {hit ? 'Hold back' : 'Keep'} <kbd>1</kbd>
        </button>
        <button className="btn-big btn-line" aria-pressed={decision?.decision === 'skip'} onClick={() => p.onDecide('skip')}>Skip <kbd>2</kbd></button>
        {canOverride && (
          <button className="btn-big btn-have" aria-pressed={decision?.decision === 'keep' && !!decision.addAnyway} disabled={!chosen} onClick={p.onAddAnyway}
            title="Add it even though it looks like it's already in your playlist">
            Add anyway <kbd>⇧1</kbd>
          </button>
        )}
        <span className="decide-sep" aria-hidden="true" />
        <button className="btn-quiet" aria-pressed={decision?.decision === 'later'} onClick={() => p.onDecide('later')}>Later <kbd>3</kbd></button>
        <button className="btn-quiet" onClick={p.onLaterShow} title={`Mark the ${p.showUndecided} undecided song${p.showUndecided === 1 ? '' : 's'} of ${displayTitle(item.show)} as later`}>
          Later: whole show <kbd>⇧3</kbd>
        </button>
        {decision && (
          <span className="decided muted">
            {DECISION_TEXT[decision.decision]}{decision.addAnyway ? ' · add anyway' : keptPlain && hit ? ' · held back' : ''} · <button className="link" onClick={p.onUndo}>Undo</button>
          </span>
        )}
      </div>

      <NotItPanel item={item} candidates={others} hit={hit} hasTrack={!!chosen} canCheck={p.canCheck} open={p.notItOpen} onToggle={p.onNotIt}
        country={p.country} prefs={p.prefs} inputRef={p.searchRef} onUse={p.onChoose} />
    </>
  );
}
