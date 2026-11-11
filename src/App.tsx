import { useEffect, useMemo, useState } from 'react';
import type { Show, ThemeLookup } from './types';
import { authorizeUrl, consumeTokenFromHash, fetchAnimeList, fetchViewerName } from './lib/anilist';
import { loadShows, saveShows, themeCache } from './lib/db';
import { candidatesAfterBound, orderShows } from './lib/ordering';
import { useSettings } from './lib/settings';
import { resolveThemes, type ResolveProgress } from './lib/themes';
import { ShowPicker } from './components/ShowPicker';
import { ThemeList } from './components/ThemeList';

type Step = 'pick' | 'themes';

export function App() {
  const [settings, update] = useSettings();
  const [shows, setShows] = useState<Show[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [lookups, setLookups] = useState<Map<number, ThemeLookup>>(new Map());
  const [themeErrors, setThemeErrors] = useState<Map<number, string>>(new Map());
  const [progress, setProgress] = useState<ResolveProgress | null>(null);

  // Implicit-grant return, then cached list.
  useEffect(() => {
    const token = consumeTokenFromHash();
    if (token) {
      update({ token });
      fetchViewerName(token).then((userName) => update({ userName })).catch((e: Error) => setError(e.message));
    }
    loadShows().then(({ shows, at }) => { setShows(shows); setLoadedAt(at); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordered = useMemo(() => orderShows(shows, settings.order), [shows, settings.order]);
  const candidates = useMemo(
    () => candidatesAfterBound(ordered, settings.boundId, settings.order.direction),
    [ordered, settings.boundId, settings.order.direction],
  );

  async function loadList() {
    if (!settings.userName.trim()) { setError('Enter your AniList username.'); return; }
    setLoading(true); setError(null);
    try {
      const list = await fetchAnimeList(settings.userName.trim(), settings.token);
      await saveShows(list, settings.userName.trim());
      setShows(list); setLoadedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function findThemes(refresh = false) {
    setStep('themes'); setThemeErrors(new Map()); setLookups(new Map());
    setProgress({ done: 0, total: candidates.length, phase: 'cache' });
    const { lookups, errors } = await resolveThemes(candidates.map((c) => c.show), {
      cache: themeCache(), onProgress: setProgress, refresh,
    });
    setLookups(lookups); setThemeErrors(errors);
  }

  return (
    <div className="app">
      <header>
        <h1>anisong-curator</h1>
        <p className="muted">Find the OP/ED songs from shows you've watched since your playlist was last updated.</p>
      </header>

      <section className="card">
        <h2>1 · AniList</h2>
        <div className="row">
          <label>Username
            <input value={settings.userName} onChange={(e) => update({ userName: e.target.value })} placeholder="AniList username" />
          </label>
          <button onClick={loadList} disabled={loading}>{loading ? 'Loading…' : shows.length ? 'Refresh list' : 'Load list'}</button>
          {loadedAt && <span className="muted">{shows.length} entries · loaded {new Date(loadedAt).toLocaleString()}</span>}
        </div>
        <details>
          <summary className="muted">Private list? Log in with AniList</summary>
          <div className="row">
            <label>Client ID
              <input value={settings.clientId} onChange={(e) => update({ clientId: e.target.value })} size={8} />
            </label>
            <button className="secondary" disabled={!settings.clientId} onClick={() => { location.href = authorizeUrl(settings.clientId); }}>
              Log in
            </button>
            {settings.token && <button className="secondary" onClick={() => update({ token: null })}>Log out</button>}
            <span className="muted">Register a client at anilist.co/settings/developer with redirect URL <code>{location.origin}/</code></span>
          </div>
        </details>
        {error && <p className="bad">{error}</p>}
      </section>

      {shows.length > 0 && step === 'pick' && (
        <ShowPicker
          ordered={ordered}
          order={settings.order}
          onOrder={(order) => update({ order })}
          boundId={settings.boundId}
          onBound={(boundId) => update({ boundId })}
          candidateCount={candidates.length}
          onContinue={() => findThemes()}
        />
      )}

      {step === 'themes' && (
        <ThemeList
          candidates={candidates}
          lookups={lookups}
          errors={themeErrors}
          progress={progress}
          includeInserts={settings.includeInserts}
          onIncludeInserts={(includeInserts) => update({ includeInserts })}
          onBack={() => setStep('pick')}
          onRetry={() => findThemes(true)}
        />
      )}
    </div>
  );
}
