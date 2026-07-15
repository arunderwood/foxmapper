/**
 * The outbound queue and the sync stream.
 *
 * Nothing here is in the write path. A report is already durable before this file sees it, so
 * every failure below costs latency, never a report.
 */
import type { Report } from './types.js';
import {
  clearOutbox,
  cursorKey,
  getMeta,
  getReports,
  outboxIds,
  putRemote,
  setMeta,
  type FoxmapperDb,
} from './store.js';

export interface SyncOptions {
  db: FoxmapperDb;
  huntCode: string;
  apiOrigin: string;
  /** Called whenever reports arrive, so the map can re-fold. */
  onReports: (reports: readonly Report[]) => void;
  /** Called when the queue depth changes, so the UI can show what is stuck on this phone. */
  onQueueDepth?: (depth: number) => void;
  /** Called when the hunt is gone (204/404), so the client can land the participant elsewhere. */
  onHuntGone?: () => void;
}

interface Envelope {
  seq: number;
  received_at: number;
  body: Report;
}

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const POLL_INTERVAL_MS = 15_000;

export class Sync {
  #options: SyncOptions;
  #source: EventSource | undefined;
  #backoff = MIN_BACKOFF_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #stopped = false;
  #flushing = false;

  constructor(options: SyncOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.flush();
    this.#connect();
    // Polling is the fallback, on the same cursor, for the case SSE cannot cover: a proxy that
    // swallows the stream entirely. It is idempotent with the stream — both advance one cursor.
    this.#pollTimer = setInterval(() => void this.#poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.#stopped = true;
    this.#source?.close();
    this.#source = undefined;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#pollTimer) clearInterval(this.#pollTimer);
  }

  /**
   * Sends everything queued. **The queue drains only on a 2xx.**
   *
   * A 429 is retryable and never drops a report — a dropped report is the one unacceptable
   * outcome, and the rate limit exists to stop a script, not to reject a hunter.
   */
  async flush(): Promise<void> {
    if (this.#flushing || this.#stopped) return;
    this.#flushing = true;
    try {
      const { db, huntCode, apiOrigin } = this.#options;
      const ids = await outboxIds(db, huntCode);
      if (ids.length === 0) return;

      const reports = await getReports(db, ids);
      if (reports.length === 0) return;

      const response = await fetch(`${apiOrigin}/api/hunts/${huntCode}/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reports),
      });

      if (response.ok) {
        // The server is idempotent by id, so re-sending a report it already has is harmless. That
        // is what lets this queue be dumb and retry blindly forever.
        await clearOutbox(db, reports.map((r) => r.id));
        this.#options.onQueueDepth?.(await outboxIds(db, huntCode).then((r) => r.length));
        return;
      }

      if (response.status === 404) {
        // Purged or unknown. Keep the reports locally rather than discarding them.
        this.#options.onHuntGone?.();
        return;
      }
      // 429 and 5xx both land here: the queue is untouched and the next flush retries.
    } catch {
      // Offline. The queue is untouched.
    } finally {
      this.#flushing = false;
    }
  }

  #connect(): void {
    if (this.#stopped) return;
    const { huntCode, apiOrigin } = this.#options;

    // The browser replays the last `id:` as Last-Event-ID automatically, so catch-up after four
    // offline hours and a live report are the same code path and need no client cursor logic.
    const source = new EventSource(`${apiOrigin}/api/hunts/${huntCode}/stream`);
    this.#source = source;

    source.onopen = () => {
      this.#backoff = MIN_BACKOFF_MS;
      void this.flush();
    };

    source.onmessage = (event) => {
      void this.#ingest(event.data);
    };

    source.onerror = () => {
      // SSE's automatic reconnection is oversold: only network errors retry. A non-200 or a wrong
      // MIME type makes the browser fail the connection and never reconnect — so a transient 502
      // from a load balancer would kill the stream for good. Watch readyState and re-create it.
      if (source.readyState !== EventSource.CLOSED) return;
      source.close();
      if (this.#stopped) return;
      this.#reconnectTimer = setTimeout(() => this.#connect(), this.#backoff);
      this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
    };
  }

  async #ingest(data: string): Promise<void> {
    try {
      const envelope = JSON.parse(data) as Envelope;
      await this.#absorb([envelope]);
    } catch {
      // A malformed event is the server's problem, not a reason to tear down the stream.
    }
  }

  async #poll(): Promise<void> {
    if (this.#stopped) return;
    const { db, huntCode, apiOrigin } = this.#options;
    try {
      const cursor = (await getMeta<number>(db, cursorKey(huntCode))) ?? 0;
      const response = await fetch(
        `${apiOrigin}/api/hunts/${huntCode}/reports?since=${cursor}`,
        { cache: 'no-store' },
      );
      if (response.status === 404) {
        this.#options.onHuntGone?.();
        return;
      }
      if (!response.ok) return;
      const payload = (await response.json()) as { reports: Envelope[] };
      await this.#absorb(payload.reports);
    } catch {
      // Offline. The device keeps rendering what it holds.
    }
  }

  async #absorb(envelopes: readonly Envelope[]): Promise<void> {
    if (envelopes.length === 0) return;
    const { db, huntCode } = this.#options;

    const reports = envelopes.map((e) => e.body);
    await putRemote(db, reports);

    // Advance the cursor only after the reports are durable. If the write fails, the cursor does
    // not move and the next poll re-fetches them — the failure costs a re-download, not a report.
    const highest = Math.max(...envelopes.map((e) => e.seq));
    const current = (await getMeta<number>(db, cursorKey(huntCode))) ?? 0;
    if (highest > current) await setMeta(db, cursorKey(huntCode), highest);

    this.#options.onReports(reports);
  }
}
