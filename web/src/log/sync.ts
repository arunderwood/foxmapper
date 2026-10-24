/**
 * The outbound queue and the sync stream.
 *
 * Nothing here is in the write path. A report is already durable before this file sees it, so
 * every failure below costs latency, never a report.
 */
import type { LogEntry, Report } from './types.js';
import {
  clearOutbox,
  cursorKey,
  getMeta,
  getReports,
  outboxDepth,
  outboxIds,
  putAuthored,
  putRemote,
  setMeta,
  type FoxmapperDb,
} from './store.js';

export interface SyncOptions {
  db: FoxmapperDb;
  huntCode: string;
  apiOrigin: string;
  /** Called whenever reports arrive, so the map can re-fold. */
  onReports: (reports: readonly LogEntry[]) => void;
  /**
   * Called when the stream opens or drops.
   *
   * This is what FR-018 renders, so it must track the *connection*, not whether reports happen to
   * have arrived: a quiet hunt is not a disconnected one, and a map that cries "no signal" over a
   * healthy stream teaches hunters to ignore the one indicator that tells them the picture is
   * partial.
   */
  onLive?: (live: boolean) => void;
  /** Called when the queue depth changes, so the UI can show what is stuck on this phone. */
  onQueueDepth?: (depth: number) => void;
  /** Called when the hunt is gone (204/404), so the client can land the participant elsewhere. */
  onHuntGone?: () => void;
}

interface Envelope {
  seq: number;
  received_at: number;
  /** Whatever the poster sent. The relay checked only that `id` is a UUID. */
  body: LogEntry;
}

/** One page of `GET /reports?since=`. */
interface SyncPage {
  reports: Envelope[];
  /** The highest `seq` in `reports`, or the `since` that was asked for when the page is empty. */
  cursor: number;
  /** The log continues above `cursor`. The relay says so rather than leaving it to be inferred
   * from the page being full, so the page size is not a number the two sides have to agree on. */
  more: boolean;
}

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const POLL_INTERVAL_MS = 15_000;

/**
 * Reports per POST.
 *
 * The server charges its rate limiter one token per report in the batch against a bucket that
 * holds 600 and is capped there. A batch larger than the bucket can therefore never be accepted
 * at any refill rate: it 429s, the queue is left intact by design, the next flush rebuilds the
 * same oversized batch, and the device is stuck forever with reports nobody else can see. Two
 * hours offline is enough to build one, and offline is the normal case (Principle III).
 *
 * 200 sits well under that ceiling so the deadlock is unreachable by construction, and equals
 * `MAX_BATCH` in server/src/routes/reports.rs, which 413s anything larger. The two numbers have to
 * agree.
 */
const FLUSH_BATCH_SIZE = 200;

export class Sync {
  #options: SyncOptions;
  #source: EventSource | undefined;
  #backoff = MIN_BACKOFF_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #stopped = false;
  #flushing = false;
  #polling = false;

  constructor(options: SyncOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.flush();
    this.#connect();
    // Polling is the fallback, on the same cursor, for the case SSE cannot cover: a proxy that
    // swallows the stream entirely. It is idempotent with the stream — both advance one cursor.
    // The tick also retries the outbox. The `online` event can fire before requests get through,
    // and the stream's reconnect backoff reaches a minute, so neither alone bounds how long a
    // queued report waits once coverage is back. An empty outbox costs one IndexedDB read.
    this.#pollTimer = setInterval(() => {
      void this.flush();
      void this.#poll();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    this.#stopped = true;
    this.#source?.close();
    this.#source = undefined;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#pollTimer) clearInterval(this.#pollTimer);
  }

  /**
   * Sends everything queued, in batches of `FLUSH_BATCH_SIZE`. **A batch drains only on a 2xx,
   * and only the reports that 2xx lists as accepted.**
   *
   * A 429 is retryable and never drops a report — a dropped report is the one unacceptable
   * outcome, and the rate limit exists to stop a script, not to reject a hunter.
   *
   * Each batch is cleared on its own 2xx, so a failure partway through keeps the ground already
   * gained; the batches that did land stay drained. The first non-2xx ends the whole flush rather
   * than trying the rest: after a 429 the later batches would fail too, and retrying them only
   * pushes the bucket further down.
   */
  async flush(): Promise<void> {
    if (this.#flushing || this.#stopped) return;
    this.#flushing = true;
    try {
      const { db, huntCode, apiOrigin } = this.#options;
      const ids = await outboxIds(db, huntCode);

      for (let from = 0; from < ids.length; from += FLUSH_BATCH_SIZE) {
        const batch = ids.slice(from, from + FLUSH_BATCH_SIZE);
        const reports = await getReports(db, batch);
        if (reports.length === 0) continue;

        const response = await fetch(`${apiOrigin}/api/hunts/${huntCode}/reports`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(reports),
        });

        if (response.ok) {
          // The server is idempotent by id, so re-sending a report it already has is harmless.
          // That is what lets this queue be dumb and retry blindly forever.
          //
          // Only what the server lists as accepted drains. A 2xx can still leave a report out — an
          // id another hunt already holds is never stored in this one — and clearing on the status
          // alone would drop it from the queue while it is missing from the hunt.
          const { accepted } = (await response.json()) as { accepted: string[] };
          const offered = new Set(reports.map((r) => r.id));
          await clearOutbox(
            db,
            accepted.filter((id) => offered.has(id)),
          );
          // Reported per batch, not once at the end: a queue of thousands that only updated after
          // the last batch would sit at its full depth for minutes and read as frozen.
          this.#options.onQueueDepth?.(await outboxDepth(db, huntCode));
          continue;
        }

        if (response.status === 404) {
          // Purged or unknown. Keep the reports locally rather than discarding them.
          this.#options.onHuntGone?.();
          return;
        }
        // 429 and 5xx both land here: what is left is untouched and the next flush retries.
        return;
      }
    } catch {
      // Offline. What is left is untouched.
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
      this.#options.onLive?.(true);
      void this.flush();
    };

    source.onmessage = (event) => {
      void this.#ingest(event.data);
    };

    source.onerror = () => {
      // SSE's automatic reconnection is oversold: only network errors retry. A non-200 or a wrong
      // MIME type makes the browser fail the connection and never reconnect — so a transient 502
      // from a load balancer would kill the stream for good. Watch readyState and re-create it.
      this.#options.onLive?.(false);
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

  /**
   * Repairs a divergence the audit found.
   *
   * Both directions are blunt on purpose. **Pull**: read the hunt from the beginning, paging all
   * the way to the end — the merge is a union, so re-reading a report this device already holds
   * cannot lose or duplicate anything, and divergence is rare enough that the bandwidth does not
   * matter.
   * **Push**: re-queue the reports the server never received, which is the case that actually loses
   * a report and the reason the audit exists.
   *
   * The read is `#poll(0)` rather than a rewind of the stored cursor. Rewinding raced the stream it
   * runs alongside: an SSE event landing between the rewind and the poll raised the cursor back to
   * its own `seq`, and the poll then read *that* — so the repair quietly fetched nothing and the
   * missing reports stayed missing. The cursor is never lowered now; it does not need to be.
   */
  async repair(missingRemotely: readonly Report[]): Promise<void> {
    const { db, huntCode } = this.#options;
    for (const report of missingRemotely) await putAuthored(db, report);
    this.#options.onQueueDepth?.((await outboxIds(db, huntCode)).length);

    await this.flush();
    await this.#poll(0);
  }

  /**
   * Reads the log forward from a cursor, a page at a time, until the relay says there is no more.
   *
   * The relay answers with at most one page, so a single request is not an answer to "what have I
   * missed" — it is an answer to "what is the next page". Stopping after one would leave the rest
   * until the next tick on the poll path, and would leave it *forever* on the repair path, which
   * reads from 0 once and never comes back. A dropped report is the one unacceptable outcome.
   *
   * Each page is absorbed before the next is asked for, so the stored cursor only ever names
   * reports that are already durable (see `#absorb`): a drain interrupted anywhere resumes from
   * the last page that landed, and the pages that landed are not re-read.
   *
   * @param from Read from this sequence instead of the stored cursor. The repair passes 0.
   */
  async #poll(from?: number): Promise<void> {
    if (this.#stopped) return;
    // A drain of a long log can outlast the 15s tick. A second drain alongside it would still be
    // correct — the merge is a union and the cursor takes the maximum — but it would re-download
    // what the first is already fetching, and on the connection where that matters the tick can
    // wait. Only the tick: a repair that quietly did nothing is the failure the audit exists to
    // catch, so it neither yields to a drain in flight nor claims the flag from one.
    const tick = from === undefined;
    if (tick) {
      if (this.#polling) return;
      this.#polling = true;
    }
    const { db, huntCode, apiOrigin } = this.#options;
    try {
      let cursor = from ?? (await getMeta<number>(db, cursorKey(huntCode))) ?? 0;
      for (;;) {
        const response = await fetch(`${apiOrigin}/api/hunts/${huntCode}/reports?since=${cursor}`, {
          cache: 'no-store',
        });
        if (response.status === 404) {
          this.#options.onHuntGone?.();
          return;
        }
        if (!response.ok) return;
        const page = (await response.json()) as SyncPage;
        await this.#absorb(page.reports);
        // Checked per page, not just on the way in: a long drain can outlive the hunt it is
        // reading, and nothing above this is bounded by anything the caller still cares about.
        if (this.#stopped) return;

        // Another page only if the relay says so *and* the cursor moved. A relay that reports
        // more without advancing — a bug, or a `more` an older build does not send at all, which
        // reads as `undefined` — would otherwise spin this loop on one request forever.
        if (!page.more || !(page.cursor > cursor)) return;
        cursor = page.cursor;
      }
    } catch {
      // Offline, or a page that failed to persist. The stored cursor has not passed anything this
      // device does not hold, so the next drain picks up where this one stopped.
    } finally {
      if (tick) this.#polling = false;
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
