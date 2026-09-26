/**
 * What each report kind claims, as a kernel over the ground (research R2, FR-004 to FR-005, FR-040).
 *
 * Kernels are evaluated in the local plane, in km, with the observer at the origin, so every claim
 * below reads as geometry: east is +x, north is +y, and a heading of 90° points along +x.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  isSupported,
  kernel,
  logKernel,
  multiplyRow,
  prepare,
  ratio,
  reachBox,
  supportBox,
} from '../../src/estimate/kernels.js';
import type { EstimateReport } from '../../src/estimate/types.js';
import { ESTIMATE_VALUES as V } from '../../src/estimate/values.js';
import { rangeKm, WIDEST_HALF_WIDTH_DEGREES } from '../../src/log/confidence.js';
import type { WireDigit } from '../../src/log/types.js';

const ORIGIN = { x: 0, y: 0 };
const HERE = { lat: 48.75, lon: -122.48 };

function bearing(heading: number, q: WireDigit = 4, r: WireDigit = 3): EstimateReport {
  return {
    kind: 'bearing',
    id: 'b',
    position: HERE,
    heading_true: heading,
    confidence_q: q,
    max_range_r: r,
  };
}
function omni(s: WireDigit): EstimateReport {
  return { kind: 'omni', id: 'o', position: HERE, strength_s: s };
}
const heardNothing: EstimateReport = { kind: 'null', id: 'n', position: HERE };
const found: EstimateReport = { kind: 'fix', id: 'f', position: HERE };

/** A point `d` km from the origin in compass direction `deg`. */
function at(deg: number, d: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: d * Math.sin(rad), y: d * Math.cos(rad) };
}

const distance = fc.double({ min: 0.001, max: 120, noNaN: true });
const direction = fc.double({ min: 0, max: 359.99, noNaN: true });
const point = fc.record({
  x: fc.double({ min: -120, max: 120, noNaN: true }),
  y: fc.double({ min: -120, max: 120, noNaN: true }),
});

const FLOORS: [EstimateReport, number][] = [
  [bearing(37), V.BEARING_FLOOR],
  [bearing(200, 5, 1), V.BEARING_FLOOR],
  [omni(2), V.OMNI_FLOOR],
  [omni(8), V.OMNI_FLOOR],
  [heardNothing, V.NULL_FLOOR],
  [found, V.FIX_FLOOR],
];

describe('every kernel (FR-040)', () => {
  it.each(FLOORS)('%o never falls below its floor, nor rises above 1', (report, floor) => {
    const p = prepare(report, ORIGIN, V);
    fc.assert(
      fc.property(point, ({ x, y }) => {
        const k = kernel(p, x, y);
        return k >= floor && k <= 1;
      }),
    );
  });

  it.each(FLOORS)('%o agrees with its own log form', (report) => {
    const p = prepare(report, ORIGIN, V);
    fc.assert(
      fc.property(
        point,
        ({ x, y }) => Math.abs(Math.exp(logKernel(p, x, y)) - kernel(p, x, y)) < 1e-12,
      ),
    );
  });

  it.each(FLOORS)('%o is exactly its floor outside its reach box', (report, floor) => {
    const p = prepare(report, ORIGIN, V);
    const box = reachBox(p);
    if (!box) return;
    for (const [x, y] of [
      [box.maxX + 0.01, 0],
      [box.minX - 0.01, 0],
      [0, box.maxY + 0.01],
      [0, box.minY - 0.01],
    ] as const) {
      expect(kernel(p, x, y)).toBe(report.kind === 'null' ? 1 : floor);
    }
  });
});

describe('bearing (FR-004a)', () => {
  it('is highest along its heading', () => {
    fc.assert(
      fc.property(
        direction,
        fc.double({ min: 0.1, max: 12, noNaN: true }),
        fc.double({ min: 1, max: 179, noNaN: true }),
        (heading, d, off) => {
          const p = prepare(bearing(heading), ORIGIN, V);
          const on = at(heading, d);
          const aside = at(heading + off, d);
          return kernel(p, on.x, on.y) > kernel(p, aside.x, aside.y);
        },
      ),
    );
  });

  it('adds only its floor at and beyond its stated range', () => {
    fc.assert(
      fc.property(
        direction,
        fc.constantFrom<WireDigit>(1, 3, 5),
        fc.double({ min: 1, max: 3, noNaN: true }),
        (heading, r, beyond) => {
          const p = prepare(bearing(heading, 5, r), ORIGIN, V);
          const far = at(heading, rangeKm(r) * beyond);
          return kernel(p, far.x, far.y) === V.BEARING_FLOOR;
        },
      ),
    );
  });

  it('keeps its full strength until it fades out inside the stated range', () => {
    const p = prepare(bearing(90, 4, 3), ORIGIN, V);
    const fadeFrom = rangeKm(3) * (1 - V.BEARING_RANGE_TAPER);
    const full = at(90, fadeFrom * 0.999);
    const fading = at(90, (fadeFrom + rangeKm(3)) / 2);
    expect(kernel(p, full.x, full.y)).toBeCloseTo(1, 10);
    expect(kernel(p, fading.x, fading.y)).toBeLessThan(1);
    expect(kernel(p, fading.x, fading.y)).toBeGreaterThan(V.BEARING_FLOOR);
  });

  it('reads a confidence nobody can read at the widest width', () => {
    const unreadable = prepare(bearing(0, 0), ORIGIN, V);
    const widest = prepare(bearing(0, 1), ORIGIN, V);
    expect(WIDEST_HALF_WIDTH_DEGREES).toBe(120);
    for (const off of [10, 45, 90, 135]) {
      const q = at(off, 2);
      expect(kernel(unreadable, q.x, q.y)).toBe(kernel(widest, q.x, q.y));
    }
  });

  it('puts about 95% of its angular band inside the drawn wedge', () => {
    // σ = half-width × 0.5, so the wedge edge sits at 2σ.
    const p = prepare(bearing(0, 4), ORIGIN, V);
    const edge = at(16, 3);
    const k = kernel(p, edge.x, edge.y);
    const a = (k - V.BEARING_FLOOR) / (1 - V.BEARING_FLOOR);
    expect(a).toBeGreaterThan(Math.exp(-2.2));
    expect(a).toBeLessThan(Math.exp(-1.8));
  });
});

describe('signal strength (FR-004b)', () => {
  const byBucket: [WireDigit, number][] = [
    [2, V.OMNI_MEDIAN_KM.weak],
    [5, V.OMNI_MEDIAN_KM.medium],
    [8, V.OMNI_MEDIAN_KM.strong],
  ];

  it.each(byBucket)('strength %i peaks at its bucket median', (s, median) => {
    const p = prepare(omni(s), ORIGIN, V);
    expect(kernel(p, median, 0)).toBeCloseTo(1, 12);
    expect(kernel(p, median * 0.9, 0)).toBeLessThan(kernel(p, median, 0));
    expect(kernel(p, median * 1.1, 0)).toBeLessThan(kernel(p, median, 0));
  });

  it('pulls a louder report harder at small distances', () => {
    const weak = prepare(omni(2), ORIGIN, V);
    const medium = prepare(omni(5), ORIGIN, V);
    const strong = prepare(omni(8), ORIGIN, V);
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: V.OMNI_MEDIAN_KM.strong, noNaN: true }),
        direction,
        (d, deg) => {
          const q = at(deg, d);
          return (
            kernel(strong, q.x, q.y) >= kernel(medium, q.x, q.y) &&
            kernel(medium, q.x, q.y) >= kernel(weak, q.x, q.y)
          );
        },
      ),
    );
  });

  it('says nothing about direction', () => {
    const p = prepare(omni(5), ORIGIN, V);
    fc.assert(
      fc.property(distance, direction, direction, (d, a, b) => {
        const qa = at(a, d);
        const qb = at(b, d);
        return Math.abs(kernel(p, qa.x, qa.y) - kernel(p, qb.x, qb.y)) < 1e-9;
      }),
    );
  });

  it('adds only its floor beyond its reach', () => {
    const p = prepare(omni(2), ORIGIN, V);
    expect(kernel(p, V.OMNI_REACH_KM * 1.01, 0)).toBe(V.OMNI_FLOOR);
  });
});

describe('heard nothing (FR-004c)', () => {
  const p = prepare(heardNothing, ORIGIN, V);

  it('never raises any place', () => {
    fc.assert(fc.property(point, ({ x, y }) => kernel(p, x, y) <= 1));
  });

  it('lowers its own spot to the floor and leaves the ground past the outer radius alone', () => {
    expect(kernel(p, 0, 0)).toBe(V.NULL_FLOOR);
    expect(kernel(p, V.NULL_CLEAR_INNER_KM * 0.99, 0)).toBe(V.NULL_FLOOR);
    expect(kernel(p, V.NULL_CLEAR_OUTER_KM * 1.01, 0)).toBe(1);
  });

  it('never creates ground for the fox (FR-015)', () => {
    expect(supportBox(p)).toBeNull();
    fc.assert(fc.property(point, ({ x, y }) => !isSupported(p, x, y)));
  });
});

describe('found it (FR-005)', () => {
  const p = prepare(found, ORIGIN, V);

  it('is highest at its position', () => {
    expect(kernel(p, 0, 0)).toBe(1);
    fc.assert(
      fc.property(distance, direction, (d, deg) => {
        const q = at(deg, d);
        return kernel(p, q.x, q.y) < 1;
      }),
    );
  });

  it('leaves every other place at least its floor, so a wrong find can be outweighed', () => {
    fc.assert(fc.property(point, ({ x, y }) => kernel(p, x, y) >= V.FIX_FLOOR));
  });

  it('widens to the grid it is drawn on, never narrows', () => {
    const coarse = prepare(found, ORIGIN, V, 0.8);
    expect(kernel(coarse, 0.5, 0)).toBeGreaterThan(kernel(p, 0.5, 0));
    expect(kernel(coarse, 0, 0)).toBe(1);
  });
});

describe('support (research R4)', () => {
  it('holds exactly where a positive kernel rises above twice its floor', () => {
    for (const report of [bearing(123), omni(5), found]) {
      const p = prepare(report, ORIGIN, V);
      const floor = FLOORS.find(([r]) => r.kind === report.kind)![1];
      fc.assert(
        fc.property(
          point,
          ({ x, y }) => isSupported(p, x, y) === kernel(p, x, y) > V.SUPPORT_FLOOR_MULTIPLE * floor,
        ),
      );
    }
  });

  it('fits inside the support box', () => {
    for (const report of [bearing(300, 3, 5), omni(2), omni(8), found]) {
      const p = prepare(report, ORIGIN, V);
      const box = supportBox(p)!;
      fc.assert(
        fc.property(
          point,
          ({ x, y }) =>
            !isSupported(p, x, y) ||
            (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY),
        ),
      );
    }
  });
});

describe('the grid’s row loop', () => {
  it.each(FLOORS)('%o multiplies exactly the ratio, bit for bit', (report) => {
    const p = prepare(report, ORIGIN, V);
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -60, max: 0, noNaN: true }),
        fc.double({ min: 0.001, max: 2, noNaN: true }),
        (y, x0, cell) => {
          const n = 64;
          const product = new Float64Array(n).fill(1);
          const supported = new Uint8Array(n);
          multiplyRow(p, y, x0, cell, 0, n - 1, 0, product, supported);
          for (let i = 0; i < n; i++) {
            const r = ratio(p, x0 + (i + 0.5) * cell, y);
            if (!Object.is(product[i], r)) return false;
            if ((supported[i] === 1) !== r > p.supportRatio) return false;
          }
          return true;
        },
      ),
    );
  });
});
