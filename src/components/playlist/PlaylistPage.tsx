import { useEffect, useMemo, useRef, useState } from 'react';
import type { Show, Theme, ThemeLookup } from '../../types';
import { displayTitle } from '../../lib/anilist';
import { normalize } from '../../lib/matcher';
import { themeKey } from '../../lib/matching';
import { watchKey, type LinkHit, type PlaylistItem } from '../../lib/playlistLibrary';
import { themeLabel } from '../../lib/themeLabel';
import { hitLabel, slugLabel, usePlaylistLibrary, useThemeLookups } from '../../lib/usePlaylistLibrary';
import { isTyping, mmss, ShowCover } from '../review/common';
import { addsState } from './PlaylistChip';
import './playlist.css';

export type PlaylistFilter = 'all' | 'show' | 'unlinked' | 'unseen';

interface Props {
  /** The AniList list (names the linked shows, and feeds the link picker). */
  shows: Show[];
  onBack: () => void;
  /** Open the import (Re-sync…). Hidden when absent. */
  onResync?: () => void;
  /** Start a review of a show's missing songs. Hidden when absent. */
  onReviewShow?: (anilistId: number) => void;
  initialFilter?: PlaylistFilter;
}

const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const fmtMonth = (s: Show) => (s.completedAt.year ? new Date(s.completedAt.year, (s.completedAt.month ?? 1) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '');

/** A theme to link to: show + theme, for the picker and ghost rows. */
interface ThemeEntry { show: Show; theme: Theme; key: string }

/**
 * "Your playlist": every song in playlist order with what it's linked to,
 * by show (with each show's missing openings/endings as ghost rows), the
 * unlinked ones, and adds not seen in a sync. Fix a link on the right.
 */
export function PlaylistPage({ shows, onBack, onResync, onReviewShow, initialFilter = 'all' }: Props) {
  const { status, items, lib } = usePlaylistLibrary();
  const lookups = useThemeLookups();
  const [filter, setFilter] = useState<PlaylistFilter>(initialFilter);
  const [query, setQuery] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const showsById = useMemo(() => new Map(shows.map((s) => [s.anilistId, s])), [shows]);
  const syncedAt = status?.syncedAt ?? null;
  const { unseen, since } = useMemo(() => addsState(items, syncedAt), [items, syncedAt]);
  const unseenIds = useMemo(() => new Set(unseen.map((i) => i.id)), [unseen]);
  const unlinked = useMemo(() => items.filter((i) => i.link?.state !== 'linked'), [items]);

  const matchesQuery = useMemo(() => {
    const q = normalize(query);
    if (!q) return () => true;
    return (it: PlaylistItem) => {
      const shown = it.anilistIds.map((id) => showsById.get(id)).filter(Boolean).map((s) => displayTitle(s!));
      return normalize([it.title, it.artist, it.album, ...shown].join(' ')).includes(q);
    };
  }, [query, showsById]);

  // Rows in the visible order (the J/K order).
  const listed = useMemo(() => {
    const base = filter === 'unlinked' ? unlinked : filter === 'unseen' ? unseen : items;
    return base.filter(matchesQuery);
  }, [filter, items, unlinked, unseen, matchesQuery]);

  // By show: shows with a linked song, newest watched first.
  const groups = useMemo(() => {
    if (filter !== 'show') return [];
    const by = new Map<number, PlaylistItem[]>();
    for (const it of items) {
      if (it.link?.state !== 'linked' || !matchesQuery(it)) continue;
      for (const id of it.anilistIds) if (showsById.has(id)) by.set(id, [...(by.get(id) ?? []), it]);
    }
    return [...by.entries()]
      .map(([id, rows]) => {
        const show = showsById.get(id)!;
        const themes = (lookups.get(id)?.themes ?? []).filter((t) => t.kind !== 'IN');
        const linkedKeys = new Set(rows.flatMap((r) => (r.link?.state === 'linked' ? r.link.hits.filter((h) => h.anilistId === id).map((h) => h.themeKey) : [])));
        const linkedSlugs = new Set(rows.flatMap((r) => (r.link?.state === 'linked' ? r.link.hits.filter((h) => h.anilistId === id).map((h) => h.slug) : [])));
        const missing = themes.filter((t) => !linkedKeys.has(themeKey(t)) && !linkedSlugs.has(t.slug));
        return { show, rows, themes, missing };
      })
      .sort((a, b) => watchKey(b.show) - watchKey(a.show));
  }, [filter, items, matchesQuery, showsById, lookups]);

  const order = useMemo(() => (filter === 'show' ? groups.flatMap((g) => (collapsed.has(g.show.anilistId) ? [] : g.rows.map((r) => `${g.show.anilistId}|${r.id}`))) : listed.map((r) => r.id)), [filter, groups, collapsed, listed]);
  const curRowKey = currentId && order.find((k) => k === currentId || k.endsWith(`|${currentId}`));
  const current = items.find((i) => i.id === (currentId?.includes('|') ? currentId.split('|')[1] : currentId)) ?? null;

  useEffect(() => { if (!currentId && order.length) setCurrentId(order[0]!); }, [order, currentId]);

  // Keys: J/K (and arrows) move, L links to the nearest guess, / searches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e)) {
        if (e.key === 'Escape') { (e.target as HTMLElement).blur(); e.preventDefault(); }
        return;
      }
      const i = curRowKey ? order.indexOf(curRowKey) : -1;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); const k = order[Math.min(order.length - 1, i + 1)]; if (k) setCurrentId(k); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); const k = order[Math.max(0, i - 1)]; if (k) setCurrentId(k); }
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if ((e.key === 'l' || e.key === 'L') && current?.link?.state === 'unlinked' && current.link.nearest) {
        e.preventDefault();
        const { confidence: _c, ...hit } = current.link.nearest;
        void lib.setLink(current.id, hit);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, curRowKey, current, lib]);

  // Keep the current row in view.
  useEffect(() => {
    const el = rowsRef.current?.querySelector('.is-current');
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [curRowKey]);

  const allThemes = useMemo(() => themeEntries(shows, lookups), [shows, lookups]);
  const linkedShows = new Set(items.flatMap((i) => i.anilistIds)).size;
  const missingTotal = groups.reduce((n, g) => n + g.missing.length, 0);
  const appRows = listed.filter((i) => i.origin === 'app');
  const importRows = listed.filter((i) => i.origin === 'import');
  const name = status?.name || 'Your playlist';

  const rowCells = (it: PlaylistItem) => (
    <>
      <td className="pl-pos">{it.position + 1}</td>
      <td><span>{it.title}</span><span className="pl-sub">{it.artist}</span></td>
      <td><LinkCell it={it} showsById={showsById} unseen={unseenIds.has(it.id)} syncedAt={syncedAt} /></td>
      <td className="pl-time">{mmss(it.durationMs)}</td>
    </>
  );

  return (
    <div className="pl-page">
      <div className="pl-head">
        <div>
          <button className="link small" onClick={onBack}>← Back</button>
          <h1>{name}</h1>
          <p className="small">
            {filter === 'show'
              ? <><b>{groups.length}</b> shows with songs in your playlist · newest watched first{missingTotal > 0 && <> · <b>{missingTotal}</b> openings and endings you don't have yet</>}</>
              : <><b>{items.length}</b> songs{status?.syncedAt && <> · {items.length - items.filter((i) => i.origin === 'app').length} from the {fmtDate(status.syncedAt)} sync ({status.lastImport?.orderIsPlaylist ? 'in playlist order' : 'in import order'})</>}{since.length > 0 && <> + {since.length} added since</>}{unseen.length > 0 && <> + {unseen.length} added, not seen</>} · <b>{status?.linked ?? 0}</b> linked to {linkedShows} shows</>}
          </p>
        </div>
        {onResync && <button className="btn-line" onClick={onResync}>Re-sync…</button>}
      </div>

      <div className="pl-toolbar">
        {([['all', `All ${items.length}`], ['show', 'By show'], ['unlinked', `Unlinked ${unlinked.length}`], ['unseen', `Added, not seen ${unseen.length}`]] as [PlaylistFilter, string][]).map(([f, label]) => (
          (f !== 'unseen' || unseen.length > 0 || filter === 'unseen') && (
            <button key={f} className={`pl-filter${f === 'unseen' ? ' tone-warn' : ''}`} aria-pressed={filter === f} onClick={() => { setFilter(f); setCurrentId(null); }}>{label}</button>
          )
        ))}
        {filter === 'show' && <label className="pl-toggle"><input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} /> Show missing songs</label>}
        <div className="pl-search">
          <input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setCurrentId(null); }} placeholder="Search title, artist, album or show" aria-label="Search the playlist" />
          <kbd>/</kbd>
        </div>
      </div>

      <div className="pl-split">
        <div className="pl-rows" ref={rowsRef}>
          {!items.length ? (
            <p className="muted" style={{ padding: 16 }}>No playlist yet. {onResync ? 'Import it with Re-sync.' : ''}</p>
          ) : filter === 'show' ? (
            <table className="pl-table">
              <tbody>
                {groups.map((g) => {
                  const id = g.show.anilistId;
                  const open = !collapsed.has(id);
                  const songs = new Set(g.rows.map((r) => r.id)).size;
                  return [
                    <tr key={`h${id}`} className="pl-group-head">
                      <td colSpan={3}>
                        <span className="pl-gtitle">
                          <button className="pl-caret" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setCollapsed((c) => { const n = new Set(c); if (open) n.add(id); else n.delete(id); return n; })}>{open ? '▾' : '▸'}</button>
                          <ShowCover show={g.show} size="sm" />
                          <b>{displayTitle(g.show)}</b>
                          {fmtMonth(g.show) && <span className="muted small">finished {fmtMonth(g.show)}</span>}
                          {onReviewShow && g.missing.length > 0 && <button className="btn-line btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onReviewShow(id)}>Review the {g.missing.length} missing →</button>}
                        </span>
                      </td>
                      <td className="pl-count">{songs} / {g.themes.length || '?'}</td>
                    </tr>,
                    ...(open ? g.rows.map((r) => {
                      const hit = r.link?.state === 'linked' ? r.link.hits.find((h) => h.anilistId === id) : undefined;
                      const k = `${id}|${r.id}`;
                      return (
                        <tr key={k} className={`pl-row${k === curRowKey ? ' is-current' : ''}`} onClick={() => setCurrentId(k)}>
                          <td className="pl-pos"><span className="pl-mark" aria-hidden="true" />{hit?.slug ?? ''}</td>
                          <td colSpan={2}>{r.title} <span className="muted">· {r.artist}</span></td>
                          <td className="pl-time">{unseenIds.has(r.id) ? <span className="warn">#{r.position + 1} · not in the {fmtDate(syncedAt)} sync</span> : `#${r.position + 1}`}</td>
                        </tr>
                      );
                    }) : []),
                    ...(open && showMissing ? g.missing.map((t) => (
                      <tr key={`m${id}${t.slug}`} className="pl-ghost">
                        <td className="pl-pos"><span className="pl-mark ghost" aria-hidden="true" />{t.slug}</td>
                        <td colSpan={2}>{t.songTitle ?? 'Unknown title'} <span className="muted">· {t.artists.join(', ')}</span></td>
                        <td className="pl-time">not in playlist</td>
                      </tr>
                    )) : []),
                  ];
                })}
              </tbody>
            </table>
          ) : (
            <table className="pl-table">
              <thead><tr><th>#</th><th>Song</th><th>Linked to</th><th className="pl-time">Time</th></tr></thead>
              <tbody>
                {importRows.map((it) => <tr key={it.id} className={`pl-row${it.id === curRowKey ? ' is-current' : ''}`} onClick={() => setCurrentId(it.id)}>{rowCells(it)}</tr>)}
                {appRows.length > 0 && <tr className="pl-section"><td colSpan={4}>Added with “Yes, mark as added”{syncedAt ? ', after the sync' : ''}</td></tr>}
                {appRows.map((it) => <tr key={it.id} className={`pl-row${it.id === curRowKey ? ' is-current' : ''}`} onClick={() => setCurrentId(it.id)}>{rowCells(it)}</tr>)}
                {!listed.length && <tr><td colSpan={4} className="muted">{query ? 'Nothing matches.' : filter === 'unlinked' ? 'Every song is linked.' : 'Nothing here.'}</td></tr>}
              </tbody>
            </table>
          )}
          <div className="pl-foot">{filter === 'show' ? <><span className="pl-mark" aria-hidden="true" />in your playlist · <span className="pl-mark ghost" aria-hidden="true" />not in your playlist · J / K to move · / to search</> : 'J / K to move · L to link to the nearest guess · / to search'}</div>
        </div>

        <aside className="pl-detail" aria-label="Song">
          {current
            ? <Detail it={current} showsById={showsById} allThemes={allThemes} lookups={lookups} syncedAt={syncedAt} unseen={unseenIds.has(current.id)}
                onLink={(hit) => lib.setLink(current.id, hit)} />
            : <p className="muted">Pick a song.</p>}
        </aside>
      </div>
    </div>
  );
}

function LinkCell({ it, showsById, unseen, syncedAt }: { it: PlaylistItem; showsById: Map<number, Show>; unseen: boolean; syncedAt: number | null }) {
  const l = it.link;
  const sub = it.origin === 'app'
    ? <span className={`pl-sub${unseen ? ' warn' : ''}`}>added {fmtDate(it.addedAt)}{unseen && ` · not in the ${fmtDate(syncedAt)} sync`}</span>
    : null;
  if (!l) return <><span className="muted">…</span>{sub}</>;
  if (l.state === 'linked') return <><span>{l.hits.map((h) => hitLabel(h, showsById)).join(' / ')}</span>{sub}</>;
  const n = l.nearest;
  return (
    <>
      <span className="muted">—</span>
      {n ? <span className="pl-sub">nearest: {hitLabel(n, showsById)} · {Math.round(n.confidence * 100)}%</span> : sub}
    </>
  );
}

const VIA: Record<string, string> = {
  'add-log': 'Added by the app from your review',
  exact: 'Same track as a match you reviewed',
  fuzzy: 'Matched by name: title and artist (or the show) agree',
  manual: 'Linked by you',
};

function Detail({ it, showsById, allThemes, lookups, syncedAt, unseen, onLink }: {
  it: PlaylistItem; showsById: Map<number, Show>; allThemes: ThemeEntry[]; lookups: Map<number, ThemeLookup>;
  syncedAt: number | null; unseen: boolean; onLink: (hit: LinkHit | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { setPicking(false); setQ(''); }, [it.id]);
  const l = it.link;
  const linked = l?.state === 'linked' ? l : null;
  const nearest = l?.state === 'unlinked' ? l.nearest : null;
  const hit = linked?.hits[0];
  const hitShow = hit?.anilistId != null ? showsById.get(hit.anilistId) : undefined;
  const hitTheme = hit && hit.anilistId != null ? lookups.get(hit.anilistId)?.themes.find((t) => t.slug === hit.slug) : undefined;
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${it.title} ${it.artist}`)}`;
  const origin = it.origin === 'app'
    ? `#${it.position + 1} · added by the app ${fmtDate(it.addedAt)}${unseen ? ` · not in the ${fmtDate(syncedAt)} sync` : ''}`
    : `#${it.position + 1}${syncedAt ? ` · from the ${fmtDate(syncedAt)} sync` : ''}`;

  const results = useMemo(() => {
    const nq = normalize(q);
    const pool = !nq && nearest?.anilistId != null ? allThemes.filter((e) => e.show.anilistId === nearest.anilistId) : allThemes;
    if (!nq) return pool.slice(0, 8);
    return pool.filter((e) => normalize(`${displayTitle(e.show)} ${e.theme.songTitle ?? ''} ${e.theme.artists.join(' ')}`).includes(nq)).slice(0, 30);
  }, [q, allThemes, nearest]);

  return (
    <>
      <div>
        <span className="muted small">{origin}</span>
        <h2>{it.title}</h2>
        <div>{it.artist}</div>
        <div className="muted small">{[it.album, mmss(it.durationMs)].filter(Boolean).join(' · ')}</div>
      </div>

      <div className="pl-linkbox">
        <div className="pl-linkstate">Link <span className={`pill ${linked ? 'tone-have' : 'tone-neutral'}`}>{linked ? 'Linked' : l ? 'Not linked' : 'Linking…'}</span></div>
        {linked && hit && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {hitShow && <ShowCover show={hitShow} size="lg" />}
              <div>
                <h3>{hitLabel(hit, showsById)}</h3>
                {hitTheme && <div className="small">{hitTheme.songTitle} · {hitTheme.artists.join(', ')}</div>}
                {linked.hits.length > 1 && <div className="muted small">Also {linked.hits.slice(1).map((h) => hitLabel(h, showsById)).join(', ')}</div>}
              </div>
            </div>
            <p className="muted small">{VIA[linked.via]}{linked.via === 'fuzzy' ? ` · ${Math.round(linked.confidence * 100)}%` : ''}</p>
            <div className="pl-actions-row">
              <button className="btn-line" onClick={() => setPicking(!picking)}>Change link…</button>
              <button className="link" onClick={() => onLink(null)}>Unlink</button>
            </div>
          </>
        )}
        {l?.state === 'unlinked' && (
          nearest ? (
            <>
              <span className="muted small">Nearest guess · {Math.round(nearest.confidence * 100)}%</span>
              <h3>{hitLabel(nearest, showsById)}</h3>
              <div className="pl-actions-row">
                <button className="btn-primary" onClick={() => { const { confidence: _c, ...h } = nearest; onLink(h); }}>Link to this <kbd>L</kbd></button>
              </div>
            </>
          ) : <p className="muted small">{l.manual ? 'You unlinked it.' : 'No show on your AniList list has a song like this.'}</p>
        )}
      </div>

      {(picking || l?.state === 'unlinked') && (
        <div className="pl-picker">
          <b className="small">Or pick the song</b>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Show, song or artist" aria-label="Find the song to link" autoFocus={picking} />
          <ul>
            {results.map((e) => (
              <li key={`${e.show.anilistId}:${e.theme.slug}`}>
                <span>
                  {displayTitle(e.show)} · {themeLabel(e.theme)}
                  <span className="pl-sub">{e.theme.songTitle ?? 'Unknown title'} · {e.theme.artists.join(', ')}</span>
                </span>
                <button className="btn-line btn-sm" onClick={() => { onLink({ themeKey: e.key, anilistId: e.show.anilistId, slug: e.theme.slug }); setPicking(false); }}>Link</button>
              </li>
            ))}
            {!results.length && <li className="muted">Nothing matches. Songs of shows whose openings and endings aren't looked up yet can't be picked.</li>}
          </ul>
          <span className="muted small">Searches every show on your AniList list, including ones you haven't finished.</span>
        </div>
      )}

      <div className="pl-actions-row">
        <a className="btn-line" href={yt} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: '0 12px', borderRadius: 8, textDecoration: 'none' }}>YouTube ↗</a>
      </div>
      {!linked && <p className="muted small">Unlinked is fine. Songs from shows that aren't on your AniList list stay unlinked, and the duplicate check still finds them by name.</p>}
      {linked && hitShow && (
        <div className="small">
          <b>What this link does</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>A review that finds {displayTitle(hitShow)}'s {slugLabel(hit!.slug)} again sends it to <b>Already have</b>, even under another title.</li>
            <li>It counts toward {displayTitle(hitShow)}'s songs in the anime picker.</li>
            <li>It can be the show that “suggest last show” starts from.</li>
          </ul>
        </div>
      )}
    </>
  );
}

function themeEntries(shows: Show[], lookups: Map<number, ThemeLookup>): ThemeEntry[] {
  const out: ThemeEntry[] = [];
  for (const s of shows) {
    if (s.status === 'PLANNING') continue;
    for (const t of lookups.get(s.anilistId)?.themes ?? []) out.push({ show: s, theme: t, key: themeKey(t) });
  }
  return out;
}
