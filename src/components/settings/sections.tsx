import { useState } from 'react';
import type { ReactNode } from 'react';
import { authorizeUrl, displayTitle } from '../../lib/anilist';
import { db } from '../../lib/db';
import { fuzzyDateKey } from '../../lib/ordering';
import type { Settings, UpdateSettings } from '../../lib/settings';
import type { useAniList } from '../../lib/useAniList';

export type Mode = 'setup' | 'settings';
type AniList = ReturnType<typeof useAniList>;

export const SHORTCUTS_GUIDE = 'https://github.com/Dtphelan1/anisong-curator/blob/main/shortcuts/README.md';
export const STOREFRONTS: [string, string][] = [
  ['us', 'United States'], ['ca', 'Canada'], ['gb', 'United Kingdom'], ['au', 'Australia'], ['jp', 'Japan'], ['de', 'Germany'],
  ['fr', 'France'], ['es', 'Spain'], ['it', 'Italy'], ['nl', 'Netherlands'], ['se', 'Sweden'], ['br', 'Brazil'], ['mx', 'Mexico'],
  ['kr', 'South Korea'], ['tw', 'Taiwan'], ['hk', 'Hong Kong'], ['sg', 'Singapore'], ['ph', 'Philippines'], ['in', 'India'],
];

/** Where the AniList login sends you back to (the implicit grant returns to the site root). */
export const OAUTH_RETURN_KEY = 'anisong-curator.oauthReturn';

export function ago(at: number | null): string {
  if (!at) return 'never';
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 60 ? `${d} d ago` : new Date(at).toLocaleDateString();
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-field">
      <div className="set-label">{label}</div>
      <div className="set-control">{children}{hint && <div className="set-hint">{hint}</div>}</div>
    </div>
  );
}

function LoginForm({ settings, update }: { settings: Settings; update: UpdateSettings }) {
  return (
    <div className="set-login">
      <label className="set-inline">Client ID
        <input value={settings.clientId} onChange={(e) => update({ clientId: e.target.value })} size={8} />
      </label>
      <button className="btn-line" disabled={!settings.clientId} onClick={() => {
        try { sessionStorage.setItem(OAUTH_RETURN_KEY, location.hash); } catch { /* private mode */ }
        location.href = authorizeUrl(settings.clientId);
      }}>Log in with AniList</button>
      {settings.token && <button className="btn-line" onClick={() => update({ token: null })}>Log out</button>}
      <div className="set-hint">Register a client at anilist.co/settings/developer with the redirect URL <code>{location.origin}/</code>.</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function AniListSection({ mode, settings, update, anilist }: { mode: Mode; settings: Settings; update: UpdateSettings; anilist: AniList }) {
  const [name, setName] = useState(settings.userName);
  const loaded = anilist.shows.length > 0 && anilist.user === settings.userName.trim();
  const recent = [...anilist.shows]
    .filter((s) => s.status === 'COMPLETED')
    .sort((a, b) => (fuzzyDateKey(b.completedAt) ?? 0) - (fuzzyDateKey(a.completedAt) ?? 0) || b.updatedAt - a.updatedAt)
    .slice(0, 3);
  const submit = async () => {
    const user = name.trim();
    update({ userName: user });
    await anilist.load(user);
  };

  return (
    <div className="set-section">
      <Field label="AniList username" hint={mode === 'setup' ? 'The app only reads your list; nothing on AniList changes.' : undefined}>
        <form className="set-inline" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="username" autoFocus={mode === 'setup'} aria-label="AniList username" />
          <button className={mode === 'setup' && !loaded ? 'btn-accent' : 'btn-line'} disabled={anilist.loading || !name.trim()}>
            {anilist.loading ? 'Loading…' : name.trim() === anilist.user ? 'Sync now' : 'Load'}
          </button>
        </form>
      </Field>
      {anilist.error && !anilist.isPrivate && <p className="bad set-msg">{anilist.error}</p>}
      {anilist.isPrivate && (
        <div className="set-callout warn">
          <strong>This list is private.</strong> Log in so the app can read it, or make it public in AniList's settings.
          <LoginForm settings={settings} update={update} />
        </div>
      )}
      {loaded && mode === 'setup' && (
        <div className="set-callout ok">
          <strong>✓ {anilist.shows.length} shows loaded</strong>
          {recent.length > 0 && <div>Most recently finished: {recent.map((s) => displayTitle(s)).join(' · ')}</div>}
          <div className="set-hint">Not your list? Change the name and load again.</div>
        </div>
      )}
      {mode === 'settings' && (
        <>
          <Field label="Your list">
            {loaded ? <>{anilist.shows.length} shows · synced {ago(anilist.loadedAt)}</> : <span className="muted">Not loaded</span>}
            <div className="set-hint">Refreshes by itself when it's more than 12 hours old.</div>
          </Field>
          <Field label="Also list" hint="Listed on the anime page, never pre-selected.">
            <label className="set-check"><input type="checkbox" checked={settings.listStatuses.dropped} onChange={(e) => update((s) => ({ listStatuses: { ...s.listStatuses, dropped: e.target.checked } }))} /> Dropped</label>
            <label className="set-check"><input type="checkbox" checked={settings.listStatuses.paused} onChange={(e) => update((s) => ({ listStatuses: { ...s.listStatuses, paused: e.target.checked } }))} /> Paused</label>
          </Field>
          {!anilist.isPrivate && (
            <details className="set-details" open={!!settings.token}>
              <summary>Private list? Log in with AniList <span className="muted">(not needed for public lists)</span></summary>
              <LoginForm settings={settings} update={update} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function PlaylistSection({ mode, settings, update, children }: { mode: Mode; settings: Settings; update: UpdateSettings; children?: ReactNode }) {
  return (
    <div className="set-section">
      <Field label="Playlist" hint="The Apple Music playlist kept songs go into. In Shortcuts, pick it from the picker; don't type it.">
        <input value={settings.playlistName} onChange={(e) => update({ playlistName: e.target.value })} size={28} aria-label="Playlist name" />
      </Field>
      {children && <div className="set-slot">{children}</div>}
      {mode === 'setup' && (
        <p className="set-hint">Importing it lets the app spot songs you already have. You can skip this and import later from Settings.</p>
      )}
    </div>
  );
}

export function ShortcutsSection({ settings, update }: { mode: Mode; settings: Settings; update: UpdateSettings }) {
  const sc = settings.onboarding.shortcuts;
  const set = (patch: Partial<typeof sc>) => update((s) => ({ onboarding: { ...s.onboarding, shortcuts: { ...s.onboarding.shortcuts, ...patch } } }));
  const rows: { key: keyof typeof sc; name: string; what: string }[] = [
    { key: 'addKept', name: 'Anisong Add Kept', what: 'Adds the songs you keep to your playlist.' },
    { key: 'exportPlaylist', name: 'Anisong Export Playlist', what: 'Copies your playlist so the app can re-sync it.' },
  ];
  return (
    <div className="set-section">
      <p className="set-lead">Adding songs to Apple Music goes through two shortcuts on your iPhone or Mac. You only need them at the end of a review.</p>
      {rows.map((r) => (
        <Field key={r.key} label={<code className="sc-name">{r.name}</code>} hint={r.what}>
          <label className="set-check"><input type="checkbox" checked={sc[r.key]} onChange={(e) => set({ [r.key]: e.target.checked })} /> Built</label>
          <a href={SHORTCUTS_GUIDE} target="_blank" rel="noopener noreferrer">How to build it ↗</a>
        </Field>
      ))}
    </div>
  );
}

export function PreferencesSection({ mode, settings, update }: { mode: Mode; settings: Settings; update: UpdateSettings }) {
  const known = STOREFRONTS.some(([c]) => c === settings.country);
  return (
    <div className="set-section">
      {mode === 'setup' && <p className="set-lead">The defaults are fine; you can change these any time.</p>}
      <Field label="Apple Music store" hint={mode === 'settings' ? 'Changing it re-runs matches in the next review.' : undefined}>
        <select value={settings.country} onChange={(e) => update({ country: e.target.value })} aria-label="Apple Music store">
          {!known && <option value={settings.country}>{settings.country.toUpperCase()}</option>}
          {STOREFRONTS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </Field>
      <Field label="Prefer">
        <label className="set-check"><input type="radio" name={`tv-${mode}`} checked={!settings.preferTvSize} onChange={() => update({ preferTvSize: false })} /> Full versions</label>
        <label className="set-check"><input type="radio" name={`tv-${mode}`} checked={settings.preferTvSize} onChange={() => update({ preferTvSize: true })} /> TV size</label>
      </Field>
      <Field label="Songs">
        <label className="set-check"><input type="checkbox" checked={settings.includeInserts} onChange={(e) => update({ includeInserts: e.target.checked })} /> Include insert songs</label>
      </Field>
      <Field label="Review">
        <label className="set-check"><input type="checkbox" checked={settings.autoplay} onChange={(e) => update({ autoplay: e.target.checked })} /> Autoplay each song</label>
      </Field>
    </div>
  );
}

export function DataSection({ settings, update, onRerunSetup }: { settings: Settings; update: UpdateSettings; onRerunSetup: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const run = (label: string, f: () => Promise<unknown>) => () => { void f().then(() => setMsg(`${label}: done.`), (e: Error) => setMsg(`${label} failed: ${e.message}`)); };
  return (
    <div className="set-section">
      <p className="set-lead">Everything is stored in this browser.</p>
      <Field label="Caches" hint="Safe: they refill on the next lookup.">
        <button className="btn-line" onClick={run('Song cache cleared', () => db.themeLookups.clear())}>Clear song cache</button>
        <button className="btn-line" onClick={run('Match cache cleared', () => db.matches.clear())}>Clear match cache</button>
      </Field>
      <Field label="Last show added" hint={settings.boundId ? undefined : 'Not set.'}>
        <button className="btn-line" disabled={!settings.boundId} onClick={() => { update({ boundId: null }); setMsg('Last show added forgotten.'); }}>Forget it</button>
      </Field>
      <Field label="Setup">
        <button className="btn-line" onClick={onRerunSetup}>Run setup again</button>
      </Field>
      {msg && <p className="set-hint" role="status">{msg}</p>}
    </div>
  );
}
