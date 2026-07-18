/**
 * Tour state transitions (contracts/tour-state.md, FR-013).
 *
 * The whole point of this record is to decide whether the first-run offer appears, so every test
 * here is a statement about what a later `readTourState` sees. It lives in the device-scoped `meta`
 * store — no account, no network — which is why `fake-indexeddb` is the entire world it needs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';

import { openLogDb, setMeta, type FoxmapperDb } from '../../src/log/store.js';
import {
  markCompleted,
  markDeclined,
  readTourState,
  TOUR_VERSION,
} from '../../src/ui/tour/state.js';

let db: FoxmapperDb;

beforeEach(async () => {
  // A fresh database per test: these assert about what persisted, so leakage would pass a test for
  // the wrong reason.
  indexedDB = new IDBFactory();
  db = await openLogDb();
});

describe('tour state', () => {
  it('reads a missing record as unseen — the offer shows on a fresh device', async () => {
    const state = await readTourState(db);
    expect(state.status).toBe('unseen');
    expect(state.version).toBe(0);
  });

  it('records completion at the current tour version', async () => {
    await markCompleted(db);
    const state = await readTourState(db);
    expect(state.status).toBe('completed');
    expect(state.version).toBe(TOUR_VERSION);
  });

  it('records a decline at the current tour version', async () => {
    await markDeclined(db);
    const state = await readTourState(db);
    expect(state.status).toBe('declined');
    expect(state.version).toBe(TOUR_VERSION);
  });

  it('is a pure read — a relaunch that only reads state leaves it intact', async () => {
    await markCompleted(db);
    await readTourState(db);
    await readTourState(db);
    // Exiting a relaunched tour records nothing (main.ts), so the terminal status must survive
    // any number of reads.
    expect((await readTourState(db)).status).toBe('completed');
  });

  it('does not re-offer after a version bump: an older completed record still reads as seen', async () => {
    // A device that finished an earlier tour holds a record stamped with a lower version. Raising
    // TOUR_VERSION must NOT turn that back into `unseen` (FR-013) — the offer gates on status alone.
    await setMeta(db, 'tour_state', {
      status: 'completed',
      version: TOUR_VERSION - 1,
      updatedAt: 1,
    });
    const state = await readTourState(db);
    expect(state.status).toBe('completed');
    expect(state.status).not.toBe('unseen');
  });

  it('does not re-offer after a version bump: an older declined record still reads as seen', async () => {
    await setMeta(db, 'tour_state', {
      status: 'declined',
      version: TOUR_VERSION - 1,
      updatedAt: 1,
    });
    expect((await readTourState(db)).status).toBe('declined');
  });
});
