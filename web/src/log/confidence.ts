/**
 * What a confidence digit and a range digit actually claim.
 *
 * **The one normative copy of both tables.** The wedge geometry and the on-air mapping each need
 * them, and each used to carry its own: two copies of the table that caps what a wedge may claim
 * agree right up until one is edited, and the cost of that divergence is a wedge drawn narrower
 * than its reporter said — Principle I failing by arithmetic.
 *
 * It lives here, in the log layer, rather than in either module that reads it. The log stores
 * `confidence_q` and `max_range_r` as raw digits, so what those digits *mean* is a property of the
 * format, not of the map that draws them or the wire that carries them. Putting it in `aprs/` would
 * force the rendering path to import the mapping module — and the reason no protocol vocabulary
 * reaches the shipped bundle is precisely that nothing rendering pulls that module in.
 *
 * Nothing here is protocol vocabulary: these are numbers, and no participant-facing surface renders
 * any of them.
 */
import type { ConfidenceQ, MaxRangeR, WireDigit } from './types.js';

/**
 * APRS101's Q table: the full angular width each confidence digit claims, in degrees. Normative for
 * display, because Xastir — the reference implementation — implements it exactly.
 *
 * The narrowest claim our interface can make is Q=5, <16°. The scale reaches Q=9 (<1°) and we
 * deliberately cannot: compass error is 10–30° near a vehicle or an antenna, so a needle-thin wedge
 * would look authoritative and be fiction.
 *
 * Q=0 is absent on purpose — the two specs disagree on whether it means "useless" or "OMNI", so it
 * has no width rather than a guessed one.
 */
const Q_FULL_WIDTH_DEGREES: Readonly<Record<number, number>> = {
  1: 240,
  2: 120,
  3: 64,
  4: 32,
  5: 16,
  6: 8,
  7: 4,
  8: 2,
  9: 1,
};

/**
 * Half of the wedge's angular width, or `null` for a digit with no defined width (Q=0).
 *
 * Null rather than a fallback: a caller drawing geometry has to decide what an unreadable
 * confidence deserves, and that decision should be visible where it is made rather than buried in
 * a default here.
 */
export function wedgeHalfWidthDegrees(q: WireDigit | ConfidenceQ): number | null {
  const full = Q_FULL_WIDTH_DEGREES[q];
  return full === undefined ? null : full / 2;
}

/**
 * The widest half-width the scale defines — Q=1's 240°, so 120°.
 *
 * The honest rendering of a confidence nobody can read: it claims the least of any width the table
 * offers. **Derived from the table rather than written down**, because the one thing worse than a
 * wrong fallback is a fallback that silently stops matching the table it claims to come from.
 */
export const WIDEST_HALF_WIDTH_DEGREES = Math.max(...Object.values(Q_FULL_WIDTH_DEGREES)) / 2;

/** Range in miles: 2^R. Ours is always 1, 3 or 5 → 2, 8 or 32 miles. */
export function rangeMiles(r: WireDigit | MaxRangeR): number {
  return 2 ** r;
}
