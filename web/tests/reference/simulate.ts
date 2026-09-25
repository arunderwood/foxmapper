/**
 * Seeded simulated hunts (research R9, data-model.md §6).
 *
 * Each report's error is drawn from the distribution its stated confidence claims: a bearing's
 * heading misses by the spread its wedge implies, a signal-strength report is heard at a distance
 * its strength bucket makes likely, and a "heard nothing" is filed only where the fox could honestly
 * go unheard. A simulated hunt therefore proves the estimate agrees with its own assumptions — not
 * that it is right in the field (FR-039). Fixed seeds make every run identical, so a failure is a
 * change, not bad luck.
 *
 * Test data only: nothing here ships in the app bundle.
 */
import type { EstimateReport, WarningKind } from '../../src/estimate/types.js';
import { ESTIMATE_VALUES as V } from '../../src/estimate/values.js';
import { rangeKm, wedgeHalfWidthDegrees } from '../../src/log/confidence.js';
import type { WireDigit } from '../../src/log/types.js';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface ReferenceExpectation {
  status?: 'none' | 'estimate';
  /** The fox lies inside one of the drawn regions. */
  foxInside?: boolean;
  /** Each of these warnings is raised. */
  warnings?: WarningKind[];
  /** None of these warnings is raised. */
  absent?: WarningKind[];
  /** Exactly this many regions. */
  regions?: number;
}

export interface ReferenceHunt {
  name: string;
  source: 'simulated' | 'recorded';
  fox: LatLon;
  reports: EstimateReport[];
  expect?: ReferenceExpectation;
}

/** mulberry32: a small, fast, seeded PRNG with a uniform output in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw (Box–Muller). */
export function normal(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const KM_PER_DEG_LAT = (Math.PI / 180) * V.EARTH_RADIUS_KM;

/** The point `km` from `from` in compass direction `deg`, on a local flat earth. */
export function offset(from: LatLon, deg: number, km: number): LatLon {
  const rad = (deg * Math.PI) / 180;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((from.lat * Math.PI) / 180);
  return {
    lat: from.lat + (km * Math.cos(rad)) / KM_PER_DEG_LAT,
    lon: from.lon + (km * Math.sin(rad)) / kmPerDegLon,
  };
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Report ids shaped like the UUIDs the log uses, ordered by a per-hunt counter. */
export class Ids {
  #next = 0;
  constructor(readonly prefix: number) {}
  next(): string {
    const n = this.#next++;
    const tail = (this.prefix * 100_000 + n).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${tail}`;
  }
}

/** The smallest range digit that honestly covers `km`. */
function rangeDigitFor(km: number): WireDigit {
  for (const r of [1, 3, 5] as const) if (rangeKm(r) >= km) return r;
  return 5;
}

export interface BearingOptions {
  /** Compass direction from the fox to the observer. */
  from: number;
  km: number;
  q?: WireDigit;
  r?: WireDigit;
  /** A fixed miss, in degrees. Drawn from the wedge's own spread when absent. */
  errorDeg?: number;
}

export function bearingAt(
  rng: () => number,
  ids: Ids,
  fox: LatLon,
  o: BearingOptions,
): EstimateReport {
  const q = o.q ?? 4;
  const sigma = (wedgeHalfWidthDegrees(q) ?? 120) * V.BEARING_SIGMA_FRACTION;
  const error = o.errorDeg ?? normal(rng) * sigma;
  return {
    kind: 'bearing',
    id: ids.next(),
    position: offset(fox, o.from, o.km),
    heading_true: normalizeDeg(o.from + 180 + error),
    confidence_q: q,
    max_range_r: o.r ?? rangeDigitFor(o.km),
  };
}

const BUCKET_DIGIT = { weak: 2, medium: 5, strong: 8 } as const;
type Bucket = keyof typeof BUCKET_DIGIT;
const BUCKETS: Bucket[] = ['weak', 'medium', 'strong'];

/** The signal-strength kernel's shape: how well a bucket fits a fox `km` away. */
function ring(bucket: Bucket, km: number): number {
  if (km <= 0 || km > V.OMNI_REACH_KM) return 0;
  const l = Math.log(km / V.OMNI_MEDIAN_KM[bucket]);
  return Math.exp(-(l * l) / (2 * V.OMNI_LOG_SD * V.OMNI_LOG_SD));
}

export function omniAt(
  ids: Ids,
  fox: LatLon,
  o: { from: number; km: number; bucket: Bucket },
): EstimateReport {
  return {
    kind: 'omni',
    id: ids.next(),
    position: offset(fox, o.from, o.km),
    strength_s: BUCKET_DIGIT[o.bucket],
  };
}

/**
 * A signal-strength report from a hunter `km` from the fox, heard at a strength drawn from how well
 * each bucket fits that distance. The strength is the observation, so it is what gets drawn — just as
 * a bearing's heading is — and the hunter stands wherever they happen to be.
 */
export function heardAt(
  rng: () => number,
  ids: Ids,
  fox: LatLon,
  o: { from: number; km: number },
): EstimateReport {
  const weights = BUCKETS.map((b) => ring(b, o.km));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = rng() * total;
  let bucket: Bucket = 'weak';
  for (let i = 0; i < BUCKETS.length; i++) {
    pick -= weights[i]!;
    if (pick < 0) {
      bucket = BUCKETS[i]!;
      break;
    }
  }
  return omniAt(ids, fox, { ...o, bucket });
}

export function nullAt(ids: Ids, fox: LatLon, o: { from: number; km: number }): EstimateReport {
  return { kind: 'null', id: ids.next(), position: offset(fox, o.from, o.km) };
}

/** A find, off the fox by the spread a find claims. */
export function fixAt(rng: () => number, ids: Ids, fox: LatLon, at?: LatLon): EstimateReport {
  const position =
    at ?? offset(offset(fox, 0, normal(rng) * V.FIX_SIGMA_KM), 90, normal(rng) * V.FIX_SIGMA_KM);
  return { kind: 'fix', id: ids.next(), position };
}

/** How much of the fox's odds silence at `km` claims to clear: the null kernel's own shape. */
function cleared(km: number): number {
  if (km <= V.NULL_CLEAR_INNER_KM) return 1;
  if (km >= V.NULL_CLEAR_OUTER_KM) return 0;
  return (V.NULL_CLEAR_OUTER_KM - km) / (V.NULL_CLEAR_OUTER_KM - V.NULL_CLEAR_INNER_KM);
}

/** A "heard nothing" somewhere within `maxKm`, filed only where silence is honest. */
export function honestNull(
  rng: () => number,
  ids: Ids,
  fox: LatLon,
  maxKm: number,
): EstimateReport {
  for (;;) {
    const km = rng() * maxKm;
    if (rng() >= cleared(km)) return nullAt(ids, fox, { from: rng() * 360, km });
  }
}

const HOME: LatLon = { lat: 48.7519, lon: -122.4787 };

/** A fox near the home ground, somewhere different for every seed. */
export function foxFor(rng: () => number): LatLon {
  return { lat: HOME.lat + (rng() - 0.5) * 0.4, lon: HOME.lon + (rng() - 0.5) * 0.4 };
}

/**
 * Random hunts: 2–8 reports that heard the fox and 0–6 that heard nothing, around a fox. Mostly
 * bearings and signal strength, with the occasional find.
 */
export function calibrationBatch(seed: number, count: number): ReferenceHunt[] {
  const rng = mulberry32(seed);
  const hunts: ReferenceHunt[] = [];
  for (let h = 0; h < count; h++) {
    const ids = new Ids(h);
    const fox = foxFor(rng);
    const reports: EstimateReport[] = [];
    const positives = 2 + Math.floor(rng() * 7);
    for (let i = 0; i < positives; i++) {
      const roll = rng();
      if (roll < 0.6) {
        reports.push(
          bearingAt(rng, ids, fox, {
            from: rng() * 360,
            km: 0.3 + rng() * 15,
            q: ([3, 4, 5] as const)[Math.floor(rng() * 3)]!,
          }),
        );
      } else if (roll < 0.95) {
        reports.push(heardAt(rng, ids, fox, { from: rng() * 360, km: 0.1 + rng() * 15 }));
      } else {
        reports.push(fixAt(rng, ids, fox));
      }
    }
    const nulls = Math.floor(rng() * 7);
    for (let i = 0; i < nulls; i++) reports.push(honestNull(rng, ids, fox, 12));
    hunts.push({ name: `calibration-${seed}-${h}`, source: 'simulated', fox, reports });
  }
  return hunts;
}

/**
 * A hunt of `bearings` bearings, `heard` signal-strength reports and `nulls` "heard nothing"
 * reports around one fox, every one honest by its own stated confidence.
 */
export function mixedHunt(
  seed: number,
  counts: { bearings: number; heard: number; nulls: number },
  name = `mixed-${seed}`,
): ReferenceHunt {
  const rng = mulberry32(seed);
  const ids = new Ids(seed);
  const fox = foxFor(rng);
  const reports: EstimateReport[] = [
    ...Array.from({ length: counts.bearings }, () =>
      bearingAt(rng, ids, fox, {
        from: rng() * 360,
        km: 0.5 + rng() * 15,
        q: ([3, 4, 5] as const)[Math.floor(rng() * 3)]!,
      }),
    ),
    ...Array.from({ length: counts.heard }, () =>
      heardAt(rng, ids, fox, { from: rng() * 360, km: 0.1 + rng() * 15 }),
    ),
    ...Array.from({ length: counts.nulls }, () => honestNull(rng, ids, fox, 12)),
  ];
  return { name, source: 'simulated', fox, reports };
}

/** The mix SC-002 sizes the estimate for: 150 bearings, 150 signal reports, 200 "heard nothing". */
export const FIVE_HUNDRED = { bearings: 150, heard: 150, nulls: 200 };
