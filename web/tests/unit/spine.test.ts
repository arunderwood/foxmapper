/**
 * The client spine: persistence, identity, the clock, and the audit digest.
 *
 * Principle III lives here. Every test below is a statement about what survives when the network
 * is gone, which is the normal case rather than an edge one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';

import {
  clearOutbox,
  cursorKey,
  getMeta,
  loadLog,
  openLogDb,
  outboxDepth,
  outboxIds,
  putAuthored,
  putRemote,
  setMeta,
  type FoxmapperDb,
} from '../../src/log/store.js';
import { currentIdentity, join, participantId } from '../../src/log/identity.js';
import { displayTime, getOffset, isSkewed, SKEW_WARNING_MS } from '../../src/log/clock.js';
import { idDigest } from '../../src/log/audit.js';
import { fold } from '../../src/log/fold.js';
import type { Report } from '../../src/log/types.js';

const HUNT = 'quiet-fox-8821-h7k2';

function report(id: string, kind: Report['kind'] = 'null', huntCode = HUNT): Report {
  return {
    v: 1,
    id,
    hunt_code: huntCode,
    kind,
    observer: { callsign: 'KI7XYZ' },
    position: { lat: 48.75, lon: -122.47 },
    position_source: 'measured',
    observed_at: 1_784_092_800_000,
    clock_offset_ms: null,
    entered_by: { participant_id: 'p-1', callsign: 'KI7XYZ' },
    payload: {},
  } as Report;
}

let db: FoxmapperDb;

beforeEach(async () => {
  // A fresh database per test: these assert about what persisted, so leakage would make a test
  // pass for the wrong reason.
  indexedDB = new IDBFactory();
  db = await openLogDb();
});

describe('persistence', () => {
  it('a report authored offline is durable and queued in one step', async () => {
    await putAuthored(db, report('a'));

    // Both, or neither. A force-quit between two transactions would leave a report that is stored
    // but never sent — on the reporter's map and invisible to everyone else.
    expect((await loadLog(db, HUNT)).has('a')).toBe(true);
    expect(await outboxIds(db, HUNT)).toEqual(['a']);
  });

  it('survives a force-quit — reopening finds the report', async () => {
    await putAuthored(db, report('a'));
    db.close();

    const reopened = await openLogDb();
    expect((await loadLog(reopened, HUNT)).has('a')).toBe(true);
    expect(await outboxIds(reopened, HUNT)).toEqual(['a']);
  });

  it('loads only the hunt asked for', async () => {
    await putAuthored(db, report('a'));
    await putAuthored(db, report('b', 'null', 'brisk-owl-3310-k2m9'));
    expect([...(await loadLog(db, HUNT)).keys()]).toEqual(['a']);
  });

  it('remote reports do not enter the outbox — they are already synced', async () => {
    await putRemote(db, [report('r1'), report('r2')]);
    expect(await outboxDepth(db, HUNT)).toBe(0);
    expect((await loadLog(db, HUNT)).size).toBe(2);
  });

  it('storing a report the device already holds is a no-op', async () => {
    await putAuthored(db, report('a'));
    await putRemote(db, [report('a')]);
    expect((await loadLog(db, HUNT)).size).toBe(1);
    // The outbox entry must survive: the server echoing a report back is not proof it accepted
    // this device's copy, and dropping the queue entry here would lose it on a failed flush.
    expect(await outboxIds(db, HUNT)).toEqual(['a']);
  });

  it('the outbox drains only when told', async () => {
    await putAuthored(db, report('a'));
    await putAuthored(db, report('b'));
    await clearOutbox(db, ['a']);

    expect(await outboxIds(db, HUNT)).toEqual(['b']);
    // Draining the queue never removes the report itself.
    expect((await loadLog(db, HUNT)).size).toBe(2);
  });

  it('the loaded log folds', async () => {
    await putAuthored(db, report('a', 'fix'));
    expect(fold(await loadLog(db, HUNT)).found).toBe(true);
  });

  it('the cursor round-trips', async () => {
    expect(await getMeta<number>(db, cursorKey(HUNT))).toBeUndefined();
    await setMeta(db, cursorKey(HUNT), 48);
    expect(await getMeta<number>(db, cursorKey(HUNT))).toBe(48);
  });
});

describe('identity', () => {
  it('mints a participant id on first use and keeps it', async () => {
    const first = await participantId(db);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await participantId(db)).toBe(first);
  });

  it('joining works with the network already gone', async () => {
    // There is no join endpoint to fail. Nothing below touches the network, and that is the test.
    const identity = await join(db, 'ki7xyz');
    expect(identity.callsign).toBe('KI7XYZ');
    expect(identity.participant_id).toBe(await participantId(db));
  });

  it('normalises the callsign', async () => {
    expect((await join(db, '  ki7xyz  ')).callsign).toBe('KI7XYZ');
  });

  it('there is no identity before a callsign is picked', async () => {
    expect(await currentIdentity(db)).toBeUndefined();
    await join(db, 'W7ABC');
    expect((await currentIdentity(db))?.callsign).toBe('W7ABC');
  });

  it('the id survives a reopen', async () => {
    const before = await participantId(db);
    db.close();
    expect(await participantId(await openLogDb())).toBe(before);
  });
});

describe('clock offset', () => {
  it('is null when never measured, and null is not zero', async () => {
    // Zero means "checked, and correct". Null means "nobody ever checked". Coalescing the two
    // asserts a clock is good when nothing knows that.
    expect(await getOffset(db)).toBeNull();
    expect(await getOffset(db)).not.toBe(0);
  });

  it('a never-measured clock is not reported as skewed', async () => {
    expect(isSkewed(null)).toBe(false);
  });

  it('a measured, correct clock is not skewed', () => {
    expect(isSkewed(0)).toBe(false);
  });

  it('warns above two minutes, in both directions', () => {
    expect(isSkewed(SKEW_WARNING_MS + 1)).toBe(true);
    expect(isSkewed(-SKEW_WARNING_MS - 1)).toBe(true);
    expect(isSkewed(SKEW_WARNING_MS - 1)).toBe(false);
  });

  it('display correction never touches the recorded time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }),
        fc.integer({ min: -600_000, max: 600_000 }),
        (observedAt, offset) => {
          const record = { observed_at: observedAt };
          displayTime(record.observed_at, offset);
          // The report says what the reporter's device said, forever.
          expect(record.observed_at).toBe(observedAt);
        },
      ),
    );
  });

  it('renders an unmeasured clock at face value rather than guessing', () => {
    expect(displayTime(1_784_092_800_000, null)).toBe(1_784_092_800_000);
  });

  it('subtracts a known offset for display', () => {
    expect(displayTime(1_000_000, 5_000)).toBe(995_000);
  });
});

describe('the audit digest', () => {
  /** The server's spec, restated independently. If these disagree, the audit reports divergence
   *  that isn't there — the exact failure the byte-level spec exists to prevent. */
  function serverDigest(ids: readonly string[]): string {
    const sorted = [...ids].map((i) => i.toLowerCase()).sort();
    return `sha256:${createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex')}`;
  }

  it('the digest of an empty log is the digest of the empty string', () => {
    expect(idDigest([])).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('agrees with the server on arbitrary id sets', () => {
    fc.assert(
      fc.property(fc.array(fc.uuid({ version: 4 }), { maxLength: 20 }), (ids) => {
        expect(idDigest(ids)).toBe(serverDigest(ids));
      }),
    );
  });

  it('does not depend on order', () => {
    fc.assert(
      fc.property(fc.array(fc.uuid({ version: 4 }), { maxLength: 20 }), (ids) => {
        expect(idDigest(ids)).toBe(idDigest([...ids].reverse()));
      }),
    );
  });

  it('is case-insensitive over the ids', () => {
    const id = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
    expect(idDigest([id.toUpperCase()])).toBe(idDigest([id]));
  });

  it('has no trailing newline', () => {
    const id = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
    const withTrailing = `sha256:${createHash('sha256').update(`${id}\n`, 'utf8').digest('hex')}`;
    expect(idDigest([id])).not.toBe(withTrailing);
  });
});
