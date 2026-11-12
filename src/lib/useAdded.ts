import { useCallback, useEffect, useState } from 'react';
import { db } from './db';
import type { AddedRecord, ExportItem } from './dedupe';

/** The add log: what the user confirmed adding to the playlist. */
export function useAdded() {
  const [added, setAdded] = useState<AddedRecord[]>([]);
  const reload = useCallback(async () => {
    setAdded((await db.added.orderBy('addedAt').toArray()).map(({ id: _id, ...r }) => r));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  /** Record a batch; returns its id (for undo). */
  const record = useCallback(async (items: ExportItem[]) => {
    const now = Date.now();
    const batchId = `b${now}`;
    await db.added.bulkAdd(items.map((i) => ({
      trackId: i.trackId, title: i.title, artist: i.artist, durationMs: i.durationMs, key: i.key, batchId, addedAt: now,
    })));
    await reload();
    return batchId;
  }, [reload]);

  const undoBatch = useCallback(async (batchId: string) => {
    await db.added.where('batchId').equals(batchId).delete();
    await reload();
  }, [reload]);

  return { added, record, undoBatch };
}
