import type { PlaylistRow } from './playlistImport';
import { normalize } from './matcher';
import { findInPlaylist, indexPlaylist, type PlaylistIndex } from './tailInference';

/**
 * Duplicate prevention for the kept-list export (SPEC §9.4, layer 1).
 * Pure: the UI passes in the playlist snapshot index, the add log and the
 * user's "add anyway" overrides.
 */

export interface ExportItem {
  /** themeKey of the reviewed song. */
  key: string;
  trackId: number;
  title: string;
  artist: string;
  durationMs: number | null;
  url: string;
  /** e.g. "Demon Slayer OP1" — for display only. */
  label: string;
}

/** One song the app recorded as added ("I added these"). */
export interface AddedRecord {
  trackId: number;
  title: string;
  artist: string;
  durationMs: number | null;
  key: string;
  batchId: string;
  addedAt: number;
}

export type HoldReason = 'repeat-in-batch' | 'already-added' | 'in-playlist' | 'other-version';

export interface Held {
  item: ExportItem;
  reason: HoldReason;
  /** Human-readable: what it collided with. */
  detail: string;
  /** Can the user override with "add anyway"? (Repeats can't.) */
  overridable: boolean;
}

export interface ExportPlan {
  add: ExportItem[];
  held: Held[];
}

export const REASON_LABEL: Record<HoldReason, string> = {
  'repeat-in-batch': 'listed twice',
  'already-added': 'already added by the app',
  'in-playlist': 'already in playlist',
  'other-version': 'other version in playlist',
};

const nameKey = (title: string, artist: string) => `${normalize(title)}|${normalize(artist)}`;
const describe = (r: { title: string; artist: string }) => `${r.title} — ${r.artist}`;

/** Add-log records as playlist rows, so the same matcher covers both sources. */
export function addedAsRows(added: AddedRecord[]): PlaylistRow[] {
  return added.map((a, i) => ({ position: i + 1, title: a.title, artist: a.artist, album: '', durationMs: a.durationMs }));
}

export function planExport(
  items: ExportItem[],
  { playlist = null, added = [], overrides = new Set<string>() }: { playlist?: PlaylistIndex | null; added?: AddedRecord[]; overrides?: Set<string> } = {},
): ExportPlan {
  const addedIds = new Set(added.map((a) => a.trackId));
  const addedIdx = added.length ? indexPlaylist(addedAsRows(added)) : null;
  const seenIds = new Set<number>();
  const seenNames = new Map<string, ExportItem>();
  const add: ExportItem[] = [];
  const held: Held[] = [];

  for (const item of items) {
    const name = nameKey(item.title, item.artist);
    const first = seenIds.has(item.trackId) ? add.find((a) => a.trackId === item.trackId) : seenNames.get(name);
    if (first) {
      held.push({ item, reason: 'repeat-in-batch', detail: `same song as ${first.label}`, overridable: false });
      continue;
    }

    const track = { trackName: item.title, artistName: item.artist, trackTimeMillis: item.durationMs };
    let hold: Omit<Held, 'item' | 'overridable'> | null = null;
    if (addedIds.has(item.trackId)) {
      hold = { reason: 'already-added', detail: 'same track' };
    } else {
      const inLog = addedIdx && findInPlaylist(addedIdx, track);
      if (inLog?.kind === 'duplicate') hold = { reason: 'already-added', detail: describe(inLog.row) };
      else {
        const inPl = playlist && findInPlaylist(playlist, track);
        if (inPl) hold = { reason: inPl.kind === 'duplicate' ? 'in-playlist' : 'other-version', detail: `#${inPl.row.position}: ${describe(inPl.row)}` };
        else if (inLog) hold = { reason: 'other-version', detail: `added earlier: ${describe(inLog.row)}` };
      }
    }

    if (hold && !overrides.has(item.key)) {
      held.push({ item, ...hold, overridable: true });
      continue;
    }
    seenIds.add(item.trackId);
    seenNames.set(name, item);
    add.push(item);
  }
  return { add, held };
}

/**
 * Shortcut format: `Title | Artist | URL`, one song per line. The shortcut
 * compares the lowercased `title | artist` part against the playlist's
 * `name | artist`. A literal " | " inside a name would shift the fields, so
 * it's replaced with " / ". Any text containing the URLs also still works with
 * a shortcut that only extracts URLs.
 */
export function shortcutLine(item: Pick<ExportItem, 'title' | 'artist' | 'url'>): string {
  const clean = (s: string) => s.replace(/\s*\|\s*/g, ' / ').replace(/[\r\n]+/g, ' ').trim();
  return `${clean(item.title)} | ${clean(item.artist)} | ${item.url}`;
}
