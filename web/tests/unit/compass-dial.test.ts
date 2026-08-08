/**
 * The dial's pure geometry and damping (feature 003, research R2/R3).
 *
 * These are the parts a headless test can pin: the DOM component is exercised end-to-end in
 * tests/e2e/compass-dial.spec.ts. What matters here is that damping does not jump across north and
 * that a pointer sweep maps to a heading the way the twist relies on.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createHeadingSmoother,
  pointerBearing,
  twistHeading,
} from '../../src/ui/compass-dial.js';
import { toTrueHeading } from '../../src/sensors/declination.js';

// Angle folding is normalizeHeading (sensors/declination.ts), covered by declination.test.ts.

describe('createHeadingSmoother', () => {
  it('is undefined until the first sample', () => {
    const s = createHeadingSmoother();
    expect(s.value()).toBeUndefined();
  });

  it('snaps to the first sample, then eases toward later ones', () => {
    const s = createHeadingSmoother(200);
    expect(s.push(90, 0)).toBeCloseTo(90);
    const next = s.push(120, 50); // one 50 ms step at τ=200 ms → partway, not all the way
    expect(next).toBeGreaterThan(90);
    expect(next).toBeLessThan(120);
  });

  it('does not swing the long way round when crossing north', () => {
    const s = createHeadingSmoother(200);
    s.push(350, 0);
    // Easing from 350 toward 10 must pass through ~0/360, never through 180.
    const v = s.push(10, 100);
    const nearNorth = v > 340 || v < 20;
    expect(nearNorth).toBe(true);
  });

  it('converges to a steady heading under repeated samples', () => {
    const s = createHeadingSmoother(100);
    s.push(200, 0);
    let v = 200;
    for (let i = 0; i < 50; i++) v = s.push(45, 50);
    expect(v).toBeCloseTo(45, 1);
  });

  it('smoothing pre-converted samples converges on the true heading, wrap included (005)', () => {
    // The dial feeds the smoother toTrueHeading(sample, decl) — the screenshot case: a steady
    // magnetic 344.5° under +15.5°E must settle at 0° true, through the wrap, converted once.
    const s = createHeadingSmoother(100);
    let v = s.push(toTrueHeading(344.5, 15.5), 0);
    for (let i = 0; i < 50; i++) v = s.push(toTrueHeading(344.5, 15.5), 50);
    const nearNorth = v > 359.99 || v < 0.01;
    expect(nearNorth).toBe(true);
  });
});

describe('pointerBearing', () => {
  it('reads 0° straight up, 90° right, 180° down, 270° left', () => {
    expect(pointerBearing(0, 0, 0, -10)).toBeCloseTo(0);
    expect(pointerBearing(0, 0, 10, 0)).toBeCloseTo(90);
    expect(pointerBearing(0, 0, 0, 10)).toBeCloseTo(180);
    expect(pointerBearing(0, 0, -10, 0)).toBeCloseTo(270);
  });
});

describe('twistHeading', () => {
  it('moves the heading by the finger sweep (grab-and-follow)', () => {
    // Sweeping the finger 30° clockwise moves the value under the index by 30° the other way.
    expect(twistHeading(100, 0, 30)).toBeCloseTo(70);
    expect(twistHeading(100, 30, 0)).toBeCloseTo(130);
  });

  it('stays in [0, 360) across the wrap', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        (start, from, to) => {
          const h = twistHeading(start, from, to);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(360);
        },
      ),
    );
  });
});
