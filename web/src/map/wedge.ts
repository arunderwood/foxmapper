/**
 * Bearing wedge geometry.
 *
 * A wedge is a claim its observer actually made: the width is their stated confidence and the
 * length is their stated range. **Never an unbounded ray** (FR-011) — both fields are required in
 * the payload, which is what makes an unbounded wedge unrepresentable rather than discouraged.
 *
 * This computes the polygon of one wedge. It does not combine two of them: there is no fusion,
 * no posterior, and no intersection anywhere in P1.
 */
import sector from '@turf/sector';
import type { Feature, Polygon } from 'geojson';
import type { BearingReport } from '../log/types.js';
import { normalizeHeading } from '../sensors/declination.js';

/**
 * Half-width per confidence bucket, from APRS101's Q table — normative for display, because
 * Xastir (the reference implementation) implements it exactly.
 *
 * The narrowest claim the interface can make is Q=5, <16°. The scale reaches Q=9 (<1°) and we
 * deliberately cannot: compass error is 10–30° near a vehicle or antenna, and a needle-thin wedge
 * would look authoritative and be fiction.
 */
const HALF_WIDTH_DEGREES: Readonly<Record<number, number>> = {
  3: 32, // <64°
  4: 16, // <32°
  5: 8, // <16°
};

const MILES_TO_KM = 1.609_344;

/** Range = 2^R miles. Ours is always 1, 3 or 5 → 2, 8 or 32 miles. */
export function rangeKm(maxRangeR: number): number {
  return 2 ** maxRangeR * MILES_TO_KM;
}

export function halfWidthDegrees(confidenceQ: number): number {
  return HALF_WIDTH_DEGREES[confidenceQ] ?? 32;
}

/**
 * The wedge as a GeoJSON polygon, drawn from the observer's position.
 *
 * `@turf/sector` takes bearings in [-180, 180] and handles the north wraparound itself, but only
 * if the arc is expressed as start → end going clockwise. A wedge centred on 0° spans 350°→10°,
 * where a naive `[start, end]` with start > end draws the 340° reflex angle instead — the whole
 * map minus the wedge.
 */
export function wedgeFor(report: BearingReport): Feature<Polygon> {
  const { heading_true, confidence_q, max_range_r } = report.payload;
  const half = halfWidthDegrees(confidence_q);

  const start = toTurfBearing(heading_true - half);
  const end = toTurfBearing(heading_true + half);

  return sector([report.position.lon, report.position.lat], rangeKm(max_range_r), start, end, {
    units: 'kilometers',
    steps: 64,
    properties: { report_id: report.id },
  });
}

/** Turf wants [-180, 180]; the log stores [0, 360). */
function toTurfBearing(degrees: number): number {
  const normalized = normalizeHeading(degrees);
  return normalized > 180 ? normalized - 360 : normalized;
}
