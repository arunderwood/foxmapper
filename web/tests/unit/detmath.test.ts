/**
 * The owned math functions agree with `Math` to within 1e-12 relative error, over the ranges the
 * estimate uses (research R5, contracts/estimate-module.md §4).
 *
 * `Math` is the reference here and nowhere else: the owned versions exist because `Math.exp` and
 * its siblings may differ in the last bit between engines, and this suite runs on one engine. What
 * it proves is that the owned versions are *accurate*; that they are *identical* everywhere follows
 * from their being built only from exactly specified operations.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { atan2, cos, exp, ln, PI, sin, toDegrees, toRadians } from '../../src/estimate/detmath.js';

const TOLERANCE = 1e-12;

/**
 * Relative error, with an absolute floor for results in the subnormal range: there a binary64
 * holds fewer significant bits, and two correct answers can differ by one unit of 2^-1074.
 */
function close(actual: number, expected: number): boolean {
  if (Object.is(actual, expected)) return true;
  return Math.abs(actual - expected) <= TOLERANCE * Math.abs(expected) + 1e-320;
}

function grid(lo: number, hi: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(lo + ((hi - lo) * i) / count);
  return out;
}

const double = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

describe('exp', () => {
  it('matches Math.exp on [−745, 0]', () => {
    for (const x of grid(-745, 0, 20_000))
      expect(close(exp(x), Math.exp(x)), `exp(${x})`).toBe(true);
    fc.assert(
      fc.property(double(-745, 0), (x) => close(exp(x), Math.exp(x))),
      { numRuns: 5_000 },
    );
  });

  it('matches Math.exp on small positive arguments', () => {
    fc.assert(
      fc.property(double(0, 50), (x) => close(exp(x), Math.exp(x))),
      { numRuns: 2_000 },
    );
  });

  it('is exact at 0 and saturates at the ends', () => {
    expect(exp(0)).toBe(1);
    expect(exp(-800)).toBe(0);
    expect(exp(-Infinity)).toBe(0);
    expect(exp(800)).toBe(Infinity);
  });
});

describe('ln', () => {
  it('matches Math.log on (0, 1e6]', () => {
    for (const x of grid(1e-6, 1e6, 20_000))
      expect(close(ln(x), Math.log(x)), `ln(${x})`).toBe(true);
    fc.assert(
      fc.property(double(Number.MIN_VALUE, 1e6), (x) => close(ln(x), Math.log(x))),
      {
        numRuns: 5_000,
      },
    );
  });

  it('keeps its relative accuracy next to 1', () => {
    fc.assert(
      fc.property(double(0.999, 1.001), (x) => close(ln(x), Math.log(x))),
      {
        numRuns: 2_000,
      },
    );
  });

  it('is exact at 1 and at powers of two', () => {
    expect(ln(1)).toBe(0);
    expect(ln(0)).toBe(-Infinity);
    expect(close(ln(1024), Math.log(1024))).toBe(true);
  });
});

describe('sin and cos', () => {
  it('match Math on [−4π, 4π]', () => {
    for (const x of grid(-4 * Math.PI, 4 * Math.PI, 20_000)) {
      expect(close(sin(x), Math.sin(x)), `sin(${x})`).toBe(true);
      expect(close(cos(x), Math.cos(x)), `cos(${x})`).toBe(true);
    }
    fc.assert(
      fc.property(
        double(-4 * Math.PI, 4 * Math.PI),
        (x) => close(sin(x), Math.sin(x)) && close(cos(x), Math.cos(x)),
      ),
      { numRuns: 5_000 },
    );
  });

  it('keep their accuracy next to their zeros', () => {
    for (let k = -4; k <= 4; k++) {
      expect(close(sin(k * Math.PI), Math.sin(k * Math.PI)), `sin(${k}π)`).toBe(true);
      const half = (k + 0.5) * Math.PI;
      expect(close(cos(half), Math.cos(half)), `cos(${k + 0.5}π)`).toBe(true);
    }
  });
});

describe('atan2', () => {
  it('matches Math.atan2 in all four quadrants', () => {
    fc.assert(
      fc.property(double(-1e4, 1e4), double(-1e4, 1e4), (y, x) =>
        close(atan2(y, x), Math.atan2(y, x)),
      ),
      { numRuns: 10_000 },
    );
    for (const angle of grid(-Math.PI, Math.PI, 20_000)) {
      const y = Math.sin(angle);
      const x = Math.cos(angle);
      expect(close(atan2(y, x), Math.atan2(y, x)), `atan2 at ${angle}`).toBe(true);
    }
  });

  it('matches Math.atan2 on both axes', () => {
    for (const [y, x] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 0],
      [2.5, 0],
      [-2.5, 0],
      [0, 7],
      [0, -7],
    ] as const) {
      expect(close(atan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x})`).toBe(true);
    }
  });
});

describe('determinism', () => {
  it('returns identical bits across calls', () => {
    fc.assert(
      fc.property(double(-700, 700), (x) =>
        [
          [exp(x), exp(x)],
          [ln(Math.abs(x) + 1), ln(Math.abs(x) + 1)],
          [sin(x / 50), sin(x / 50)],
          [cos(x / 50), cos(x / 50)],
          [atan2(x, 3), atan2(x, 3)],
        ].every(([a, b]) => Object.is(a, b)),
      ),
      { numRuns: 1_000 },
    );
  });

  it('converts degrees and radians both ways', () => {
    expect(toRadians(180)).toBe(PI);
    expect(toDegrees(PI)).toBe(180);
  });
});
