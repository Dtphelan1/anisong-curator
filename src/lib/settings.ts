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
  /** Which extra list statuses the anime page lists (never pre-selected). */
  listStatuses: { dropped: boolean; paused: boolean };
  /** First-run setup. `completedAt` null = setup not finished (or not started). */
  onboarding: Onboarding;
  /** One-time notices already dismissed, by id. */
  notices: Record<string, boolean>;
  /** Bumped when a default changes for existing users (2: newest-first sort; 3: onboarding). */
  defaultsVersion?: number;
}

export type SetupStep = 'anilist' | 'playlist' | 'shortcuts' | 'prefs';
export const SETUP_STEPS: SetupStep[] = ['anilist', 'playlist', 'shortcuts', 'prefs'];
export type StepState = 'done' | 'skipped';

export interface Onboarding {
  /** null until the user presses "Get started" on the welcome screen. */
  startedAt: number | null;
  steps: Partial<Record<SetupStep, StepState>>;
  completedAt: number | null;
  /** Your own checklist for the two shortcuts (not verified). */
  shortcuts: { addKept: boolean; exportPlaylist: boolean };
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
  listStatuses: { dropped: true, paused: false },
  onboarding: { startedAt: null, steps: {}, completedAt: null, shortcuts: { addKept: false, exportPlaylist: false } },
  notices: {},
  defaultsVersion: 3,
};

/** Setup is finished when AniList is done and every other step is done or skipped. */
export function isSetupComplete(o: Onboarding): boolean {
  return o.steps.anilist === 'done' && SETUP_STEPS.every((s) => !!o.steps[s]);
}

/** The first step still to do, or null when setup is complete. */
export function nextSetupStep(o: Onboarding): SetupStep | null {
  return SETUP_STEPS.find((s) => !o.steps[s]) ?? (o.steps.anilist === 'done' ? null : 'anilist');
}

/**
 * Settings as stored → current shape. Pure, for tests. `hasCachedList` says
 * whether this browser already holds an AniList list: someone who used the
 * app before setup existed is treated as set up and never sees it.
 */
export function migrate(raw: Partial<Settings> | null, hasCachedList = false): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  const merged: Settings = {
    ...DEFAULT_SETTINGS, ...raw,
    order: { ...DEFAULT_ORDER, ...raw.order },
    selection: { ...DEFAULT_SELECTION, ...raw.selection },
    listStatuses: { ...DEFAULT_SETTINGS.listStatuses, ...raw.listStatuses },
    onboarding: { ...DEFAULT_SETTINGS.onboarding, ...raw.onboarding, shortcuts: { ...DEFAULT_SETTINGS.onboarding.shortcuts, ...raw.onboarding?.shortcuts } },
    notices: { ...raw.notices },
  };
  const version = raw.defaultsVersion ?? 1;
  // 2: the default sort became newest-first. Settings saved under the old
  // default switch once; a later explicit choice sticks.
  if (version < 2) merged.order = { ...merged.order, direction: 'desc' };
  // 3: first-run setup. Existing users with a loaded list skip it, and get a
  // one-time note that the account and preferences moved to Settings.
  if (version < 3 && raw.userName?.trim() && hasCachedList) {
    const now = Date.now();
    merged.onboarding = { ...merged.onboarding, startedAt: now, completedAt: now, steps: { anilist: 'done', playlist: 'done', shortcuts: 'done', prefs: 'done' } };
    merged.notices = { ...merged.notices, settingsMoved: false };
  }
  merged.defaultsVersion = 3;
  return merged;
}

/** Did a previous version leave an AniList list in IndexedDB? Checked synchronously via a localStorage hint, see App. */
export const LIST_HINT_KEY = 'anisong-curator.hasList';

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const hasList = localStorage.getItem(LIST_HINT_KEY) === '1' || localStorage.getItem('anisong-curator.step') !== null;
    return migrate(raw ? (JSON.parse(raw) as Partial<Settings>) : null, hasList);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type UpdateSettings = (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;

export function useSettings(): [Settings, UpdateSettings] {
  const [settings, setSettings] = useState<Settings>(read);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);
  return [settings, (patch) => setSettings((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))];
}
