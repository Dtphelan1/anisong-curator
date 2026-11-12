import { useEffect, useState } from 'react';
import { DEFAULT_ORDER, type OrderOptions } from './ordering';

/**
 * Small per-browser preferences. localStorage is fine here: none of this
 * needs to survive a cleared browser, and IndexedDB holds the real data.
 */
export interface Settings {
  userName: string;
  clientId: string;
  token: string | null;
  order: OrderOptions;
  /** "Last show already in the playlist" (Mode 1 lower bound). */
  boundId: number | null;
  includeInserts: boolean;
  /** Apple Music storefront (ISO country code). */
  country: string;
  preferTvSize: boolean;
  autoplay: boolean;
  /** The running playlist kept songs go into (as named in Apple Music). */
  playlistName: string;
}

const KEY = 'anisong-curator.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  userName: '',
  clientId: '',
  token: null,
  order: DEFAULT_ORDER,
  boundId: null,
  includeInserts: false,
  country: 'us',
  preferTvSize: false,
  autoplay: true,
  playlistName: '🔥 AniSong MegaMix',
};

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, order: { ...DEFAULT_ORDER, ...parsed.order } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(read);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);
  return [settings, (patch) => setSettings((s) => ({ ...s, ...patch }))];
}
