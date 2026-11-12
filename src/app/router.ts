import { useCallback, useEffect, useState } from 'react';
import type { SetupStep } from '../lib/settings';

/**
 * A tiny hash router: `#/welcome`, `#/setup/<step>`, `#/anime`, `#/review`,
 * `#/playlist`, plus `?settings=<section>` for the Settings panel over any
 * page. Browser Back works; a reload lands where you were.
 */
export type SettingsSection = 'anilist' | 'playlist' | 'shortcuts' | 'prefs' | 'data';
export const SETTINGS_SECTIONS: SettingsSection[] = ['anilist', 'playlist', 'shortcuts', 'prefs', 'data'];

export type Page =
  | { name: 'welcome' }
  | { name: 'setup'; step: SetupStep }
  | { name: 'anime' }
  | { name: 'review' }
  | { name: 'playlist' };

export interface Route {
  page: Page;
  /** The Settings panel, open on this section; null when closed. */
  settings: SettingsSection | null;
}

const STEPS: SetupStep[] = ['anilist', 'playlist', 'shortcuts', 'prefs'];

export function parseHash(hash: string): Route | null {
  const m = hash.replace(/^#/, '').match(/^\/?([^?]*)(?:\?(.*))?$/);
  if (!m) return null;
  const [path = '', query = ''] = [m[1], m[2]];
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  const s = q.get('settings');
  const settings = s === null ? null : (SETTINGS_SECTIONS as string[]).includes(s) ? (s as SettingsSection) : 'anilist';
  const [head, sub] = parts;
  let page: Page | null = null;
  if (head === 'welcome') page = { name: 'welcome' };
  else if (head === 'setup') page = { name: 'setup', step: (STEPS as string[]).includes(sub ?? '') ? (sub as SetupStep) : 'anilist' };
  else if (head === 'anime' || head === 'review' || head === 'playlist') page = { name: head };
  if (!page) return null;
  return { page, settings };
}

export function formatRoute({ page, settings }: Route): string {
  const path = page.name === 'setup' ? `/setup/${page.step}` : `/${page.name}`;
  return `#${path}${settings ? `?settings=${settings}` : ''}`;
}

export function samePage(a: Page, b: Page): boolean {
  return a.name === b.name && (a.name !== 'setup' || a.step === (b as typeof a).step);
}

export type Navigate = (to: Partial<Route>, opts?: { replace?: boolean }) => void;

/**
 * The current route, and navigate(). `fallback` decides where an empty or
 * unknown hash goes (and is also how first-run setup redirects).
 */
export function useRoute(fallback: () => Route): [Route, Navigate] {
  const read = useCallback(() => parseHash(location.hash) ?? fallback(), [fallback]);
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [read]);

  // Make the URL say where we are (e.g. after a fallback).
  useEffect(() => {
    const want = formatRoute(route);
    if (location.hash !== want) history.replaceState(null, '', want);
  }, [route]);

  const navigate: Navigate = useCallback((to, { replace = false } = {}) => {
    setRoute((cur) => {
      const next = { page: to.page ?? cur.page, settings: to.settings === undefined ? cur.settings : to.settings };
      const hash = formatRoute(next);
      if (location.hash !== hash) {
        if (replace) history.replaceState(null, '', hash);
        else history.pushState(null, '', hash);
      }
      return next;
    });
  }, []);

  return [route, navigate];
}
