/**
 * The outbound queue's flush.
 *
 * Every test here is a statement about a queue that grew large while the device was offline, which
 * Principle III makes the normal case. The server charges its rate limiter one token per report
 * against a bucket of 600 and caps the bucket there, so a flush that sends the whole queue in one
 * POST stops being deliverable at all once the queue passes 600 — not slow, *stuck*, with the
 * reports present on this phone and invisible to everyone else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import {
  cursorKey,
  getMeta,
  loadLog,
  openLogDb,
  outboxIds,
  setMeta,
  putAuthored,
  type FoxmapperDb,
} from '../../src/log/store.js';
import { Sync, type SyncOptions } from '../../src/log/sync.js';
import type { Report } from '../../src/log/types.js';

const HUNT = 'quiet-fox-8821-h7k2';
const API = 'https://relay.example';

/** Ids are zero-padded so the outbox's key order is the order they were queued in. */
function report(n: number): Report {
  return {
    v: 1,
    id: `r-${String(n).padStart(4, '0')}`,
    hunt_code: HUNT,
    kind: 'null',
    observer: { callsign: 'KI7XYZ' },
    position: { lat: 48.75, lon: -122.47 },
    position_source: 'measured',
    observed_at: 1_784_092_800_000,
    clock_offset_ms: null,
    entered_by: { participant_id: 'p-1', callsign: 'KI7XYZ' },
    payload: {},
  } as Report;
}

/**
 * The real database with its report writes failing, as a device with no storage left behaves.
 *
 * Only the reports store is broken: the meta store still accepts the cursor, which is what makes
 * the test able to see a cursor that moved when it should not have.
 */
function outOfStorage(): FoxmapperDb {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'transaction')
        return (store: string, mode: string) => {
          if (store === 'reports' && mode === 'readwrite')
            throw new DOMException('the quota has been exceeded', 'QuotaExceededError');
          return target.transaction(store as 'reports', mode as 'readwrite');
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  }) as FoxmapperDb;
}

/** The relay's 202, listing every id it was offered. */
const accepted = (batch: readonly Report[]): Response =>
  new Response(JSON.stringify({ accepted: batch.map((r) => r.id) }), { status: 202 });
const status = (code: number): Response => new Response('', { status: code });

let db: FoxmapperDb;
/** The batches the relay was actually offered, in order. */
let sent: Report[][];

async function queue(count: number): Promise<void> {
  for (let n = 0; n < count; n += 1) await putAuthored(db, report(n));
}

/** Replies to the nth POST with `replies[n]`, falling back to acceptance. */
function relay(...replies: readonly ((batch: readonly Report[]) => Response)[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const batch = JSON.parse(init.body as string) as Report[];
      sent.push(batch);
      const reply = replies[sent.length - 1] ?? accepted;
      return Promise.resolve(reply(batch));
    }),
  );
}

/** Every `Sync` a test built, so none is left running into the test after it. */
let built: Sync[];

function sync(options: Partial<SyncOptions> = {}): Sync {
  const running = new Sync({ db, huntCode: HUNT, apiOrigin: API, onReports: () => {}, ...options });
  built.push(running);
  return running;
}

beforeEach(async () => {
  // A fresh database per test: these assert about what stayed queued, so leakage would make a test
  // pass for the wrong reason.
  indexedDB = new IDBFactory();
  db = await openLogDb();
  sent = [];
  built = [];
  relay();
});

afterEach(() => {
  // The database is isolated above, but `fetch` is a global stub with no such per-test identity: a
  // drain still running here would read the *next* test's relay, and a request it never made is
  // the kind of failure that gets read as a flake in whichever test inherits it.
  for (const running of built) running.stop();
});

describe('flush', () => {
  it('drains a queue far larger than the rate limiter bucket in one call', async () => {
    await queue(1000);

    await sync().flush();

    expect(sent.map((batch) => batch.length)).toEqual([200, 200, 200, 200, 200]);
    expect(await outboxIds(db, HUNT)).toEqual([]);
  });

  it('keeps the batches that landed when a later one is rate limited', async () => {
    await queue(1000);
    relay(accepted, () => status(429));

    await sync().flush();

    // The 429 ends the flush rather than hammering the limiter with batches that would fail too.
    expect(sent).toHaveLength(2);
    const queued = await outboxIds(db, HUNT);
    expect(queued).toHaveLength(800);
    expect(queued[0]).toBe('r-0200');

    relay();
    await sync().flush();
    expect(await outboxIds(db, HUNT)).toEqual([]);
  });

  it('reports the hunt gone mid-sequence without dropping what is still queued', async () => {
    await queue(1000);
    const onHuntGone = vi.fn();
    relay(accepted, () => status(404));

    await sync({ onHuntGone }).flush();

    expect(onHuntGone).toHaveBeenCalledOnce();
    expect(await outboxIds(db, HUNT)).toHaveLength(800);
  });

  it('shows the depth falling as each batch lands', async () => {
    await queue(1000);
    const depths: number[] = [];

    await sync({ onQueueDepth: (depth) => depths.push(depth) }).flush();

    // Once at the end would leave a large queue sitting at its full depth, reading as frozen.
    expect(depths).toEqual([800, 600, 400, 200, 0]);
  });

  it('will not interleave a second flush with one already part-way through', async () => {
    await queue(400);
    const running = sync();
    const reentrant: Promise<void>[] = [];
    // A stream reconnect calls flush too, and it can land between batches. Re-entering there would
    // re-send reports the first flush has in flight and has not cleared yet.
    relay((batch) => {
      reentrant.push(running.flush());
      return accepted(batch);
    });

    await running.flush();
    await Promise.all(reentrant);

    expect(sent.map((batch) => batch.length)).toEqual([200, 200]);
  });

  it('keeps a report the relay answered 2xx for but did not accept', async () => {
    await queue(3);
    // The relay leaves out an id another hunt already holds: it was never stored in this one.
    relay((batch) => accepted(batch.filter((r) => r.id !== 'r-0001')));

    await sync().flush();

    expect(await outboxIds(db, HUNT)).toEqual(['r-0001']);
  });
});

describe('the poll tick', () => {
  it('retries a queue whose flush on reconnect failed, without waiting on the stream', async () => {
    // The stream never opens, so its `onopen` flush never comes: the case where SSE is still in
    // its reconnect backoff when coverage returns.
    vi.stubGlobal(
      'EventSource',
      class {
        close(): void {}
      },
    );
    // Only the interval is faked; fake-indexeddb schedules its own work on real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await queue(3);
    // The first flush meets a network that is not passing requests yet, as an `online` event
    // fired a beat early would.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const running = sync();
    await running.start();
    expect(await outboxIds(db, HUNT)).toHaveLength(3);

    relay();
    vi.advanceTimersByTime(15_000);

    await vi.waitFor(async () => expect(await outboxIds(db, HUNT)).toEqual([]));
    running.stop();
    vi.useRealTimers();
  });
});

/**
 * The catch-up drain.
 *
 * The relay answers `GET /reports?since=` with at most one page, so a single request is an answer
 * to "what is the next page", not to "what have I missed". A client that absorbs one response and
 * stops leaves the rest of the log behind — and on the repair path, which reads from 0 once after
 * the audit found a divergence and never comes back, it leaves it behind permanently. That is a
 * report dropped in silence, which is the one outcome this codebase does not accept.
 */
describe('the catch-up drain', () => {
  const PAGE = 500;
  const POLL_INTERVAL_MS = 15_000;

  /** The relay's view of a hunt: `total` reports at seqs 1..total, served a page at a time. */
  function pagedRelay(total: number): { requested: number[] } {
    const requested: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const since = Number(new URL(url).searchParams.get('since'));
        requested.push(since);
        const seqs = [];
        for (let seq = since + 1; seq <= Math.min(since + PAGE, total); seq += 1) seqs.push(seq);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reports: seqs.map((seq) => ({ seq, received_at: seq, body: report(seq) })),
              cursor: seqs.length > 0 ? seqs[seqs.length - 1] : since,
              more: seqs.length === PAGE,
            }),
          ),
        );
      }),
    );
    return { requested };
  }

  /**
   * Resolves on a real timer, which fires only after every microtask already queued has run.
   *
   * That is what makes the tail of `tick` sound: a drain that wrongly carries on reaches its next
   * `fetch` through microtasks alone, so it has already asked by the time this resolves. The 10ms
   * is the granularity the waits below poll at, and nothing depends on the figure.
   */
  const realTimer = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

  /** When the running test began, so one budget covers however many ticks it drives. */
  let startedAt = 0;
  beforeEach(() => {
    startedAt = Date.now();
  });

  /**
   * Drives one poll tick to completion, without waiting out the real 15s interval.
   *
   * A drain is a chain of fetches and IndexedDB writes, and the tick callback returns long before
   * the drain it started has finished, so `tick` has to wait for that drain itself: `stop()` cuts
   * a drain off at its next page boundary, which on a half-read log is a test that fails with the
   * tail of the log missing.
   *
   * `landed` asserts what this tick is expected to leave behind, and is retried until it holds —
   * so whatever it was still waiting for when the budget ran out is what gets reported. Waiting on
   * the drain's own writes is what keeps that wait sound: a page write is unbounded, so a window
   * sized to "nothing has happened lately" is one a loaded runner exceeds, and the drain is then
   * cut off mid-log.
   *
   * By the time `landed` holds there is no write in flight, which is also what keeps a drain from
   * running on into the next test's `fetch` stub: `stop()` lands on a drain sitting at its loop
   * condition rather than part-way through a page.
   *
   * The wait runs on real timers throughout. Advancing the fake interval here would fire a second
   * tick, and the request that tick makes is indistinguishable from the drain running long.
   */
  async function tick(running: Sync, landed: () => Promise<void>): Promise<void> {
    vi.stubGlobal(
      'EventSource',
      class {
        close(): void {}
      },
    );
    // Only the interval is faked: fake-indexeddb and the waits below both need a real setTimeout.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await running.start();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      // Budgeted per test rather than per tick, and inside vitest's own 5s timeout, so a test that
      // drives two ticks still fails with the assertion the drain was short of rather than with a
      // bare timeout. The slowest drain here runs well under a second on a saturated runner.
      const deadline = startedAt + 3_000;
      for (;;) {
        try {
          await landed();
          break;
        } catch (stillWaiting) {
          if (Date.now() > deadline) throw stillWaiting;
          await realTimer();
        }
      }
      await realTimer();
      await realTimer();
    } finally {
      running.stop();
      vi.useRealTimers();
    }
  }

  /** The drain has read the log through to `seq`: the cursor only names reports already stored. */
  const readTo = (seq: number) => async (): Promise<void> => {
    expect(await getMeta<number>(db, cursorKey(HUNT))).toBe(seq);
  };

  /**
   * The drain has stopped asking for pages.
   *
   * For a relay whose pages are empty, and only there: with nothing to store there is no write to
   * wait on, and equally nothing unbounded between one request and the next, so two readings that
   * agree mean the drain is done rather than mid-page. Waiting on the first request instead would
   * make these tests blind to a drain that keeps asking at any pace slower than the tail below —
   * which is the whole of what they check.
   */
  const stoppedAsking = (requested: readonly number[]) => {
    let previous = -1;
    return async (): Promise<void> => {
      const before = previous;
      previous = requested.length;
      expect(requested.length, 'the drain is still asking for pages').toBe(before);
    };
  };

  it('reads a log of several pages through to the end, every report exactly once', async () => {
    const total = PAGE * 2 + 7;
    const { requested } = pagedRelay(total);
    const delivered: string[] = [];

    await tick(
      sync({ onReports: (reports) => delivered.push(...reports.map((r) => r.id)) }),
      async () => expect(delivered).toHaveLength(total),
    );

    // One request per page and one cursor walk: 0, 500, 1000.
    expect(requested).toEqual([0, PAGE, PAGE * 2]);
    expect(new Set(delivered).size).toBe(total);
    expect((await loadLog(db, HUNT)).size).toBe(total);
    expect(await getMeta<number>(db, cursorKey(HUNT))).toBe(total);
  });

  it('leaves the cursor on the last page that landed, not on the one it asked for', async () => {
    // The invariant that makes a failed write cost a re-download rather than a report: the cursor
    // never names a report this device does not hold.
    const total = PAGE * 2 + 7;
    pagedRelay(total);
    const running = sync();

    await tick(running, readTo(total));

    // A second drain from that cursor asks for what comes after the log, and finds nothing.
    const second = pagedRelay(total);
    await tick(running, stoppedAsking(second.requested));
    expect(second.requested).toEqual([total]);
    expect((await loadLog(db, HUNT)).size).toBe(total);
  });

  it('leaves the cursor alone when the page it read could not be stored', async () => {
    // The ordering inside `#absorb` is what makes a failed write cost a re-download rather than a
    // report: a cursor raised before the write would name reports this device does not hold, and
    // the next drain would start above them — the one outcome this codebase does not accept.
    //
    // Driven through `repair`, which reads pages through the same `#absorb` and is awaited, so the
    // ordering is asserted without a drain to wait on.
    const total = 3;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              reports: Array.from({ length: total }, (_, n) => ({
                seq: n + 1,
                received_at: n + 1,
                body: report(n + 1),
              })),
              cursor: total,
              more: false,
            }),
          ),
        ),
      ),
    );

    await sync({ db: outOfStorage() }).repair([]);

    expect(await getMeta<number>(db, cursorKey(HUNT))).toBeUndefined();
    expect((await loadLog(db, HUNT)).size).toBe(0);
  });

  it('resumes a drain that was cut off mid-log without re-reading the pages that landed', async () => {
    const total = PAGE * 2 + 7;
    let fail = false;
    const requested: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const since = Number(new URL(url).searchParams.get('since'));
        requested.push(since);
        // Coverage drops partway through, as it does on a hillside.
        if (fail && since > 0) return Promise.reject(new TypeError('Failed to fetch'));
        const seqs = [];
        for (let seq = since + 1; seq <= Math.min(since + PAGE, total); seq += 1) seqs.push(seq);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reports: seqs.map((seq) => ({ seq, received_at: seq, body: report(seq) })),
              cursor: seqs.length > 0 ? seqs[seqs.length - 1] : since,
              more: seqs.length === PAGE,
            }),
          ),
        );
      }),
    );

    fail = true;
    const running = sync();
    await tick(running, readTo(PAGE));
    expect(requested).toEqual([0, PAGE]);
    expect((await loadLog(db, HUNT)).size).toBe(PAGE);

    fail = false;
    requested.length = 0;
    await tick(running, readTo(total));
    // From the page that landed, not from 0: the first page is not downloaded twice.
    expect(requested).toEqual([PAGE, PAGE * 2]);
    expect((await loadLog(db, HUNT)).size).toBe(total);
  });

  it('stops when the relay claims more but does not advance the cursor', async () => {
    // A relay bug, or a build that does not send `cursor` at all. Without the guard the drain
    // re-asks the same question forever, so the relay below gives up after a few repeats rather
    // than letting the loop run the test process out of memory.
    const requested: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requested.push(Number(new URL(url).searchParams.get('since')));
        const stuck = requested.length < 5;
        return Promise.resolve(
          new Response(JSON.stringify({ reports: [], cursor: 0, more: stuck })),
        );
      }),
    );

    await tick(sync(), stoppedAsking(requested));

    expect(requested).toEqual([0]);
  });

  it('treats a response without `more` as the end of the log', async () => {
    // A relay older than this client answers with the whole log and no `more`. Reading one
    // response and stopping is exactly right there, and must not loop.
    const requested: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requested.push(Number(new URL(url).searchParams.get('since')));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reports: [{ seq: 1, received_at: 1, body: report(1) }],
              cursor: 1,
            }),
          ),
        );
      }),
    );

    await tick(sync(), readTo(1));

    expect(requested).toEqual([0]);
    expect((await loadLog(db, HUNT)).size).toBe(1);
  });
});

describe('repair', () => {
  const PAGE = 500;

  it('re-reads the whole log across every page, not just the first', async () => {
    // The audit found a divergence and this is the pull half. It runs once and never comes back,
    // so a drain that stopped at the first page would leave the divergence in place and report
    // the repair as done.
    const total = PAGE * 2 + 7;
    const requested: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return Promise.resolve(new Response('{"accepted":[]}'));
        const since = Number(new URL(url).searchParams.get('since'));
        requested.push(since);
        const seqs = [];
        for (let seq = since + 1; seq <= Math.min(since + PAGE, total); seq += 1) seqs.push(seq);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reports: seqs.map((seq) => ({ seq, received_at: seq, body: report(seq) })),
              cursor: seqs.length > 0 ? seqs[seqs.length - 1] : since,
              more: seqs.length === PAGE,
            }),
          ),
        );
      }),
    );

    await sync().repair([]);

    expect(requested).toEqual([0, PAGE, PAGE * 2]);
    expect((await loadLog(db, HUNT)).size).toBe(total);
  });

  it('reads from the beginning even when the stored cursor is already at the end', async () => {
    // The whole point of reading from 0: the cursor says this device is up to date, and the audit
    // has just proved it is not.
    const requested: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return Promise.resolve(new Response('{"accepted":[]}'));
        const since = Number(new URL(url).searchParams.get('since'));
        requested.push(since);
        const seqs = [];
        for (let seq = since + 1; seq <= Math.min(since + PAGE, 3); seq += 1) seqs.push(seq);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reports: seqs.map((seq) => ({ seq, received_at: seq, body: report(seq) })),
              cursor: seqs.length > 0 ? seqs[seqs.length - 1] : since,
              more: false,
            }),
          ),
        );
      }),
    );

    await setMeta(db, cursorKey(HUNT), 3);
    await sync().repair([]);

    expect(requested).toEqual([0]);
    expect((await loadLog(db, HUNT)).size).toBe(3);
  });
});
