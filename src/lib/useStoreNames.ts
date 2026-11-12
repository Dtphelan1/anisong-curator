import { useEffect, useState } from 'react';
import { db } from './db';
import type { StoreName } from './dedupe';
import { lookup } from './itunes';

const cacheKey = (store: string) => `storeNames:${store}`;

/**
 * Names of the given tracks in another storefront (default JP). Track ids
 * are global, but names are per storefront: the US store says "Yuusha",
 * while a playlist built from the JP store (or on a Japanese-language
 * account) shows 勇者. These are extra alt names for the duplicate check,
 * which matters when AnimeThemes has no native title for the song.
 *
 * One batched lookup per change (debounced, so keeping several songs in a
 * row costs one request); results are cached in IndexedDB for good.
 */
export function useStoreNames(trackIds: number[], country: string, store = 'jp'): Map<number, StoreName> {
  const [names, setNames] = useState<Map<number, StoreName>>(new Map());
  const idsKey = [...new Set(trackIds)].sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (country === store || !idsKey) return;
    let cancelled = false;
    const ids = idsKey.split(',').map(Number);
    const timer = setTimeout(async () => {
      try {
        const cached = ((await db.meta.get(cacheKey(store)))?.value ?? {}) as Record<number, StoreName>;
        const missing = ids.filter((id) => !(id in cached));
        if (missing.length) {
          const found = await lookup(missing, store);
          for (const id of missing) {
            const t = found.find((x) => x.trackId === id);
            cached[id] = t ? { title: t.trackName, artist: t.artistName } : null;
          }
          await db.meta.put({ key: cacheKey(store), value: cached });
        }
        if (!cancelled) setNames(new Map(ids.map((id) => [id, cached[id] ?? null])));
      } catch {
        // Best effort: the theme's names still apply. Retried on the next change.
      }
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [idsKey, country, store]);

  return names;
}
