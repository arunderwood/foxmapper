/**
 * The fold: log → everything a participant sees.
 *
 * Principle IV requires this be "computed identically from the same log on every client", so it
 * is a pure function of the set and consults nothing else — not the clock, not the network, not
 * which reports arrived first.
 */
import type { Log, ObservationReport } from './types.js';

export interface FoldResult {
  /** Reports that stand: not retractions, not retracted. */
  active: readonly ObservationReport[];
  /** Ids named by some retraction, whether or not their target is present. */
  retracted: ReadonlySet<string>;
  /** True iff a non-retracted `fix` exists. Does not close the hunt. */
  found: boolean;
  /** Distinct observer callsigns among active reports. The roster is derived, never stored. */
  observers: ReadonlySet<string>;
}

export function fold(log: Log): FoldResult {
  // Compute `retracted` first, then filter. Do NOT walk the log marking reports as retractions
  // are found — that is order-dependent, and it will pass every test until the day a retraction
  // overtakes its target on a real network.
  const retracted = new Set<string>();
  for (const report of log.values()) {
    if (report.kind === 'retraction') retracted.add(report.payload.retracts_id);
  }

  const active: ObservationReport[] = [];
  for (const report of log.values()) {
    if (report.kind === 'retraction') continue;
    if (retracted.has(report.id)) continue;
    active.push(report);
  }

  let found = false;
  const observers = new Set<string>();
  for (const report of active) {
    if (report.kind === 'fix') found = true;
    observers.add(report.observer.callsign);
  }

  return { active, retracted, found, observers };
}
