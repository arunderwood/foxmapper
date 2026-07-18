/**
 * The drift surface (contracts/tour-drift-check.md).
 *
 * This is the one file both the running tour and the drift test read. `anchors` is every
 * `data-testid` the steps depend on; the test asserts each still exists in `web/src`. `coveredKinds`
 * is the set of contribute kinds the tour teaches; `uncoveredKinds` is the terminal kind it
 * deliberately leaves out. Together they must account for **every** report kind the app ships, so a
 * new way to contribute cannot slip in without the tour covering it — or a maintainer consciously
 * excluding it (FR-016–FR-019, SC-008).
 */
import type { ReportKind } from '../report-entry.js';
import { STEPS } from './steps.js';

/** Every `data-testid` any step points at (the anchorless `finish` contributes none). */
export const anchors: string[] = STEPS.map((step) => step.anchor).filter(
  (anchor): anchor is string => anchor !== undefined,
);

/** The three first-class ways to contribute evidence to the estimate (Principle II, FR-008). */
export const coveredKinds: ReportKind[] = ['bearing', 'omni', 'null'];

/**
 * `fix` — "found the fox" — is the end of a hunt, not a way to contribute evidence to the estimate,
 * so the first-visit tour leaves it out (FR-021). It is named here so the drift test can prove the
 * omission is deliberate: `coveredKinds ∪ uncoveredKinds` must equal the app's whole report-kind
 * set, which means a genuinely new contribute kind forces a covered-or-consciously-excluded decision
 * before the change is done.
 */
export const uncoveredKinds: ReportKind[] = ['fix'];
