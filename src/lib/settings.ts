import { useEffect, useState } from 'react';
import { DEFAULT_ORDER, type OrderOptions } from './ordering';
import { DEFAULT_SELECTION, type Selection } from './selection';

/**
 * Small per-browser preferences. localStorage is fine here: none of this
 * needs to survive a cleared browser, and IndexedDB holds the real data.
 */
export interface Settings {
  userName: string;
  clientId: string;
  token: string | null;
  order: OrderOptions;
  /** "Last show already in the playlist": the default selection is everything newer. */
  boundId: number | null;
  /** Which shows to look up songs for: a base plus per-show additions/removals. */
  selection: Selection;
  includeInserts: boolean;
  /** Apple Music storefront (ISO country code). */
  country: string;
  preferTvSize: boolean;
  autoplay: boolean;
  /** The running playlist kept songs go into (as named in Apple Music). */
  playlistName: string;
  /** Bumped when a default changes for existing users (2: newest-first sort). */
  defaultsVersion?: number;
}

const KEY = 'anisong-curator.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  userName: '',
  clientId: '',
  token: null,
  order: DEFAULT_ORDER,
  boundId: null,
  selection: DEFAULT_SELECTION,
  includeInserts: false,
  country: 'us',
  preferTvSize: false,
  autoplay: true,
  playlistName: '🔥 AniSong MegaMix',
  defaultsVersion: 2,
};

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...DEFAULT_SETTINGS, ...parsed, order: { ...DEFAULT_ORDER, ...parsed.order }, selection: { ...DEFAULT_SELECTION, ...parsed.selection } };
    // One-time migration: the default sort became newest-first. Settings saved
    // under the old default switch once; a later explicit choice sticks.
    if ((parsed.defaultsVersion ?? 1) < 2) merged.order = { ...merged.order, direction: 'desc' };
    merged.defaultsVersion = 2;
    return merged;
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
