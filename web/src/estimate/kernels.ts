/**
 * One kernel per report kind: how strongly a report says "the fox is here" at each point
 * (research R2).
 *
 * Every kernel lies between its floor and 1. The floor is what keeps one report from ruling out
 * ground the others support (FR-040): a cell a report contradicts keeps at least that share of what
 * the report gives its best cell.
 *
 * Points are in the local plane (grid.ts), in km: +x east, +y north. A report is prepared once, so
 * the per-report constants — heading vector, spread, range — are not recomputed for every cell.
 */
import { rangeKm, wedgeHalfWidthDegrees, WIDEST_HALF_WIDTH_DEGREES } from '../log/confidence.js';
import { cos, exp, ln, sin, toRadians } from './detmath.js';

/** ln of the gap between 1 and the next double: the scale of "no change" to a ratio near 1. */
const LN_EPSILON = ln(Number.EPSILON);

/** See `negligibleBelow`. The extra 1 leaves a factor-of-e margin under half an ulp. */
function negligibleBelow(lift: number): number {
  return lift > 0 ? LN_EPSILON - ln(lift) - 1 : -Infinity;
}
import type { EstimateReport } from './types.js';
import type { EstimateValues, StrengthBucket } from './values.js';

/** An axis-aligned box in the local plane, in km. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Common {
  report: EstimateReport;
  /** The observer, in the local plane. */
  x: number;
  y: number;
  floor: number;
  lnFloor: number;
  /** A ratio (see `ratio`) above this is support: ground where the fox can be. */
  supportRatio: number;
  /** (1 − floor) / floor: how far the shape lifts a positive kernel above its floor. */
  lift: number;
  /**
   * An exponent below which `exp` cannot move the ratio off exactly 1: lift × e^x is then under half
   * an ulp of 1, and 1 + lift × e^x rounds to 1. Skipping `exp` there changes no bit of the result.
   */
  negligibleBelow: number;
}

interface PreparedBearing extends Common {
  kind: 'bearing';
  /** Unit vector along the heading: east, north. */
  hx: number;
  hy: number;
  kappa: number;
  /** Where the bearing starts to fade: full strength inside, nothing but its floor past reach. */
  fadeFromKm: number;
  /** The stated range itself (FR-004a). */
  reachKm: number;
}

interface PreparedOmni extends Common {
  kind: 'omni';
  medianKm: number;
  /** 1 / (2 s²), for the log-normal ring. */
  ringScale: number;
  reachKm: number;
  supportKm: number;
}

interface PreparedNull extends Common {
  kind: 'null';
  innerKm: number;
  outerKm: number;
}

interface PreparedFix extends Common {
  kind: 'fix';
  /** 1 / (2 σ²). */
  spotScale: number;
  supportKm: number;
}

export type PreparedReport = PreparedBearing | PreparedOmni | PreparedNull | PreparedFix;

function bucketOf(strength: number, values: EstimateValues): StrengthBucket {
  const buckets = values.OMNI_STRENGTH_BUCKETS;
  for (const bucket of ['strong', 'medium', 'weak'] as const) {
    if (strength >= buckets[bucket].min && strength <= buckets[bucket].max) return bucket;
  }
  // A digit in no bucket makes the loosest claim the scale has.
  return 'weak';
}

/**
 * Where a peaked kernel rises above its support level, as a multiple of its natural width: the
 * shape (a ring or a spot) exceeds `t` within √(−2 ln t) widths. `null` when it never does.
 */
function supportWidths(floor: number, values: EstimateValues): number | null {
  const t = ((values.SUPPORT_FLOOR_MULTIPLE - 1) * floor) / (1 - floor);
  if (t >= 1) return null;
  return Math.sqrt(2 * -ln(t));
}

/**
 * Prepares a report whose observer stands at `at` in the local plane.
 *
 * `resolutionKm` is the grid spacing the kernel will be sampled at. A find narrower than one cell
 * would fall between cell centres and vanish, so its spot widens to at least one cell. That only
 * ever makes the estimate claim less, never more (FR-014).
 */
export function prepare(
  report: EstimateReport,
  at: { x: number; y: number },
  values: EstimateValues,
  resolutionKm = 0,
): PreparedReport {
  const common = { report, x: at.x, y: at.y };

  switch (report.kind) {
    case 'bearing': {
      const floor = values.BEARING_FLOOR;
      const halfWidth = wedgeHalfWidthDegrees(report.confidence_q) ?? WIDEST_HALF_WIDTH_DEGREES;
      const sigma = toRadians(halfWidth) * values.BEARING_SIGMA_FRACTION;
      const heading = toRadians(report.heading_true);
      const range = rangeKm(report.max_range_r);
      return {
        ...common,
        kind: 'bearing',
        floor,
        lnFloor: ln(floor),
        supportRatio: values.SUPPORT_FLOOR_MULTIPLE,
        lift: (1 - floor) / floor,
        negligibleBelow: negligibleBelow((1 - floor) / floor),
        hx: sin(heading),
        hy: cos(heading),
        kappa: 1 / (sigma * sigma),
        fadeFromKm: range * (1 - values.BEARING_RANGE_TAPER),
        reachKm: range,
      };
    }
    case 'omni': {
      const floor = values.OMNI_FLOOR;
      const median = values.OMNI_MEDIAN_KM[bucketOf(report.strength_s, values)];
      const widths = supportWidths(floor, values);
      const reach = values.OMNI_REACH_KM;
      return {
        ...common,
        kind: 'omni',
        floor,
        lnFloor: ln(floor),
        supportRatio: values.SUPPORT_FLOOR_MULTIPLE,
        lift: (1 - floor) / floor,
        negligibleBelow: negligibleBelow((1 - floor) / floor),
        medianKm: median,
        ringScale: 1 / (2 * values.OMNI_LOG_SD * values.OMNI_LOG_SD),
        reachKm: reach,
        supportKm: widths === null ? 0 : Math.min(reach, median * exp(values.OMNI_LOG_SD * widths)),
      };
    }
    case 'null': {
      const floor = values.NULL_FLOOR;
      return {
        ...common,
        kind: 'null',
        floor,
        lnFloor: ln(floor),
        // Silence points at nothing: it never makes ground (FR-004c, FR-015).
        supportRatio: Infinity,
        lift: 0,
        negligibleBelow: -Infinity,
        innerKm: values.NULL_CLEAR_INNER_KM,
        outerKm: values.NULL_CLEAR_OUTER_KM,
      };
    }
    case 'fix': {
      const floor = values.FIX_FLOOR;
      const sigma = Math.max(values.FIX_SIGMA_KM, resolutionKm);
      const widths = supportWidths(floor, values);
      return {
        ...common,
        kind: 'fix',
        floor,
        lnFloor: ln(floor),
        supportRatio: values.SUPPORT_FLOOR_MULTIPLE,
        lift: (1 - floor) / floor,
        negligibleBelow: negligibleBelow((1 - floor) / floor),
        spotScale: 1 / (2 * sigma * sigma),
        supportKm: widths === null ? 0 : sigma * widths,
      };
    }
  }
}

/** The kernel's shape at a point, before the floor: between 0 and 1. */
function shape(p: PreparedReport, x: number, y: number): number {
  const dx = x - p.x;
  const dy = y - p.y;
  const d2 = dx * dx + dy * dy;

  switch (p.kind) {
    case 'bearing': {
      const d = Math.sqrt(d2);
      if (d >= p.reachKm) return 0;
      const along = d <= p.fadeFromKm ? 1 : (p.reachKm - d) / (p.reachKm - p.fadeFromKm);
      if (d === 0) return along;
      // von Mises in the offset from the heading: exp(κ(cos Δ − 1)), 1 on the heading itself.
      const cosOffset = (dx * p.hx + dy * p.hy) / d;
      return exp(p.kappa * (cosOffset - 1)) * along;
    }
    case 'omni': {
      const d = Math.sqrt(d2);
      if (d === 0 || d > p.reachKm) return 0;
      const l = ln(d / p.medianKm);
      return exp(-l * l * p.ringScale);
    }
    case 'null': {
      // The share of the fox's odds this report clears: all of it inside the inner radius, none
      // past the outer one.
      const d = Math.sqrt(d2);
      if (d <= p.innerKm) return 1;
      if (d >= p.outerKm) return 0;
      return (p.outerKm - d) / (p.outerKm - p.innerKm);
    }
    case 'fix':
      return exp(-d2 * p.spotScale);
  }
}

/** The kernel at a point: between the report's floor and 1. */
export function kernel(p: PreparedReport, x: number, y: number): number {
  const s = shape(p, x, y);
  if (p.kind === 'null') return 1 - (1 - p.floor) * s;
  return p.floor + (1 - p.floor) * s;
}

export function logKernel(p: PreparedReport, x: number, y: number): number {
  return ln(kernel(p, x, y));
}

/**
 * The kernel divided by its resting value: 1 outside the reach box, between 1 and 1/floor for a
 * positive report, between the floor and 1 for "heard nothing". Ratios multiply without the log a
 * kernel would need, which is most of the estimate's cost.
 */
export function ratio(p: PreparedReport, x: number, y: number): number {
  const s = shape(p, x, y);
  if (p.kind === 'null') return 1 - (1 - p.floor) * s;
  return 1 + p.lift * s;
}

/** True where the report makes ground the fox can stand on. Never for "heard nothing". */
export function isSupported(p: PreparedReport, x: number, y: number): boolean {
  return ratio(p, x, y) > p.supportRatio;
}

function around(p: PreparedReport, radius: number): Box {
  return { minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius };
}

/** The square the report's support fits in. `null` for a report that supports nothing. */
export function supportBox(p: PreparedReport): Box | null {
  switch (p.kind) {
    case 'bearing':
      return around(p, p.reachKm);
    case 'omni':
      return p.supportKm > 0 ? around(p, p.supportKm) : null;
    case 'fix':
      return p.supportKm > 0 ? around(p, p.supportKm) : null;
    case 'null':
      return null;
  }
}

/**
 * The square outside which the kernel is exactly its resting value — the floor, or 1 for "heard
 * nothing". `null` when no such edge exists: a find's spot never reaches exactly zero.
 */
export function reachBox(p: PreparedReport): Box | null {
  switch (p.kind) {
    case 'bearing':
      return around(p, p.reachKm);
    case 'omni':
      return around(p, p.reachKm);
    case 'null':
      return around(p, p.outerKm);
    case 'fix':
      return null;
  }
}

/** The log of the kernel's resting value outside its reach box. */
export function restingLog(p: PreparedReport): number {
  return p.kind === 'null' ? 0 : p.lnFloor;
}

/**
 * Multiplies one report's ratio into one row of cells — centres at `y` and at x0 + (i + ½) × cell for
 * i from i0 to i1 — and marks the cells it supports. The arithmetic is `ratio`'s, operation for
 * operation, so every product is bit-identical to what `ratio` gives; only the dispatch on kind moves
 * out of the loop, which is where the estimate spends its time.
 */
export function multiplyRow(
  p: PreparedReport,
  y: number,
  x0: number,
  cell: number,
  i0: number,
  i1: number,
  row: number,
  product: Float64Array,
  supported: Uint8Array,
): void {
  const dy = y - p.y;
  const dy2 = dy * dy;
  switch (p.kind) {
    case 'bearing':
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + 0.5) * cell - p.x;
        const d = Math.sqrt(dx * dx + dy2);
        if (d >= p.reachKm) continue;
        const along = d <= p.fadeFromKm ? 1 : (p.reachKm - d) / (p.reachKm - p.fadeFromKm);
        let s = along;
        if (d !== 0) {
          const a = p.kappa * ((dx * p.hx + dy * p.hy) / d - 1);
          if (a < p.negligibleBelow) continue;
          s = exp(a) * along;
        }
        const r = 1 + p.lift * s;
        product[row + i] = product[row + i]! * r;
        if (r > p.supportRatio) supported[row + i] = 1;
      }
      return;
    case 'omni':
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + 0.5) * cell - p.x;
        const d = Math.sqrt(dx * dx + dy2);
        if (d === 0 || d > p.reachKm) continue;
        const l = ln(d / p.medianKm);
        const a = -l * l * p.ringScale;
        if (a < p.negligibleBelow) continue;
        const r = 1 + p.lift * exp(a);
        product[row + i] = product[row + i]! * r;
        if (r > p.supportRatio) supported[row + i] = 1;
      }
      return;
    case 'null':
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + 0.5) * cell - p.x;
        const d = Math.sqrt(dx * dx + dy2);
        if (d >= p.outerKm) continue;
        const s = d <= p.innerKm ? 1 : (p.outerKm - d) / (p.outerKm - p.innerKm);
        product[row + i] = product[row + i]! * (1 - (1 - p.floor) * s);
      }
      return;
    case 'fix':
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + 0.5) * cell - p.x;
        const a = -(dx * dx + dy2) * p.spotScale;
        if (a < p.negligibleBelow) continue;
        const r = 1 + p.lift * exp(a);
        product[row + i] = product[row + i]! * r;
        if (r > p.supportRatio) supported[row + i] = 1;
      }
      return;
  }
}
