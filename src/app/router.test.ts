import { describe, expect, it } from 'vitest';
import { formatRoute, parseHash } from './router';

describe('router', () => {
  it.each([
    ['#/anime', { page: { name: 'anime' }, settings: null }],
    ['#/review?settings=prefs', { page: { name: 'review' }, settings: 'prefs' }],
    ['#/setup/shortcuts', { page: { name: 'setup', step: 'shortcuts' }, settings: null }],
    ['#/setup/nope', { page: { name: 'setup', step: 'anilist' }, settings: null }],
    ['#/welcome?settings=bogus', { page: { name: 'welcome' }, settings: 'anilist' }],
  ])('parses %s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
    expect(parseHash(formatRoute(parseHash(hash)!))).toEqual(route);
  });

  it('returns null for empty, unknown, and OAuth hashes', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('#/songs')).toBeNull();
    expect(parseHash('#access_token=abc&token_type=Bearer')).toBeNull();
  });
});
