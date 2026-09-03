/**
 * The outbound queue's flush.
 *
 * Every test here is a statement about a queue that grew large while the device was offline, which
 * Principle III makes the normal case. The server charges its rate limiter one token per report
 * against a bucket of 600 and caps the bucket there, so a flush that sends the whole queue in one
 * POST stops being deliverable at all once the queue passes 600 — not slow, *stuck*, with the
 * reports present on this phone and invisible to everyone else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { openLogDb, outboxIds, putAuthored, type FoxmapperDb } from '../../src/log/store.js';
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

const accepted = (): Response => new Response(JSON.stringify({ accepted: [] }), { status: 202 });
const status = (code: number): Response => new Response('', { status: code });

let db: FoxmapperDb;
/** The batches the relay was actually offered, in order. */
let sent: Report[][];

async function queue(count: number): Promise<void> {
  for (let n = 0; n < count; n += 1) await putAuthored(db, report(n));
}

/** Replies to the nth POST with `replies[n]`, falling back to acceptance. */
function relay(...replies: readonly (() => Response)[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string) as Report[]);
      const reply = replies[sent.length - 1] ?? accepted;
      return Promise.resolve(reply());
    }),
  );
}

function sync(options: Partial<SyncOptions> = {}): Sync {
  return new Sync({ db, huntCode: HUNT, apiOrigin: API, onReports: () => {}, ...options });
}

beforeEach(async () => {
  // A fresh database per test: these assert about what stayed queued, so leakage would make a test
  // pass for the wrong reason.
  indexedDB = new IDBFactory();
  db = await openLogDb();
  sent = [];
  relay();
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
    relay(() => {
      reentrant.push(running.flush());
      return accepted();
    });

    await running.flush();
    await Promise.all(reentrant);

    expect(sent.map((batch) => batch.length)).toEqual([200, 200]);
  });
});
