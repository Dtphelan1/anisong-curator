import { useCallback, useEffect, useRef, useState } from 'react';
import type { Show, Theme } from '../types';
import { db, type Decision, type DecisionValue } from './db';
import type { ItunesTrack } from './itunes';
import type { MatchPrefs, ThemeContext } from './matcher';
import { manualResult, matchBySearch, matchLinked, themeKey, type MatchResult } from './matching';
import { displayTitle } from './anilist';

export interface ReviewItem {
  key: string;
  theme: Theme;
  show: Show;
  ctx: ThemeContext;
}

export type MatchStatus = 'queued' | 'matching' | 'done' | 'error';

export function animeTitles(show: Show): string[] {
  return [...new Set([show.title.english, show.title.romaji, show.title.native, displayTitle(show)].filter((x): x is string => !!x))];
}

/** One review item per distinct song, in candidate-show order. */
export function buildReviewItems(shows: Show[], themesFor: (s: Show) => Theme[]): ReviewItem[] {
  const seen = new Set<string>();
  const items: ReviewItem[] = [];
  for (const show of shows) for (const theme of themesFor(show)) {
    const key = themeKey(theme);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, theme, show, ctx: { theme, animeTitles: animeTitles(show) } });
  }
  return items;
}

/**
 * Background matcher. Uses cached matches, resolves AnimeThemes Apple Music
 * links in one batch, then searches the rest one at a time, always choosing
 * the next unmatched item at or after the one the user is looking at.
 * Keys in `later` (songs the playlist check already found) are searched
 * last: they go to the Already have pass, so the review's songs come first.
 */
export function useMatching(items: ReviewItem[], country: string, prefs: MatchPrefs, currentIndex: number, later?: { current: Set<string> }) {
  const [matches, setMatches] = useState<Map<string, MatchResult>>(new Map());
  const [status, setStatus] = useState<Map<string, MatchStatus>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const current = useRef(currentIndex);
  current.current = currentIndex;
  /** Keys the user has picked manually; background results must not overwrite them. */
  const pinned = useRef(new Set<string>());
  const prefsKey = JSON.stringify(prefs);

  const put = useCallback(async (r: MatchResult) => {
    setMatches((m) => new Map(m).set(r.key, r));
    setStatus((s) => new Map(s).set(r.key, 'done'));
    await db.matches.put(r);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const keys = items.map((i) => i.key);
    (async () => {
      const cached = await db.matches.bulkGet(keys);
      const have = new Map<string, MatchResult>();
      cached.forEach((r) => {
        if (r && r.country === country) { have.set(r.key, r); if (r.userPicked) pinned.current.add(r.key); }
      });
      if (cancelled) return;
      setMatches(have);
      setStatus(new Map(keys.map((k) => [k, have.has(k) ? 'done' : 'queued'])));

      // 1) Curated links: one batched lookup for all of them.
      const linked = items.filter((i) => !have.has(i.key) && i.theme.appleMusicUrl);
      if (linked.length) {
        try {
          const res = await matchLinked(linked.map((i) => i.ctx), country, prefs);
          for (const r of res.values()) {
            if (cancelled) return;
            have.set(r.key, r);
            if (!pinned.current.has(r.key)) await put(r);
          }
        } catch { /* fall through to search */ }
      }

      // 2) Search, nearest-to-current first.
      for (;;) {
        if (cancelled) return;
        const from = current.current;
        const open = [...items.slice(from), ...items.slice(0, from)].filter((i) => !have.has(i.key) && !pinned.current.has(i.key));
        const next = open.find((i) => !later?.current.has(i.key)) ?? open[0];
        if (!next) return;
        setStatus((s) => new Map(s).set(next.key, 'matching'));
        try {
          const r = await matchBySearch(next.ctx, country, prefs);
          if (cancelled) return;
          have.set(r.key, r);
          // The user may have picked a track while this search was in flight.
          if (!pinned.current.has(r.key)) await put(r);
        } catch (err) {
          if (cancelled) return;
          // Leave it uncached; mark so we don't spin on it this session.
          have.set(next.key, { key: next.key, country, candidates: [], chosenId: null, score: null, method: 'none', requests: 0, matchedAt: 0, userPicked: false });
          setStatus((s) => new Map(s).set(next.key, 'error'));
          setErrors((e) => new Map(e).set(next.key, (err as Error).message));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, country, prefsKey, put]);

  /** User picked a candidate, a pasted link, or a manual search result. */
  const choose = useCallback(async (item: ReviewItem, track: ItunesTrack) => {
    pinned.current.add(item.key);
    await put(manualResult(item.ctx, country, track, matches.get(item.key), prefs));
  }, [country, matches, prefs, put]);

  /** Drop the cached match and search again (e.g. after a country change). */
  const rematch = useCallback(async (item: ReviewItem) => {
    pinned.current.delete(item.key);
    setStatus((s) => new Map(s).set(item.key, 'matching'));
    try {
      await put(await matchBySearch(item.ctx, country, prefs));
    } catch (err) {
      setStatus((s) => new Map(s).set(item.key, 'error'));
      setErrors((e) => new Map(e).set(item.key, (err as Error).message));
    }
  }, [country, prefs, put]);

  return { matches, status, errors, choose, rematch };
}

export function useDecisions(keys: string[]) {
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  /** True once the stored decisions for `keys` have been read. */
  const [loaded, setLoaded] = useState(false);
  const keysKey = keys.join('|');
  useEffect(() => {
    let cancelled = false;
    db.decisions.bulkGet(keys).then((ds) => {
      if (cancelled) return;
      setDecisions(new Map(ds.filter((d): d is Decision => !!d).map((d) => [d.key, d])));
      setLoaded(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysKey]);

  const decide = useCallback(async (key: string, decision: DecisionValue | null, trackId: number | null, addAnyway = false) => {
    if (decision === null) {
      setDecisions((m) => { const n = new Map(m); n.delete(key); return n; });
      await db.decisions.delete(key);
      return;
    }
    const d: Decision = { key, decision, trackId, decidedAt: Date.now(), ...(addAnyway && decision === 'keep' ? { addAnyway: true } : {}) };
    setDecisions((m) => new Map(m).set(key, d));
    await db.decisions.put(d);
  }, []);

  /** The same skip or later decision for several songs at once ("Later: whole show", "Skip the rest"). */
  const decideMany = useCallback(async (keys: string[], decision: 'skip' | 'later') => {
    if (!keys.length) return;
    const now = Date.now();
    const ds: Decision[] = keys.map((key) => ({ key, decision, trackId: null, decidedAt: now }));
    setDecisions((m) => { const n = new Map(m); for (const d of ds) n.set(d.key, d); return n; });
    await db.decisions.bulkPut(ds);
  }, []);

  /** Set or clear "add anyway" on existing keep decisions (no-op for others). */
  const current = useRef(decisions);
  current.current = decisions;
  const setAddAnyway = useCallback(async (keys: string[], value: boolean) => {
    const updated: Decision[] = [];
    for (const key of keys) {
      const d = current.current.get(key);
      if (!d || d.decision !== 'keep' || !!d.addAnyway === value) continue;
      const { addAnyway: _old, ...rest } = d;
      updated.push(value ? { ...rest, addAnyway: true } : rest);
    }
    if (!updated.length) return;
    setDecisions((m) => { const n = new Map(m); for (const d of updated) n.set(d.key, d); return n; });
    await db.decisions.bulkPut(updated);
  }, []);

  return { decisions, loaded, decide, decideMany, setAddAnyway };
}
