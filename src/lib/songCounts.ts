import type { ThemeLookup } from '../types';
import { db } from './db';
import { songCount } from './pickerRows';

/**
 * Song counts per show from cached theme lookups only (no network), for the
 * anime page's ♪ column and its "~N songs" estimate. A show missing from the
 * map hasn't been looked up yet; 'none' is a cached "no songs".
 */
export async function cachedSongCounts(ids: number[], includeInserts: boolean): Promise<Map<number, number | 'none'>> {
  const found = (await db.themeLookups.bulkGet(ids)) as (ThemeLookup | undefined)[];
  const out = new Map<number, number | 'none'>();
  for (const l of found) {
    if (!l) continue;
    const n = songCount(l, includeInserts);
    out.set(l.anilistId, n || 'none');
  }
  return out;
}
