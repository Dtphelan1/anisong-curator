import type { ReactNode } from 'react';
import { SETUP_STEPS, type Settings, type SetupStep, type StepState, type UpdateSettings } from '../lib/settings';
import type { useAniList } from '../lib/useAniList';
import { AniListSection, PlaylistSection, PreferencesSection, ShortcutsSection } from '../components/settings/sections';

/**
 * First visit only. Welcome says what the app does and what setup needs;
 * then four steps, each saved as you go, so a closed tab resumes.
 */
export function Welcome({ onStart, onSettings }: { onStart: () => void; onSettings: () => void }) {
  return (
    <main className="setup welcome">
      <h1>Keep your anisong playlist up to date</h1>
      <p className="setup-lead">
        Every so often, find the openings and endings of the anime you've finished, listen to each one,
        and add the keepers to your Apple Music playlist.
      </p>

      <h2 className="setup-kicker">How a session goes</h2>
      <ol className="welcome-steps">
        <li><b>Pick the anime</b><span>From your AniList list: by default, everything you've finished since the last show in your playlist.</span></li>
        <li><b>Review each song</b><span>The app finds every opening and ending on Apple Music. Hear the first seconds, then keep or skip. Songs you already have get their own quick pass.</span></li>
        <li><b>Add the keepers</b><span>One tap on your iPhone or Mac runs a shortcut that adds them to your playlist.</span></li>
      </ol>

      <h2 className="setup-kicker">Setup takes about 3 minutes</h2>
      <ul className="welcome-needs">
        <li><b>Your AniList username</b> <span className="muted">required</span></li>
        <li><b>Your playlist</b> <span className="muted">optional · lets the app spot songs you already have</span></li>
        <li><b>Two shortcuts</b> <span className="muted">optional now · only needed at the end of a review</span></li>
        <li><b>Preferences</b> <span className="muted">the defaults are fine</span></li>
      </ul>
      <p className="muted">Everything stays in this browser: there's no account and no server.</p>

      <div className="setup-actions">
        <button className="btn-accent big" onClick={onStart} autoFocus>Get started →</button>
        <button className="btn-link" onClick={onSettings}>Settings</button>
      </div>
    </main>
  );
}

const TITLES: Record<SetupStep, { title: string; lead?: string; skippable: boolean }> = {
  anilist: { title: 'Where’s your anime list?', lead: 'The app reads your AniList list to know what you’ve finished, and in what order.', skippable: false },
  playlist: { title: 'Which playlist do kept songs go into?', skippable: true },
  shortcuts: { title: 'Two shortcuts for Apple Music', skippable: true },
  prefs: { title: 'Preferences', skippable: true },
};

interface StepProps {
  step: SetupStep;
  settings: Settings;
  update: UpdateSettings;
  anilist: ReturnType<typeof useAniList>;
  /** The playlist library's import (setup variant). */
  playlistSlot?: ReactNode;
  /** Mark this step and move on (or back). */
  onStep: (state: StepState) => void;
  onBack: () => void;
  /** The step's own component has Continue / Skip (the playlist import does). */
  ownActions?: boolean;
}

export function SetupStepPage({ step, settings, update, anilist, playlistSlot, onStep, onBack, ownActions = false }: StepProps) {
  const i = SETUP_STEPS.indexOf(step);
  const t = TITLES[step];
  const last = i === SETUP_STEPS.length - 1;
  const canContinue = step !== 'anilist' || (anilist.shows.length > 0 && anilist.user === settings.userName.trim());
  const body: Record<SetupStep, ReactNode> = {
    anilist: <AniListSection mode="setup" settings={settings} update={update} anilist={anilist} />,
    playlist: <PlaylistSection mode="setup" settings={settings} update={update}>{playlistSlot}</PlaylistSection>,
    shortcuts: <ShortcutsSection mode="setup" settings={settings} update={update} />,
    prefs: <PreferencesSection mode="setup" settings={settings} update={update} />,
  };

  return (
    <main className="setup">
      <div className="setup-dots" aria-label={`Step ${i + 1} of ${SETUP_STEPS.length}`}>
        {SETUP_STEPS.map((s, j) => (
          <span key={s} className={`dot ${j === i ? 'on' : ''} ${settings.onboarding.steps[s] ? 'done' : ''}`} />
        ))}
        <span className="muted">Step {i + 1} of {SETUP_STEPS.length}{t.skippable && ' · optional'}</span>
      </div>
      <h1>{t.title}</h1>
      {t.lead && <p className="setup-lead">{t.lead}</p>}
      {body[step]}
      <div className="setup-actions">
        <button className="btn-line" onClick={onBack}>← Back</button>
        <span className="spacer" />
        {!ownActions && t.skippable && <button className="btn-link" onClick={() => onStep('skipped')}>Skip for now</button>}
        {!ownActions && (
          <button className="btn-accent" disabled={!canContinue} onClick={() => onStep('done')}>
            {last ? 'Pick your first anime →' : 'Continue →'}
          </button>
        )}
      </div>
    </main>
  );
}
