import { consumeTokenFromHash } from '../lib/anilist';
import { OAUTH_RETURN_KEY } from '../components/settings/sections';

/**
 * The AniList implicit grant returns to the site root with `#access_token=…`.
 * Read it once, at startup, before the router looks at the hash, and recover
 * the route the login started from.
 */
export const oauthToken: string | null = consumeTokenFromHash();
export const oauthReturn: string | null = (() => {
  if (!oauthToken) return null;
  try {
    const r = sessionStorage.getItem(OAUTH_RETURN_KEY);
    sessionStorage.removeItem(OAUTH_RETURN_KEY);
    return r;
  } catch { return null; }
})();
