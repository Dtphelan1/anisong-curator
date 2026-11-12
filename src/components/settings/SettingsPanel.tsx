import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { SettingsSection } from '../../app/router';
import { SETTINGS_SECTIONS } from '../../app/router';
import type { Settings, UpdateSettings } from '../../lib/settings';
import type { useAniList } from '../../lib/useAniList';
import { AniListSection, DataSection, PlaylistSection, PreferencesSection, ShortcutsSection } from './sections';

export const SECTION_LABEL: Record<SettingsSection, string> = {
  anilist: 'AniList', playlist: 'Playlist', shortcuts: 'Shortcuts', prefs: 'Preferences', data: 'Data',
};

interface Props {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  settings: Settings;
  update: UpdateSettings;
  anilist: ReturnType<typeof useAniList>;
  /** The playlist library's status and import, rendered inside the Playlist section. */
  playlistSlot?: ReactNode;
  onRerunSetup: () => void;
}

/**
 * Settings: a panel that slides in from the left, under the ⚙ button, over
 * whatever page you're on, so opening it mid-review doesn't lose your place.
 * All sections are on one scrolling column; the nav jumps between them.
 */
export function SettingsPanel(p: Props) {
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    body.current?.querySelector(`#set-${p.section}`)?.scrollIntoView({ block: 'start' });
  }, [p.section]);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections: Record<SettingsSection, ReactNode> = {
    anilist: <AniListSection mode="settings" settings={p.settings} update={p.update} anilist={p.anilist} />,
    playlist: <PlaylistSection mode="settings" settings={p.settings} update={p.update}>{p.playlistSlot}</PlaylistSection>,
    shortcuts: <ShortcutsSection mode="settings" settings={p.settings} update={p.update} />,
    prefs: <PreferencesSection mode="settings" settings={p.settings} update={p.update} />,
    data: <DataSection settings={p.settings} update={p.update} onRerunSetup={p.onRerunSetup} />,
  };

  return (
    <div className="set-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <aside className="set-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Settings">
        <div className="set-top">
          <h2>Settings</h2>
          <button className="btn-line set-close" onClick={p.onClose} aria-label="Close settings" title="Close (Esc)">✕</button>
        </div>
        <div className="set-cols">
          <nav className="set-nav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((s) => (
              <button key={s} className={s === p.section ? 'on' : ''} aria-current={s === p.section ? 'true' : undefined} onClick={() => p.onSection(s)}>
                {SECTION_LABEL[s]}
              </button>
            ))}
          </nav>
          <div className="set-body" ref={body}>
            {SETTINGS_SECTIONS.map((s) => (
              <section key={s} id={`set-${s}`} className="set-card">
                <h3>{SECTION_LABEL[s]}</h3>
                {sections[s]}
              </section>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
