/**
 * Every number that decides how the location estimate reads the reports (FR-033 to FR-035).
 *
 * **This is the only place such a number may live.** A lint rule fails any other numeric literal
 * under `src/estimate/` (bar 0, 1, 2 and ½), so a tuning value cannot hide in an expression, and a
 * change to one is a change here, beside its reason, in the same diff.
 *
 * Only maintainers change these, in a release, and only when the reference hunts still pass
 * (FR-037, `tests/unit/reference-hunts.test.ts`). There is no runtime override and no per-hunt
 * value: two devices on one release must draw the same region from the same reports (FR-018).
 *
 * `docs/estimate.md` explains the model in words and links here rather than copying any number.
 */

export type StrengthBucket = 'weak' | 'medium' | 'strong';

export interface EstimateValues {
  REGION_LEVEL: number;
  GRID_CELLS_PER_SIDE: number;
  REFINE_LEVEL: number;
  REFINE_PAD_FRACTION: number;
  BEARING_SIGMA_FRACTION: number;
  BEARING_RANGE_TAPER: number;
  BEARING_FLOOR: number;
  OMNI_MEDIAN_KM: Readonly<Record<StrengthBucket, number>>;
  OMNI_STRENGTH_BUCKETS: Readonly<Record<StrengthBucket, Readonly<{ min: number; max: number }>>>;
  OMNI_LOG_SD: number;
  OMNI_REACH_KM: number;
  OMNI_FLOOR: number;
  NULL_CLEAR_INNER_KM: number;
  NULL_CLEAR_OUTER_KM: number;
  NULL_FLOOR: number;
  FIX_SIGMA_KM: number;
  FIX_FLOOR: number;
  SUPPORT_FLOOR_MULTIPLE: number;
  TOO_FEW_REPORTS: number;
  NARROW_SPREAD_DEG: number;
  SPREAD_NEAR_KM: number;
  SAME_PLACE_KM: number;
  SECOND_PLACE_SHARE: number;
  CONFLICT_AGREEMENT: number;
  EARTH_RADIUS_KM: number;
  COORDINATE_STEP_DEG: number;
}

export const ESTIMATE_VALUES: Readonly<EstimateValues> = Object.freeze({
  // ---- Region ----

  /**
   * Share of probability the drawn regions hold together. **0.9**: participants read it as "about
   * 9 times in 10". 0.95 makes the region much larger for little a hunter can act on, and 0.68 is
   * wrong one time in three (spec clarification, FR-003).
   */
  REGION_LEVEL: 0.9,

  // ---- Grid (research R4) ----

  /**
   * Cells per side of each of the two grids, in cells. **128**: a 512² grid is 16× the work for the
   * same region in almost every hunt, and the refine pass recovers the resolution a tight region
   * needs.
   */
  GRID_CELLS_PER_SIDE: 128,

  /**
   * Share of probability whose bounding box the second pass re-grids. **0.999**: wide enough that
   * the second grid loses nothing the 90% region could reach, tight enough that a find narrows a
   * 100 km first grid down to metres.
   */
  REFINE_LEVEL: 0.999,

  /**
   * Padding added on each side of the refine box, as a share of its side (plus one first-pass
   * cell). **0.1**: keeps the second grid's edge clear of the region it contours.
   */
  REFINE_PAD_FRACTION: 0.1,

  // ---- Bearing (research R2) ----

  /**
   * The angular spread of a bearing, as a share of the drawn wedge's half-width. **0.5**: the wedge
   * the map draws is then the ~95% band of the kernel, so the estimate never trusts a bearing more
   * than its wedge says (FR-014).
   */
  BEARING_SIGMA_FRACTION: 0.5,

  /**
   * The last share of its stated range over which a bearing fades out. **0.1**: full strength to
   * 90% of the range, falling to its floor at the range itself. The fade sits inside the range, so a
   * bearing never pushes probability past the distance its reporter stated (FR-004a); a hard cut
   * would draw a region edge exactly at the range, as if the range were known to the metre.
   */
  BEARING_RANGE_TAPER: 0.1,

  /**
   * The least a bearing leaves any cell, as a share of what it gives its best cell. **0.02**: one
   * report can cut an area's odds by at most 50:1. Simulated hunts gave 98.2% coverage with honest
   * reports and 97.7% with one confidently wrong bearing, for about twice the region area of a
   * near-zero floor (research R3, FR-040).
   */
  BEARING_FLOOR: 0.02,

  // ---- Signal strength (research R2) ----

  /**
   * The most likely distance to the fox for each strength bucket, in km. **Weak 8, medium 2,
   * strong 0.4**: rough 2 m figures for a 0.5–5 W fox heard on a handheld. These are the least
   * certain values in the model, and the wide `OMNI_LOG_SD` is the honest answer to that. Louder
   * pulls closer (FR-004b), so the medians fall as strength rises.
   */
  OMNI_MEDIAN_KM: Object.freeze({ weak: 8, medium: 2, strong: 0.4 }),

  /**
   * Which strength digits fall in which bucket, inclusive. **Weak 1–3, medium 4–6, strong 7–9**:
   * the thirds of the scale a hunter reports on. A digit in no bucket reads as weak, the loosest
   * claim.
   */
  OMNI_STRENGTH_BUCKETS: Object.freeze({
    weak: Object.freeze({ min: 1, max: 3 }),
    medium: Object.freeze({ min: 4, max: 6 }),
    strong: Object.freeze({ min: 7, max: 9 }),
  }),

  /**
   * Spread of the distance ring, in natural-log units. **1.2**: a factor of about 3.3 either way at
   * one standard deviation — "louder means probably closer, loosely", wide enough that mismatched
   * radios and antennas do not produce a region tighter than their reports support (FR-004b).
   */
  OMNI_LOG_SD: 1.2,

  /**
   * The farthest a signal-strength report says anything, in km. **40**: beyond this a handheld
   * report of a small fox is not credible, and the report adds only its floor.
   */
  OMNI_REACH_KM: 40,

  /**
   * The least a signal-strength report leaves any cell. **0.1**: a ring is a vaguer claim than a
   * wedge, so it may cut an area's odds by at most 10:1 (research R3).
   */
  OMNI_FLOOR: 0.1,

  // ---- Heard nothing (research R2) ----

  /**
   * Radius a "heard nothing" report clears fully, in km. **0.5**: conservative for a handheld on a
   * 2 m fox. Nobody knows the fox's power, so when unsure, rule out less (spec assumption, FR-014).
   */
  NULL_CLEAR_INNER_KM: 0.5,

  /**
   * Radius at which a "heard nothing" report stops clearing anything, in km. **1.5**: the clearing
   * falls off linearly between the inner radius and this one.
   */
  NULL_CLEAR_OUTER_KM: 1.5,

  /**
   * The least a "heard nothing" report leaves any cell. **0.25**, the highest floor of the four:
   * intermittent sources and terrain shadow make silence the least reliable claim, so it may cut an
   * area's odds by at most 4:1 (research R3).
   */
  NULL_FLOOR: 0.25,

  // ---- Found it (research R2) ----

  /**
   * Spread of a find around its position, in km. **0.1**: "I'm standing at it" plus a phone's
   * position error.
   */
  FIX_SIGMA_KM: 0.1,

  /**
   * The least a find leaves any cell. **0.02**, as a bearing: a find is the strongest evidence a
   * hunt holds, and still a wrong find can be outweighed (FR-005).
   */
  FIX_FLOOR: 0.02,

  // ---- Support (research R4) ----

  /**
   * A cell can hold the fox only where some bearing, signal-strength report or find rises above
   * this multiple of its floor. **2**: without the mask, floor-level cells far from any evidence
   * fill the region with flat ties, and "heard nothing" never creates ground (FR-015).
   */
  SUPPORT_FLOOR_MULTIPLE: 2,

  // ---- Warnings (research R6, FR-034) ----

  /**
   * Fewer bearings, signal-strength reports and finds than this raise "too few reports".
   * **3**: Principle I names it. Silence points at nothing, so "heard nothing" does not count.
   */
  TOO_FEW_REPORTS: 3,

  /**
   * An observer spread narrower than this, in degrees, raises "all point the same way". **30**:
   * below it, two crossing bearings' distance error grows past about twice their angular error.
   */
  NARROW_SPREAD_DEG: 30,

  /**
   * An observer this close to the centre of the region, in km, makes the spread warning not apply.
   * **0.5**: a station standing at the fox, or a find, is the best geometry a hunt can have.
   */
  SPREAD_NEAR_KM: 0.5,

  /**
   * Observers closer together than this, in km, count as one place for the spread warning.
   * **0.05**: three bearings from one spot cannot fix a distance.
   */
  SAME_PLACE_KM: 0.05,

  /**
   * A second region holding at least this share of the probability raises "the reports disagree".
   * **0.15**: a speck at the edge of the cut does not raise it, and a real second candidate does.
   */
  SECOND_PLACE_SHARE: 0.15,

  /**
   * The agreement level, shared across all active reports, below which one report raises "the
   * reports disagree" (FR-012a). Agreement is 0 when a report rejects the whole estimate and 1 when
   * it fully supports it. A report conflicts when its agreement falls below this divided by the
   * number of active reports: compared against the level itself, the lowest of several honest
   * reports falls short by luck. **0.1**: on simulated honest hunts of 2–14 reports, the size most
   * hunts are, it is raised in about 1% of hunts, against about 10% for the undivided level.
   */
  CONFLICT_AGREEMENT: 0.1,

  // ---- Units ----

  /**
   * Mean earth radius, in km. **6371.0088**, the value the wedge geometry uses (turf), so a bearing's
   * range means the same distance on the map and in the estimate.
   */
  EARTH_RADIUS_KM: 6371.0088,

  /**
   * Region coordinates are rounded to this step, in degrees. **1e-6**, about 11 cm: finer than any
   * claim a report makes, and it keeps the result's bytes short.
   */
  COORDINATE_STEP_DEG: 1e-6,
});
