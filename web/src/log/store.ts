/**
 * IndexedDB persistence. The G-Set is literally an object store keyed by report id.
 *
 * Reports are written here **first** and queued for the server afterwards, so the network is never
 * in the write path and connectivity loss cannot lose or block a report (Principle III).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Log, Report } from './types.js';
import { toLog } from './gset.js';

const DB_NAME = 'foxmapper';
const DB_VERSION = 1;

interface FoxmapperSchema extends DBSchema {
  reports: {
    key: string;
    value: Report;
    indexes: { by_hunt: string };
  };
  /** Report ids not yet accepted by the server. Drained only on a 2xx. */
  outbox: {
    key: string;
    value: { id: string; hunt_code: string; queued_at: number };
    indexes: { by_hunt: string };
  };
  /** Small key/value scratch: sync cursor, clock offset, last hunt. */
  meta: {
    key: string;
    value: unknown;
  };
}

export type FoxmapperDb = IDBPDatabase<FoxmapperSchema>;

export function openLogDb(): Promise<FoxmapperDb> {
  return openDB<FoxmapperSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const reports = db.createObjectStore('reports', { keyPath: 'id' });
      reports.createIndex('by_hunt', 'hunt_code');
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('by_hunt', 'hunt_code');
      db.createObjectStore('meta');
    },
  });
}

/**
 * Load-all-on-open: the whole hunt lives in memory, because every render is a fold over the whole
 * set and a hunt is thousands of reports, not millions.
 */
export async function loadLog(db: FoxmapperDb, huntCode: string): Promise<Log> {
  const reports = await db.getAllFromIndex('reports', 'by_hunt', huntCode);
  return toLog(reports);
}

/**
 * Writes a report and enqueues it for the server in **one transaction**.
 *
 * If these were two transactions, a force-quit between them would leave a report that is stored
 * but never sent — present on the reporter's map and invisible to everyone else, with nothing to
 * detect it. That is a lost report by any honest reading.
 */
export async function putAuthored(db: FoxmapperDb, report: Report): Promise<void> {
  const tx = db.transaction(['reports', 'outbox'], 'readwrite');
  await Promise.all([
    tx.objectStore('reports').put(report),
    tx.objectStore('outbox').put({
      id: report.id,
      hunt_code: report.hunt_code,
      queued_at: Date.now(),
    }),
    tx.done,
  ]);
}

/** Reports arriving from the server. They are already synced, so they never enter the outbox. */
export async function putRemote(db: FoxmapperDb, reports: readonly Report[]): Promise<void> {
  if (reports.length === 0) return;
  const tx = db.transaction('reports', 'readwrite');
  const store = tx.objectStore('reports');
  // Adding a known id is a no-op — the merge is a union, and `put` is idempotent by key.
  await Promise.all([...reports.map((r) => store.put(r)), tx.done]);
}

export async function outboxIds(db: FoxmapperDb, huntCode: string): Promise<string[]> {
  const entries = await db.getAllFromIndex('outbox', 'by_hunt', huntCode);
  return entries.map((e) => e.id);
}

export async function outboxDepth(db: FoxmapperDb, huntCode: string): Promise<number> {
  return db.countFromIndex('outbox', 'by_hunt', huntCode);
}

/** Called only on a 2xx. A 429 or a dropped connection leaves the queue exactly as it was. */
export async function clearOutbox(db: FoxmapperDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');
  await Promise.all([...ids.map((id) => store.delete(id)), tx.done]);
}

export async function getReports(db: FoxmapperDb, ids: readonly string[]): Promise<Report[]> {
  const found = await Promise.all(ids.map((id) => db.get('reports', id)));
  return found.filter((r): r is Report => r !== undefined);
}

export async function getMeta<T>(db: FoxmapperDb, key: string): Promise<T | undefined> {
  return (await db.get('meta', key)) as T | undefined;
}

export async function setMeta(db: FoxmapperDb, key: string, value: unknown): Promise<void> {
  await db.put('meta', value, key);
}

export const cursorKey = (huntCode: string): string => `cursor:${huntCode}`;
