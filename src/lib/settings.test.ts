import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isSetupComplete, migrate, nextSetupStep } from './settings';

describe('settings migrate', () => {
  it('first visit: defaults, setup not started', () => {
    const s = migrate(null);
    expect(s.onboarding.completedAt).toBeNull();
    expect(nextSetupStep(s.onboarding)).toBe('anilist');
  });

  it('an existing user with a loaded list skips setup and gets the "moved" note', () => {
    const s = migrate({ userName: 'someone', defaultsVersion: 2 }, true);
    expect(isSetupComplete(s.onboarding)).toBe(true);
    expect(s.notices.settingsMoved).toBe(false);
    expect(s.defaultsVersion).toBe(3);
  });

  it('a username without a cached list still goes through setup', () => {
    const s = migrate({ userName: 'someone', defaultsVersion: 2 }, false);
    expect(isSetupComplete(s.onboarding)).toBe(false);
  });

  it('keeps v1 → v2 sort migration and saved values', () => {
    const s = migrate({ order: { ...DEFAULT_SETTINGS.order, direction: 'asc' }, country: 'jp' });
    expect(s.order.direction).toBe('desc');
    expect(s.country).toBe('jp');
    expect(migrate({ order: { ...DEFAULT_SETTINGS.order, direction: 'asc' }, defaultsVersion: 3 }).order.direction).toBe('asc');
  });

  it('setup is complete only with AniList done and every step settled', () => {
    expect(isSetupComplete({ ...DEFAULT_SETTINGS.onboarding, steps: { anilist: 'done', playlist: 'skipped', shortcuts: 'skipped' } })).toBe(false);
    expect(isSetupComplete({ ...DEFAULT_SETTINGS.onboarding, steps: { anilist: 'done', playlist: 'skipped', shortcuts: 'skipped', prefs: 'done' } })).toBe(true);
    expect(nextSetupStep({ ...DEFAULT_SETTINGS.onboarding, steps: { anilist: 'done' } })).toBe('playlist');
  });
});

import { newlyCompleted } from './useAniList';
import type { Show } from '../types';
describe('newlyCompleted', () => {
  const s = (id: number, status: Show['status']) => ({ anilistId: id, status }) as Show;
  it('counts shows that became Completed since the last load', () => {
    expect(newlyCompleted([s(1, 'COMPLETED'), s(2, 'CURRENT')], [s(1, 'COMPLETED'), s(2, 'COMPLETED'), s(3, 'COMPLETED')])).toBe(2);
    expect(newlyCompleted([], [s(1, 'COMPLETED')])).toBe(0);
  });
});
