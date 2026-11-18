import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchViewerName } from './lib/anilist';
import { db, themeCache } from './lib/db';
import { orderShows } from './lib/ordering';
import { selectedShows, selectNewer, selectNone, setShows, type Selection } from './lib/selection';
import { isSetupComplete, nextSetupStep, SETUP_STEPS, useSettings, type SetupStep, type StepState } from './lib/settings';
import { resolveThemes, sortThemes } from './lib/themes';
import { cachedSongCounts } from './lib/songCounts';
import { useAniList } from './lib/useAniList';
import { buildReviewItems } from './lib/useMatching';
import { parseHash, useRoute, type Route } from './app/router';
import { oauthReturn, oauthToken } from './app/oauth';
import { AppHeader, type Crumb } from './components/shell/AppHeader';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { ago } from './components/settings/sections';
import { SetupStepPage, Welcome } from './pages/Setup';
import { PlaylistChip, PlaylistImport, PlaylistPage, type PlaylistFilter } from './components/playlist';
import { useCoverage, useLastShowSuggestion, usePlaylistLibrary, usePlaylistSnapshot } from './lib/usePlaylistLibrary';
import { AnimePage } from './pages/AnimePage';
import type { LookupState } from './components/anime/LookupFooter';
import { Review } from './components/review/Review';
import './components/shell/shell.css';

/** Pre-router builds remembered the step here; read once to reopen a review. */
const LEGACY_STEP_KEY = 'anisong-curator.step';

export function App() {
  const [settings, update] = useSettings();
  const anilist = useAniList(settings.userName, settings.token);
  const setupDone = isSetupComplete(settings.onboarding);

  const fallback = useCallback((): Route => {
    const fromLogin = oauthReturn ? parseHash(oauthReturn) : null;
    if (fromLogin) return fromLogin;
    if (!isSetupComplete(settings.onboarding)) {
      return { page: settings.onboarding.startedAt ? { name: 'setup', step: nextSetupStep(settings.onboarding) ?? 'anilist' } : { name: 'welcome' }, settings: null };
    }
    let legacy: string | null = null;
    try { legacy = localStorage.getItem(LEGACY_STEP_KEY); } catch { /* private mode */ }
    return { page: { name: legacy === 'review' ? 'review' : 'anime' }, settings: null };
    // The fallback is only read on load and on unknown hashes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [route, navigate] = useRoute(fallback);
  const page = route.page;

  // The old step key has done its job once settings have migrated and the route is set.
  useEffect(() => { try { localStorage.removeItem(LEGACY_STEP_KEY); } catch { /* private mode */ } }, []);

  // Logged in with AniList: keep the token, and take the username from it.
  useEffect(() => {
    if (!oauthToken) return;
    update({ token: oauthToken });
    fetchViewerName(oauthToken).then((userName) => { update({ userName }); void anilist.load(userName); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Until setup is done, the session pages send you to it.
  useEffect(() => {
    if (setupDone || page.name === 'welcome' || page.name === 'setup') return;
    const step = nextSetupStep(settings.onboarding);
    navigate({ page: settings.onboarding.startedAt && step ? { name: 'setup', step } : { name: 'welcome' } }, { replace: true });
  }, [setupDone, page.name, settings.onboarding, navigate]);

  /* ---------------- session state ---------------- */
  const snapshot = usePlaylistSnapshot();
  const { status: playlist } = usePlaylistLibrary();
  const suggestion = useLastShowSuggestion(anilist.shows);
  const coverage = useCoverage();
  const [playlistFilter, setPlaylistFilter] = useState<PlaylistFilter>('all');
  const [lookup, setLookup] = useState<LookupState | null>(null);
  /** Bumped to cancel a lookup: results from an older run are ignored. */
  const lookupRun = useRef(0);
  const [songCounts, setSongCounts] = useState<Map<number, number | 'none'>>(new Map());
  const [lastSessionAt, setLastSessionAt] = useState<number | null>(null);
  useEffect(() => { void db.added.orderBy('addedAt').last().then((r) => setLastSessionAt(r?.addedAt ?? null)); }, [page.name]);

  const ordered = useMemo(() => orderShows(anilist.shows, settings.order), [anilist.shows, settings.order]);
  const candidates = useMemo(
    () => selectedShows(settings.selection, { ordered, boundId: settings.boundId, direction: settings.order.direction }),
    [ordered, settings.selection, settings.boundId, settings.order.direction],
  );
  const reviewItems = useMemo(
    // Review and export run oldest → newest (playlist order) whatever the display direction.
    () => buildReviewItems((settings.order.direction === 'desc' ? [...candidates].reverse() : candidates).map((c) => c.show), (s) =>
      sortThemes(lookup?.lookups.get(s.anilistId)?.themes ?? []).filter((t) => settings.includeInserts || t.kind !== 'IN')),
    [candidates, lookup, settings.includeInserts, settings.order.direction],
  );
  const prefs = useMemo(() => ({ preferTvSize: settings.preferTvSize }), [settings.preferTvSize]);

  // ♪ counts on the anime page come from the cache only; refreshed after each lookup.
  useEffect(() => {
    if (page.name !== 'anime' || lookup?.running) return;
    void cachedSongCounts(ordered.map((o) => o.show.anilistId), settings.includeInserts).then(setSongCounts);
  }, [page.name, ordered, settings.includeInserts, lookup?.running]);

  /** Look up the selected shows' songs; on success (and when asked) open the review. */
  const findSongs = useCallback(async ({ refresh = false, open = true } = {}) => {
    const run = ++lookupRun.current;
    const shows = candidates.map((c) => c.show);
    setLookup({ running: true, progress: { done: 0, total: shows.length, phase: 'cache' }, lookups: new Map(), errors: new Map() });
    const { lookups, errors } = await resolveThemes(shows, {
      cache: themeCache(), refresh,
      onProgress: (progress) => { if (run === lookupRun.current) setLookup((l) => (l ? { ...l, progress } : l)); },
    });
    if (run !== lookupRun.current) return;
    setLookup({ running: false, progress: { done: shows.length, total: shows.length, phase: 'done' }, lookups, errors });
    if (open && errors.size === 0) navigate({ page: { name: 'review' } });
  }, [candidates, navigate]);
  const cancelLookup = () => { lookupRun.current++; setLookup(null); };

  // Reloaded on the review: resolve the songs from the cache, then show it.
  const needsLookup = page.name === 'review' && setupDone && !lookup && candidates.length > 0;
  useEffect(() => { if (needsLookup) void findSongs({ open: false }); }, [needsLookup, findSongs]);

  /* ---------------- navigation helpers ---------------- */
  const openSettings = (section = route.settings ?? 'anilist') => navigate({ settings: section });
  const closeSettings = () => navigate({ settings: null });
  const markStep = (step: SetupStep, state: StepState) => {
    const steps = { ...settings.onboarding.steps, [step]: state };
    const onboarding = { ...settings.onboarding, steps, completedAt: settings.onboarding.completedAt };
    const done = isSetupComplete(onboarding);
    if (done && !onboarding.completedAt) onboarding.completedAt = Date.now();
    update({ onboarding });
    const next = SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1] ?? nextSetupStep(onboarding);
    navigate({ page: done || !next ? { name: 'anime' } : { name: 'setup', step: next } });
  };
  const rerunSetup = () => {
    update((s) => ({ onboarding: { ...s.onboarding, startedAt: null, completedAt: null, steps: {} } }));
    navigate({ page: { name: 'welcome' }, settings: null });
  };

  const crumbs: Crumb[] = setupDone && (page.name === 'anime' || page.name === 'review')
    ? [
        { label: 'Anime', count: candidates.length, current: page.name === 'anime' && !lookup?.running, onClick: () => navigate({ page: { name: 'anime' } }) },
        { label: 'Songs', count: lookup && !lookup.running ? reviewItems.length : undefined, current: page.name === 'anime' && !!lookup?.running },
        { label: 'Review', current: page.name === 'review', onClick: lookup && !lookup.running && reviewItems.length ? () => navigate({ page: { name: 'review' } }) : undefined },
      ]
    : [];

  const playlistSettings = (
    <div className="set-section">
      {playlist && playlist.rowCount > 0 && (
        <div className="set-inline">
          <span>
            <b>{playlist.rowCount} songs</b> · synced {ago(playlist.syncedAt)} · {playlist.linked} linked · {playlist.unlinked} unlinked
            {playlist.pendingAdds > 0 && <> · {playlist.pendingAdds} added, not seen yet</>}
            {!playlist.ordered && <span className="muted"> · in import order</span>}
          </span>
          <button className="btn-line" onClick={() => { setPlaylistFilter('all'); navigate({ page: { name: 'playlist' }, settings: null }); }}>Open playlist</button>
        </div>
      )}
      <PlaylistImport variant="settings" shows={anilist.shows} playlistName={settings.playlistName} />
    </div>
  );

  /** "Yes, mark as added": the newest show of the batch becomes the last show added. Returns the previous one, for Undo. */
  const onAdded = (ids: number[]) => {
    const idx = new Map(ordered.map((o, i) => [o.show.anilistId, i]));
    const known = ids.filter((id) => idx.has(id));
    if (!known.length) return undefined;
    const newest = known.reduce((a, b) => {
      const ia = idx.get(a)!, ib = idx.get(b)!;
      return settings.order.direction === 'desc' ? (ib < ia ? b : a) : (ib > ia ? b : a);
    });
    const prev = { prevBound: settings.boundId, prevSelection: settings.selection };
    update({ boundId: newest, selection: selectNewer() });
    return prev;
  };

  const header = (
    <AppHeader
      onSettings={() => (route.settings ? closeSettings() : openSettings())}
      settingsOpen={!!route.settings}
      crumbs={crumbs}
      account={setupDone && anilist.user ? {
        user: anilist.user, loadedAt: anilist.loadedAt, loading: anilist.loading,
        onRefresh: () => void anilist.load(), onOpen: () => openSettings('anilist'),
      } : null}
      playlist={setupDone ? (
        <PlaylistChip
          playlistName={settings.playlistName}
          onOpen={(filter) => { setPlaylistFilter(filter ?? 'all'); navigate({ page: { name: 'playlist' }, settings: null }); }}
          onResync={() => openSettings('playlist')} onSettings={() => openSettings('playlist')}
        />
      ) : null}
    />
  );
  const settingsPanel = route.settings && (
    <SettingsPanel
      section={route.settings} onSection={(s) => navigate({ settings: s }, { replace: true })} onClose={closeSettings}
      settings={settings} update={update} anilist={anilist} playlistSlot={playlistSettings} onRerunSetup={rerunSetup}
    />
  );

  /* ---------------- pages ---------------- */
  let body: React.ReactNode;
  if (page.name === 'welcome') {
    body = <Welcome onStart={() => { update((s) => ({ onboarding: { ...s.onboarding, startedAt: s.onboarding.startedAt ?? Date.now() } })); navigate({ page: { name: 'setup', step: nextSetupStep(settings.onboarding) ?? 'anilist' } }); }} onSettings={() => openSettings()} />;
  } else if (page.name === 'setup') {
    const i = SETUP_STEPS.indexOf(page.step);
    body = (
      <SetupStepPage
        step={page.step} settings={settings} update={update} anilist={anilist}
        playlistSlot={(
          <PlaylistImport variant="setup" shows={anilist.shows} playlistName={settings.playlistName}
            onDone={() => markStep('playlist', 'done')} onSkip={() => markStep('playlist', 'skipped')} />
        )}
        ownActions={page.step === 'playlist' && !playlist?.rowCount}
        onStep={(state) => markStep(page.step, state)}
        onBack={() => navigate({ page: i > 0 ? { name: 'setup', step: SETUP_STEPS[i - 1]! } : { name: 'welcome' } })}
      />
    );
  } else if (page.name === 'review') {
    body = lookup && !lookup.running
      ? (
        <Review
          items={reviewItems} country={settings.country} prefs={prefs} autoplay={settings.autoplay}
          playlistName={settings.playlistName} snapshot={snapshot} onSnapshot={() => undefined} onSettings={update}
          onAdded={onAdded} onAddedUndone={(prevBound, prevSelection) => update({ boundId: prevBound, selection: (prevSelection as Selection | undefined) ?? selectNewer() })}
          onBack={() => { setLookup(null); navigate({ page: { name: 'anime' } }); }}
          onNewSession={() => { setLookup(null); navigate({ page: { name: 'anime' } }); }}
        />
      )
      : <p className="muted resuming">{candidates.length ? 'Restoring your review…' : 'Nothing to review yet: pick some anime first.'}</p>;
  } else if (page.name === 'playlist') {
    body = (
      <main className="page-pad">
      <PlaylistPage
        key={playlistFilter} shows={anilist.shows} initialFilter={playlistFilter}
        onBack={() => navigate({ page: { name: 'anime' } })}
        onResync={() => openSettings('playlist')}
        onReviewShow={(id) => {
          // "Review the missing songs": a session with just this show.
          update({ selection: setShows(selectNone(), [id], true, { ordered, boundId: settings.boundId, direction: settings.order.direction }) });
          setLookup(null);
          navigate({ page: { name: 'anime' } });
        }}
      />
      </main>
    );
  } else {
    // anime
    body = (
      <>
        {(settings.notices.settingsMoved === false || anilist.error) && (
          <div className="page-notes">
            {settings.notices.settingsMoved === false && (
              <p className="notice">
                Your AniList account, playlist and preferences moved to <button className="btn-link" onClick={() => openSettings()}>⚙ Settings</button>.
                <button className="btn-link" onClick={() => update((s) => ({ notices: { ...s.notices, settingsMoved: true } }))} aria-label="Dismiss">✕</button>
              </p>
            )}
            {anilist.error && <p className="bad">AniList: {anilist.error}</p>}
          </div>
        )}
        {anilist.shows.length > 0 ? (
          <AnimePage
            shows={anilist.shows} ordered={ordered} order={settings.order} onOrder={(order) => update({ order })}
            boundId={settings.boundId} selection={settings.selection} onSelect={(patch) => update(patch)}
            candidates={candidates} listStatuses={settings.listStatuses}
            suggestion={suggestion ? { anilistId: suggestion.anilistId, evidence: suggestion.evidence } : null}
            coverage={coverage} cachedSongCounts={songCounts} lastSessionAt={lastSessionAt}
            newSinceVisit={anilist.newlyFinished} lookup={lookup} includeInserts={settings.includeInserts}
            onFindSongs={() => void findSongs()} onCancelLookup={cancelLookup}
            onRetryLookup={() => void findSongs({ refresh: true })} onReviewAnyway={() => navigate({ page: { name: 'review' } })}
          />
        ) : (
          <main className="app"><p className="muted">{anilist.loading ? 'Loading your AniList list…' : 'No AniList list loaded: open ⚙ Settings › AniList.'}</p></main>
        )}
      </>
    );
  }

  const onboarding = page.name === 'welcome' || page.name === 'setup';
  return (
    <div className={`shell ${page.name === 'review' ? 'shell-full' : ''} ${onboarding ? 'shell-setup' : ''}`}>
      {header}
      {body}
      {settingsPanel}
    </div>
  );
}
