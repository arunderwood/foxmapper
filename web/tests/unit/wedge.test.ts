/**
 * Wedge geometry.
 *
 * SC-004 asserts 0% unbounded wedges, and the north wraparound is the case the plan names by
 * hand. Both are geometry, so both are checkable without a browser.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import destination from '@turf/destination';
import { halfWidthDegrees, rangeKm, wedgeFor } from '../../src/map/wedge.js';
import type { BearingReport, ConfidenceQ, MaxRangeR } from '../../src/log/types.js';
import { confidenceQArb, maxRangeRArb } from './arbitraries.js';

const ORIGIN: [number, number] = [-122.4787, 48.7519]; // Bellingham

function bearing(headingTrue: number, q: ConfidenceQ = 4, r: MaxRangeR = 3): BearingReport {
  return {
    v: 1,
    id: 'a0000000-0000-4000-8000-000000000001',
    hunt_code: 'quiet-fox-8821-h7k2',
    kind: 'bearing',
    observer: { callsign: 'KI7XYZ' },
    position: { lat: ORIGIN[1], lon: ORIGIN[0] },
    position_source: 'measured',
    observed_at: 1_784_092_800_000,
    clock_offset_ms: null,
    entered_by: { participant_id: 'p-1', callsign: 'KI7XYZ' },
    payload: {
      heading_true: headingTrue,
      heading_magnetic: headingTrue - 15.2,
      declination: 15.2,
      wmm_epoch: 'WMM2025',
      confidence_q: q,
      max_range_r: r,
    },
  };
}

/** A point `km` away along `heading` from the observer. */
function along(heading: number, km: number) {
  return destination(ORIGIN, km, heading > 180 ? heading - 360 : heading, { units: 'kilometers' });
}

describe('the wedge covers what its observer claimed', () => {
  it('contains a point along the reported heading', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 359 }),
        confidenceQArb,
        maxRangeRArb,
        (heading, q, r) => {
          const wedge = wedgeFor(bearing(heading, q, r));
          const inside = along(heading, rangeKm(r) * 0.5);
          expect(booleanPointInPolygon(inside, wedge)).toBe(true);
        },
      ),
    );
  });

  it('excludes the opposite direction', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 359 }), (heading) => {
        const wedge = wedgeFor(bearing(heading));
        const behind = along((heading + 180) % 360, 5);
        expect(booleanPointInPolygon(behind, wedge)).toBe(false);
      }),
    );
  });

  it('handles the 350° → 10° north wraparound', () => {
    // The case the plan names by hand: a naive [start, end] with start > end draws the 340°
    // reflex angle — the whole map minus the wedge.
    const wedge = wedgeFor(bearing(0, 5)); // Q=5 → ±8°, so 352° to 8°
    expect(booleanPointInPolygon(along(0, 5), wedge)).toBe(true);
    expect(booleanPointInPolygon(along(355, 5), wedge)).toBe(true);
    expect(booleanPointInPolygon(along(5, 5), wedge)).toBe(true);
    // Just outside the arc, and the direction a reflex-angle bug would wrongly include.
    expect(booleanPointInPolygon(along(90, 5), wedge)).toBe(false);
    expect(booleanPointInPolygon(along(180, 5), wedge)).toBe(false);
    expect(booleanPointInPolygon(along(270, 5), wedge)).toBe(false);
  });

  it('does not draw a reflex angle for any heading', () => {
    // The general form of the bug above: a wedge must never contain a point 90° off its heading.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 359 }), confidenceQArb, (heading, q) => {
        const wedge = wedgeFor(bearing(heading, q));
        expect(booleanPointInPolygon(along((heading + 90) % 360, 3), wedge)).toBe(false);
        expect(booleanPointInPolygon(along((heading + 270) % 360, 3), wedge)).toBe(false);
      }),
    );
  });
});

describe('the wedge is bounded — SC-004', () => {
  it('excludes a point beyond the reported range, for every bucket', () => {
    // FR-011: never an unbounded ray. The length is a claim its observer made, not a default
    // wearing their name.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 359 }), maxRangeRArb, (heading, r) => {
        const wedge = wedgeFor(bearing(heading, 4, r));
        const beyond = along(heading, rangeKm(r) * 1.2);
        expect(booleanPointInPolygon(beyond, wedge)).toBe(false);
      }),
    );
  });

  it('is a closed polygon with finite coordinates', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 359 }), confidenceQArb, maxRangeRArb, (h, q, r) => {
        const ring = wedgeFor(bearing(h, q, r)).geometry.coordinates[0]!;
        expect(ring.length).toBeGreaterThan(3);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        for (const [lon, lat] of ring) {
          expect(Number.isFinite(lon)).toBe(true);
          expect(Number.isFinite(lat)).toBe(true);
        }
      }),
    );
  });

  it('has non-zero width — a zero-width wedge is unrepresentable', () => {
    for (const q of [3, 4, 5] as const) {
      expect(halfWidthDegrees(q)).toBeGreaterThan(0);
    }
  });
});

describe('the honesty cap, as geometry', () => {
  it('the narrowest wedge the interface can draw is 16° wide', () => {
    // Q=5 is the best we allow. Compass error is 10–30° near metal, so a narrower claim would
    // manufacture precision at the moment the hunter is least able to judge it.
    expect(halfWidthDegrees(5) * 2).toBe(16);
    expect(halfWidthDegrees(4) * 2).toBe(32);
    expect(halfWidthDegrees(3) * 2).toBe(64);
  });

  it('a wider confidence bucket draws a wider wedge', () => {
    expect(halfWidthDegrees(3)).toBeGreaterThan(halfWidthDegrees(4));
    expect(halfWidthDegrees(4)).toBeGreaterThan(halfWidthDegrees(5));
  });

  it('range buckets are 2, 8 and 32 miles', () => {
    expect(rangeKm(1) / 1.609344).toBeCloseTo(2);
    expect(rangeKm(3) / 1.609344).toBeCloseTo(8);
    expect(rangeKm(5) / 1.609344).toBeCloseTo(32);
  });
});
