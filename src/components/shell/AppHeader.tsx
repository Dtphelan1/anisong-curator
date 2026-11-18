import { useEffect, useRef, type ReactNode } from 'react';
import { ago } from '../settings/sections';

export interface Crumb { label: string; count?: number; current?: boolean; onClick?: () => void }

interface Props {
  onSettings: () => void;
  settingsOpen: boolean;
  crumbs?: Crumb[];
  account?: { user: string; loadedAt: number | null; loading: boolean; onRefresh: () => void; onOpen: () => void } | null;
  /** The playlist library's chip. */
  playlist?: ReactNode;
}

/** ⚙ · app name · session crumbs · AniList chip · playlist chip. */
export function AppHeader({ onSettings, settingsOpen, crumbs = [], account, playlist }: Props) {
  // Pages pin their own bars under the header: publish its height (it wraps on narrow screens).
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="app-header" ref={ref}>
      <button className={`gear ${settingsOpen ? 'on' : ''}`} onClick={onSettings} aria-label="Settings" aria-expanded={settingsOpen} title="Settings">⚙</button>
      <span className="brand">anisong-curator</span>
      {crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Session">
          {crumbs.map((c, i) => (
            <span key={c.label} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
              <button className={`crumb ${c.current ? 'on' : ''}`} disabled={!c.onClick || c.current} aria-current={c.current ? 'step' : undefined} onClick={c.onClick}>
                {c.label}{c.count !== undefined && <b> · {c.count}</b>}
              </button>
            </span>
          ))}
        </nav>
      )}
      <span className="spacer" />
      {account && (
        <span className="chip account-chip">
          <button className="chip-main" onClick={account.onOpen} title="AniList settings">
            <span className="avatar" aria-hidden="true">{account.user.slice(0, 1).toUpperCase()}</span>
            {account.user} <span className="muted">· {account.loading ? 'syncing…' : `synced ${ago(account.loadedAt)}`}</span>
          </button>
          <button className={`chip-icon ${account.loading ? 'spin' : ''}`} onClick={account.onRefresh} disabled={account.loading} aria-label="Refresh AniList list" title="Refresh your AniList list">↻</button>
        </span>
      )}
      {playlist}
    </header>
  );
}
