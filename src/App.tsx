import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ThemeLookup } from './types';
import { fetchViewerName } from './lib/anilist';
import { loadLatestSnapshot, themeCache, type PlaylistSnapshot } from './lib/db';
import { orderShows } from './lib/ordering';
import { selectedShows, selectNewer } from './lib/selection';
import { isSetupComplete, nextSetupStep, SETUP_STEPS, useSettings, type SetupStep, type StepState } from './lib/settings';
import { resolveThemes, sortThemes, type ResolveProgress } from './lib/themes';
import { useAniList } from './lib/useAniList';
import { buildReviewItems } from './lib/useMatching';
import { parseHash, useRoute, type Route } from './app/router';
import { oauthReturn, oauthToken } from './app/oauth';
import { AppHeader, type Crumb } from './components/shell/AppHeader';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { SetupStepPage, Welcome } from './pages/Setup';
import { ShowPicker } from './components/ShowPicker';
import { PlaylistPanel } from './components/PlaylistPanel';
import { ThemeList } from './components/ThemeList';
import { Review } from './components/review/Review';
import './components/shell/shell.css';

/** Pre-router builds remembered the step here; read once to reopen a review. */
const LEGACY_STEP_KEY = 'anisong-curator.step';

export interface LookupState {
  running: boolean;
  progress: ResolveProgress | null;
  lookups: Map<number, ThemeLookup>;
  errors: Map<number, string>;
}

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
  const [snapshot, setSnapshot] = useState<PlaylistSnapshot | null>(null);
  const [suggestedId, setSuggestedId] = useState<number | null>(null);
  const [lookup, setLookup] = useState<LookupState | null>(null);
  /** The interim songs view on the anime page (replaced by the progress footer). */
  const [songsView, setSongsView] = useState(false);
  useEffect(() => { loadLatestSnapshot().then(setSnapshot); }, []);

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

  const findSongs = useCallback(async (refresh = false) => {
    const shows = candidates.map((c) => c.show);
    setLookup({ running: true, progress: { done: 0, total: shows.length, phase: 'cache' }, lookups: new Map(), errors: new Map() });
    const { lookups, errors } = await resolveThemes(shows, {
      cache: themeCache(), refresh,
      onProgress: (progress) => setLookup((l) => (l ? { ...l, progress } : l)),
    });
    setLookup({ running: false, progress: { done: shows.length, total: shows.length, phase: 'done' }, lookups, errors });
    return errors.size === 0;
  }, [candidates]);

  // Reloaded on the review: resolve the songs from the cache, then show it.
  const needsLookup = page.name === 'review' && setupDone && !lookup && candidates.length > 0;
  useEffect(() => { if (needsLookup) void findSongs(); }, [needsLookup, findSongs]);

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
        { label: 'Anime', count: candidates.length, current: page.name === 'anime' && !songsView, onClick: () => { setSongsView(false); navigate({ page: { name: 'anime' } }); } },
        { label: 'Songs', count: lookup && !lookup.running ? reviewItems.length : undefined, current: page.name === 'anime' && songsView, onClick: lookup ? () => { setSongsView(true); navigate({ page: { name: 'anime' } }); } : undefined },
        { label: 'Review', current: page.name === 'review', onClick: lookup && !lookup.running && reviewItems.length ? () => navigate({ page: { name: 'review' } }) : undefined },
      ]
    : [];

  const playlistSlot = (
    <PlaylistPanel
      playlistName={settings.playlistName} snapshot={snapshot} onSnapshot={setSnapshot}
      shows={anilist.shows} ordered={ordered} direction={settings.order.direction} boundId={settings.boundId}
      onBound={(boundId) => update({ boundId, selection: selectNewer() })} onSuggest={setSuggestedId}
    />
  );

  const header = (
    <AppHeader
      onSettings={() => (route.settings ? closeSettings() : openSettings())}
      settingsOpen={!!route.settings}
      crumbs={crumbs}
      account={setupDone && anilist.user ? {
        user: anilist.user, loadedAt: anilist.loadedAt, loading: anilist.loading,
        onRefresh: () => void anilist.load(), onOpen: () => openSettings('anilist'),
      } : null}
    />
  );
  const settingsPanel = route.settings && (
    <SettingsPanel
      section={route.settings} onSection={(s) => navigate({ settings: s }, { replace: true })} onClose={closeSettings}
      settings={settings} update={update} anilist={anilist} playlistSlot={playlistSlot} onRerunSetup={rerunSetup}
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
        step={page.step} settings={settings} update={update} anilist={anilist} playlistSlot={playlistSlot}
        onStep={(state) => markStep(page.step, state)}
        onBack={() => navigate({ page: i > 0 ? { name: 'setup', step: SETUP_STEPS[i - 1]! } : { name: 'welcome' } })}
      />
    );
  } else if (page.name === 'review') {
    body = lookup && !lookup.running
      ? (
        <Review
          items={reviewItems} country={settings.country} prefs={prefs} autoplay={settings.autoplay}
          playlistName={settings.playlistName} snapshot={snapshot} onSnapshot={setSnapshot} onSettings={update}
          onBack={() => { setSongsView(true); navigate({ page: { name: 'anime' } }); }}
          onNewSession={() => { setSongsView(false); setLookup(null); navigate({ page: { name: 'anime' } }); }}
        />
      )
      : <p className="muted resuming">{candidates.length ? 'Restoring your review…' : 'Nothing to review yet: pick some anime first.'}</p>;
  } else {
    // anime (and, until the playlist library lands, playlist): the picker, then the songs list.
    body = (
      <main className="app">
        {settings.notices.settingsMoved === false && (
          <p className="notice">
            Your AniList account, playlist and preferences moved to <button className="btn-link" onClick={() => openSettings()}>⚙ Settings</button>.
            <button className="btn-link" onClick={() => update((s) => ({ notices: { ...s.notices, settingsMoved: true } }))} aria-label="Dismiss">✕</button>
          </p>
        )}
        {anilist.error && <p className="bad">AniList: {anilist.error}</p>}
        {songsView && lookup ? (
          <ThemeList
            candidates={candidates} lookups={lookup.lookups} errors={lookup.errors} progress={lookup.progress}
            includeInserts={settings.includeInserts} onIncludeInserts={(includeInserts) => update({ includeInserts })}
            onBack={() => setSongsView(false)} onRetry={() => void findSongs(true)}
            onReview={() => navigate({ page: { name: 'review' } })} reviewCount={reviewItems.length}
          />
        ) : (
          <>
            {!snapshot && playlistSlot}
            {anilist.shows.length > 0 ? (
              <ShowPicker
                ordered={ordered} order={settings.order} onOrder={(order) => update({ order })}
                boundId={settings.boundId} selection={settings.selection} onSelect={(patch) => update(patch)}
                suggestedId={suggestedId} candidateCount={candidates.length}
                onContinue={() => { setSongsView(true); void findSongs(); }}
              />
            ) : <p className="muted">{anilist.loading ? 'Loading your AniList list…' : 'No AniList list loaded: open ⚙ Settings › AniList.'}</p>}
          </>
        )}
      </main>
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
