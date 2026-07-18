/**
 * Tour state (contracts/tour-state.md): whether this device has seen the tour.
 *
 * Held in the device-scoped IndexedDB `meta` store via `getMeta`/`setMeta`, exactly like
 * `relay_mode` — never in the report log, never synced, tied to no account (Principle IV, Cost of
 * entry). A missing record reads as `unseen`, which is what drives the first-run offer.
 */
import type { FoxmapperDb } from '../../log/store.js';
import { getMeta, setMeta } from '../../log/store.js';

/**
 * The tour's content version. Bumped when the walkthrough materially changes.
 *
 * **A bump does not re-offer the tour** (FR-013). It is stamped into `TourState` on a terminal
 * transition so a future, deliberate decision could re-surface a materially changed tour — but that
 * decision is out of scope here, and raising this number alone never turns a `completed`/`declined`
 * record back into `unseen`. Returning participants reach the current tour through the relaunch
 * affordance in Settings (FR-003).
 */
export const TOUR_VERSION = 1;

const TOUR_STATE_KEY = 'tour_state';

export type TourStatus = 'unseen' | 'completed' | 'declined';

export interface TourState {
  status: TourStatus;
  /** The `TOUR_VERSION` this device last saw. `0` on the `unseen` default. */
  version: number;
  updatedAt: number;
}

/** The stand-in for a device that holds no record yet. Returned by value so callers cannot alias it. */
const UNSEEN: TourState = { status: 'unseen', version: 0, updatedAt: 0 };

/** Pure read. A missing record is the `unseen` default, never an error. */
export async function readTourState(db: FoxmapperDb): Promise<TourState> {
  return (await getMeta<TourState>(db, TOUR_STATE_KEY)) ?? { ...UNSEEN };
}

/** Reaching the final step. Suppresses the unprompted re-offer for good (FR-013). */
export async function markCompleted(db: FoxmapperDb): Promise<void> {
  await setMeta(db, TOUR_STATE_KEY, {
    status: 'completed',
    version: TOUR_VERSION,
    updatedAt: Date.now(),
  } satisfies TourState);
}

/**
 * Declining the offer, or exiting a first-run tour before the end. Also terminal: a hunter who
 * waved the tour away is not asked again on the next visit (FR-013). A relaunch from Settings never
 * calls this — see main.ts.
 */
export async function markDeclined(db: FoxmapperDb): Promise<void> {
  await setMeta(db, TOUR_STATE_KEY, {
    status: 'declined',
    version: TOUR_VERSION,
    updatedAt: Date.now(),
  } satisfies TourState);
}
