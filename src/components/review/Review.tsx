import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { displayTitle } from '../../lib/anilist';
import type { DecisionValue, PlaylistSnapshot } from '../../lib/db';
import { addedAsRows, checkSources, indexRows, themeNames, withStoreName, type DupHit } from '../../lib/dedupe';
import type { ItunesTrack } from '../../lib/itunes';
import type { MatchPrefs } from '../../lib/matcher';
import {
  computeOrder, isStale, liveOrder, nextUndecidedKey, sanitizeView, stepKey, withCurrent,
  type MatchState, type QueueEntry, type ViewOptions,
} from '../../lib/queueView';
import { stopSample } from '../../lib/sampler';
import {
  EMPTY_SESSION, nextPhase, parseSession, partition, sessionScope, wholeShowLaterKeys,
  type Phase, type RecordedBatch, type SessionState,
} from '../../lib/session';
import { chosenTrack } from '../../lib/tailInference';
import { useAdded } from '../../lib/useAdded';
import { useDecisions, useMatching, type ReviewItem } from '../../lib/useMatching';
import { useStoreNames } from '../../lib/useStoreNames';
import { AddToPlaylistView } from './AddToPlaylistView';
import { HaveCard, HaveQueue } from './AlreadyHaveView';
import { isTyping, matchState } from './common';
import { QueuePanel } from './QueuePanel';
import { PhaseBar, ReviewHeader } from './ReviewHeader';
import { SongCard, type CardShared } from './SongCard';

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
  onNewSession: () => void;
  onAdded?: (anilistIds: number[]) => { prevBound: number | null; prevSelection: unknown } | undefined;
  onAddedUndone?: (prevBound: number | null, prevSelection: unknown) => void;
}

const VIEW_KEY = 'anisong-curator.queueView';
const SESSION_KEY = 'anisong-curator.reviewSession';
function load<T>(key: string, parse: (raw: string | null) => T, fallback: T): T {
  try { return parse(localStorage.getItem(key)); } catch { return fallback; }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

/** "Not it?" opens by itself when the match needs checking. */
const OPEN_BY_DEFAULT: MatchState[] = ['check', 'unlikely', 'no-match', 'error'];

/**
 * The review session: Review → Already have → Add to playlist (docs/SPEC.md,
 * the Review step). Owns the state, the keys and the saved place; the
 * components under review/ render it.
 */
export function Review({ items, country, prefs, autoplay, snapshot, onSnapshot, playlistName, onSettings, onBack, onNewSession, onAdded, onAddedUndone }: Props) {
  const keys = useMemo(() => items.map((i) => i.key), [items]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const scope = sessionScope(keys);

  // ---- Saved place: phase, the current song of each pass, the recorded batch ----
  const [session, setSession] = useState<SessionState>(() => load(SESSION_KEY, (raw) => parseSession(raw, scope), EMPTY_SESSION));
  useEffect(() => { store(SESSION_KEY, { ...session, scope }); }, [session, scope]);
  const phase = session.phase;
  const curReview = session.current.review && byKey.has(session.current.review) ? session.current.review : undefined;
  const curHave = session.current.have && byKey.has(session.current.have) ? session.current.have : undefined;
  const setCurrent = useCallback((pass: 'review' | 'have', key: string | null) =>
    setSession((s) => ({ ...s, current: { ...s.current, [pass]: key ?? undefined } })), []);
  const setDone = useCallback((done: RecordedBatch | undefined) => setSession((s) => {
    const { done: _old, ...rest } = s;
    return done ? { ...rest, done } : rest;
  }), []);

  // ---- Data: matches, decisions, the add log, and the in-playlist check ----
  const activeGuess = phase === 'have' ? curHave : curReview;
  const index = Math.max(0, keys.indexOf(activeGuess ?? ''));
  /** Songs the playlist check found before they were matched: searched last (see useMatching). */
  const laterRef = useRef(new Set<string>());
  const { matches, status, errors, choose, rematch } = useMatching(items, country, prefs, index, laterRef);
  const { decisions, loaded, decide, decideMany, setAddAnyway } = useDecisions(keys);
  const { added, record, undoBatch } = useAdded();
  const playlist = useMemo(() => (snapshot ? indexRows(snapshot.rows, { artistsKnown: snapshot.artistsKnown !== false }) : null), [snapshot]);
  const addedIndex = useMemo(() => (added.length ? indexRows(addedAsRows(added)) : null), [added]);
  // JP-store names of kept tracks (勇者 for "Yuusha"): extra alt names for the check.
  const keptIds = useMemo(() => [...decisions.values()].flatMap((d) => (d.decision === 'keep' && d.trackId ? [d.trackId] : [])), [decisions]);
  const storeNames = useStoreNames(keptIds, country);
  // Same scoring as the export plan, so the passes and the held-back list agree.
  const hits = useMemo(() => {
    const m = new Map<string, DupHit>();
    if (!playlist && !addedIndex) return m;
    for (const it of items) {
      // The playlist comes first: with no Apple Music match yet (still
      // searching, or none found), check the show's own names for the song,
      // and the OP/ED link. A song you have shouldn't read as "no match".
      const t = chosenTrack(matches.get(it.key));
      const q = t
        ? withStoreName({ key: it.key, trackId: t.trackId, title: t.trackName, artist: t.artistName, durationMs: t.trackTimeMillis, ...themeNames(it.theme) }, storeNames.get(t.trackId))
        : { key: it.key, title: it.theme.songTitle ?? it.theme.songTitleNative ?? '', artist: it.theme.artists.join(', '), durationMs: null, ...themeNames(it.theme) };
      if (!q.title) continue;
      const hit = checkSources(q, { playlist, added, addedIndex });
      if (hit) m.set(it.key, hit);
    }
    return m;
  }, [playlist, added, addedIndex, items, matches, storeNames]);
  laterRef.current = new Set([...hits.keys()].filter((k) => !matches.has(k)));
  const canCheck = !!playlist || added.length > 0;

  // ---- The two passes ----
  const passes = useMemo(() => partition(keys, hits, decisions), [keys, hits, decisions]);
  const reviewSet = useMemo(() => new Set(passes.review), [passes.review]);
  const entries = useMemo<QueueEntry[]>(() => items.map((it, i) => ({
    key: it.key, index: i, anime: displayTitle(it.show), title: it.theme.songTitle ?? '',
    match: matchState(matches.get(it.key), status.get(it.key)),
    decision: decisions.get(it.key)?.decision ?? 'undecided',
  })), [items, matches, status, decisions]);
  const reviewEntries = useMemo(() => entries.filter((e) => reviewSet.has(e.key)), [entries, reviewSet]);

  // ---- Review queue view: sort/filter/group with a frozen order (queueView.ts) ----
  const [view, setViewState] = useState<ViewOptions>(() => load(VIEW_KEY, (raw) => sanitizeView(raw ? JSON.parse(raw) : {}), sanitizeView({})));
  const [frozen, setFrozen] = useState<string[]>(() => computeOrder(reviewEntries, view));
  // The order changes only when you change the view or ask for a refresh.
  const setView = useCallback((v: ViewOptions) => { setViewState(v); setFrozen(computeOrder(reviewEntries, v)); store(VIEW_KEY, v); }, [reviewEntries]);
  const refreshOrder = useCallback(() => setFrozen(computeOrder(reviewEntries, view)), [reviewEntries, view]);
  const reviewOrder = useMemo(() => liveOrder(frozen, curReview ?? null, reviewEntries, entries), [frozen, curReview, reviewEntries, entries]);
  const stale = useMemo(() => isStale(frozen.filter((k) => reviewSet.has(k)), reviewEntries, view), [frozen, reviewSet, reviewEntries, view]);
  const haveOrder = useMemo(() => withCurrent(passes.have, curHave ?? null, entries), [passes.have, curHave, entries]);

  const reviewKey = curReview ?? reviewOrder[0] ?? null;
  const haveKey = curHave ?? haveOrder[0] ?? null;
  const activeKey = phase === 'review' ? reviewKey : phase === 'have' ? haveKey : null;
  const order = phase === 'have' ? haveOrder : reviewOrder;
  const pass: 'review' | 'have' = phase === 'have' ? 'have' : 'review';

  // Once stored decisions and cached matches are in: set the order, and land
  // on the first undecided song unless a saved place was restored.
  const landed = useRef(false);
  const statusReady = status.size >= items.length;
  useEffect(() => {
    if (landed.current || !loaded || !statusReady) return;
    landed.current = true;
    const fresh = computeOrder(reviewEntries, view);
    setFrozen(fresh);
    if (!curReview) setCurrent('review', fresh.find((k) => !decisions.has(k)) ?? fresh[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, statusReady]);

  // ---- Moving around ----
  const mainRef = useRef<HTMLElement>(null);
  const goTo = useCallback((key: string | null) => {
    if (!key) return;
    setCurrent(pass, key);
    mainRef.current?.scrollTo({ top: 0 });
    if (window.matchMedia('(max-width: 899px)').matches) mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pass, setCurrent]);
  const step = useCallback((dir: 1 | -1) => goTo(stepKey(order, activeKey, dir)), [goTo, order, activeKey]);
  /** After a decision: the next undecided song in the visible order; if the view has none left, anywhere in this pass. */
  const nextUndecided = useCallback((justDecided: Set<string>) => {
    const undecided = (k: string) => !decisions.has(k) && !justDecided.has(k);
    const k = nextUndecidedKey(order, activeKey, undecided) ?? (phase === 'review' ? passes.review : passes.have).find((x) => x !== activeKey && undecided(x)) ?? null;
    if (k) goTo(k); else step(1);
  }, [decisions, order, activeKey, phase, passes, goTo, step]);
  const goPhase = useCallback((ph: Phase) => {
    setSession((s) => {
      const cur = { ...s.current };
      // Entering the already-have pass: start at its first undecided song.
      if (ph === 'have' && (!cur.have || decisions.has(cur.have) || !passes.have.includes(cur.have))) {
        cur.have = passes.have.find((k) => !decisions.has(k)) ?? passes.have[0];
      }
      return { ...s, phase: ph, current: cur };
    });
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [decisions, passes.have]);

  // ---- The current song ----
  const item = activeKey ? byKey.get(activeKey) : undefined;
  const match = item ? matches.get(item.key) : undefined;
  const chosen = match?.candidates.find((c) => c.track.trackId === match.chosenId);
  const decision = item ? decisions.get(item.key) : undefined;
  const hit = item ? hits.get(item.key) : undefined;
  const state = item ? matchState(match, status.get(item.key)) : 'pending';

  const [notIt, setNotIt] = useState<{ key: string; open: boolean } | null>(null);
  const notItOpen = notIt && notIt.key === activeKey ? notIt.open : phase === 'review' && OPEN_BY_DEFAULT.includes(state);
  const toggleNotIt = useCallback(() => { if (activeKey) setNotIt({ key: activeKey, open: !notItOpen }); }, [activeKey, notItOpen]);
  const audio = useRef<HTMLAudioElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => { stopSample(); }, [activeKey, phase]);

  // ---- Decisions ----
  const doDecide = useCallback(async (d: DecisionValue, addAnyway = false) => {
    if (!item) return;
    if (d === 'keep' && !match?.chosenId) return; // nothing to keep yet
    await decide(item.key, d, d === 'keep' ? match?.chosenId ?? null : null, addAnyway);
    nextUndecided(new Set([item.key]));
  }, [item, match, decide, nextUndecided]);
  /** Shift+1 in the review: keep a song you already have and add it anyway; on one already kept, toggle the override. */
  const addAnywayReview = useCallback(async () => {
    if (!item || !hit || (hit.sameTrack && hit.source === 'added')) return;
    if (decision?.decision === 'keep') await setAddAnyway([item.key], !decision.addAnyway);
    else await doDecide('keep', true);
  }, [item, hit, decision, setAddAnyway, doDecide]);
  /** 1 in the already-have pass. */
  const addAnywayHave = useCallback(async () => {
    if (!item || (hit?.sameTrack && hit.source === 'added')) return;
    await doDecide('keep', true);
  }, [item, hit, doDecide]);
  const laterShow = useCallback(async () => {
    if (!item) return;
    const ks = wholeShowLaterKeys(passes.review, (k) => byKey.get(k)?.show.anilistId, item.key, decisions);
    await decideMany(ks, 'later');
    nextUndecided(new Set(ks));
  }, [item, passes.review, byKey, decisions, decideMany, nextUndecided]);
  const haveUndecided = passes.have.filter((k) => !decisions.has(k));
  const skipRest = useCallback(() => decideMany(haveUndecided, 'skip'), [decideMany, haveUndecided]);
  const choosePick = useCallback((t: ItunesTrack) => { if (item) choose(item, t); }, [item, choose]);

  // ---- Keys: one handler for the whole review ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || phase === 'add') return;
      const k = e.key.toLowerCase();
      // Decisions are by position (e.code, so Shift+1 works on any layout).
      const digit = /^(?:Digit|Numpad)([123])$/.exec(e.code)?.[1];
      if (digit && phase === 'review') {
        if (digit === '1') { if (e.shiftKey) addAnywayReview(); else doDecide('keep'); }
        else if (digit === '2' && !e.shiftKey) doDecide('skip');
        else if (digit === '3') { if (e.shiftKey) laterShow(); else doDecide('later'); }
        else return;
      } else if (digit && phase === 'have') {
        if (digit === '1') addAnywayHave();
        else if (digit === '2' && !e.shiftKey) doDecide('skip');
        else return;
      } else if (k === 'j' || e.key === 'ArrowRight') step(1);
      else if (k === 'k' || e.key === 'ArrowLeft') step(-1);
      else if (k === 'c') toggleNotIt();
      else if (k === '/') searchBox.current?.focus();
      else if (k === ' ') {
        const el = audio.current;
        if (el?.src) (el.paused ? el.play() : (el.pause(), Promise.resolve())).catch(() => {});
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, doDecide, addAnywayReview, addAnywayHave, laterShow, step, toggleNotIt]);

  // ---- Header numbers ----
  const decided = (ks: string[]) => ks.filter((k) => decisions.has(k)).length;
  const reviewDone = decided(passes.review);
  const pending = items.filter((i) => status.get(i.key) !== 'done' && status.get(i.key) !== 'error').length;
  const reviewFinished = passes.review.length > 0 && reviewDone === passes.review.length;
  const haveFinished = phase === 'add' || !!session.done || (passes.have.length > 0 && haveUndecided.length === 0);
  const [syncOpen, setSyncOpen] = useState(false);
  const showCount = useMemo(() => new Set(items.map((i) => i.show.anilistId)).size, [items]);
  const pickFromAdd = useCallback((key: string) => {
    const ph: Phase = reviewSet.has(key) ? 'review' : 'have';
    setSession((s) => ({ ...s, phase: ph, current: { ...s.current, [ph]: key } }));
  }, [reviewSet]);

  const shared: Omit<CardShared, 'item'> = {
    match, chosen, status: item ? status.get(item.key) : undefined, error: item ? errors.get(item.key) : undefined, decision, hit, canCheck,
    prefs, country, autoplay, onAutoplay: (on) => onSettings({ autoplay: on }), audioRef: audio, searchRef: searchBox,
    notItOpen, onNotIt: toggleNotIt, onChoose: choosePick, onRetry: () => { if (item) rematch(item); },
    onUndo: () => { if (item) decide(item.key, null, null); },
  };
  const next = nextPhase(phase, passes.have.length);

  return (
    <div className="rv">
      <ReviewHeader
        phase={phase} showCount={showCount} songCount={items.length} pending={pending}
        progress={phase === 'review' ? { done: reviewDone, total: passes.review.length } : phase === 'have' ? { done: decided(passes.have), total: passes.have.length } : null}
        haveCount={passes.have.length} haveUndecided={haveUndecided.length}
        passDone={phase === 'review' ? reviewFinished : phase === 'have' && haveUndecided.length === 0}
        onNext={() => next && goPhase(next)} onSkipRest={skipRest} onBack={onBack}
      />
      <PhaseBar phase={phase} counts={{ review: passes.review.length, have: passes.have.length }}
        finished={{ review: reviewFinished, have: haveFinished, add: !!session.done }} onPhase={goPhase} />

      {phase === 'add' ? (
        <AddToPlaylistView
          items={items} byKey={byKey} review={passes.review} have={passes.have} decisions={decisions} matches={matches}
          country={country} playlistName={playlistName} playlist={playlist} snapshot={snapshot} onSnapshot={onSnapshot}
          syncOpen={syncOpen} onSyncOpen={setSyncOpen} added={added} storeNames={storeNames}
          onRecord={record} onUndo={undoBatch} onAddAnyway={setAddAnyway} done={session.done} onDone={setDone}
          onPick={pickFromAdd} onNewSession={onNewSession} onAdded={onAdded} onAddedUndone={onAddedUndone}
        />
      ) : (
        <div className="rv-split">
          {phase === 'review'
            ? <QueuePanel items={byKey} entries={reviewEntries} allEntries={entries} order={reviewOrder} currentKey={reviewKey} onPick={goTo} onStep={step}
                decisions={decisions} hits={hits} view={view} onView={setView} stale={stale} onRefresh={refreshOrder}
                haveCount={passes.have.length} canCheck={canCheck} onSync={() => { setSyncOpen(true); goPhase('add'); }} />
            : <HaveQueue items={byKey} order={haveOrder} currentKey={haveKey} onPick={goTo} onStep={step} decisions={decisions} hits={hits} />}
          <main className="rv-main" ref={mainRef} aria-label="Song under review">
            {item ? (
              phase === 'review'
                ? <SongCard key={item.key} item={item} {...shared} state={state} onDecide={(d) => doDecide(d)} onAddAnyway={addAnywayReview} onLaterShow={laterShow}
                    showUndecided={passes.review.filter((k) => byKey.get(k)?.show.anilistId === item.show.anilistId && (k === item.key || !decisions.has(k))).length} />
                : <HaveCard key={item.key} item={item} {...shared} onAddAnyway={addAnywayHave} onSkip={() => doDecide('skip')} />
            ) : (
              <div className="rv-empty">
                <h2>{phase === 'have' ? 'Nothing you already have' : 'No new songs to review'}</h2>
                <p className="muted">{phase === 'have' ? 'None of the matched songs are in your playlist.' : 'Every song here is already in your playlist.'}</p>
                {next && <button className="btn-accent" onClick={() => goPhase(next)}>Next: {next === 'have' ? 'Already have' : 'Add to playlist'} →</button>}
              </div>
            )}
            <KeyLegend phase={phase} />
          </main>
        </div>
      )}
    </div>
  );
}

function KeyLegend({ phase }: { phase: Phase }) {
  return (
    <p className="legend" aria-label="Keyboard shortcuts">
      {phase === 'review'
        ? <><kbd>1</kbd> keep <kbd>2</kbd> skip <kbd>3</kbd> later <kbd>⇧3</kbd> whole show</>
        : <><kbd>1</kbd> add anyway <kbd>2</kbd> skip</>}
      {' '}<kbd>J</kbd><kbd>K</kbd> next / previous <kbd>space</kbd> play <kbd>C</kbd> not it? <kbd>/</kbd> search
    </p>
  );
}
