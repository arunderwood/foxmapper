/**
 * Declination — plan.md Stage 4.2.
 *
 * Both iOS and Android hand us a **magnetic** heading and FR-009 requires true north, so this
 * conversion runs on every bearing ever recorded. It was asserted by comment only: the 2029
 * hard-throw, the epoch string the log format depends on, and the conversion itself had no test
 * anywhere. T063 checks the compass on real hardware; none of the below needs a phone.
 */
import { describe, expect, it } from 'vitest';
import { declinationAt, normalizeHeading, toTrueHeading } from '../../src/sensors/declination.js';

/** The maintainer's home ground, and the number quickstart.md tells a human to look for. */
const BELLINGHAM = { lat: 48.7519, lon: -122.4787 };

describe('declination', () => {
  it('gives Bellingham roughly 15 degrees east', () => {
    const declination = declinationAt(BELLINGHAM.lat, BELLINGHAM.lon, new Date('2026-07-15'));

    // Loose on purpose: the WMM drifts and this is not a test of the model's arithmetic. It is a
    // test that the model ran at all — a true heading equal to the magnetic one is the failure
    // this catches, and it would be silently ~15° wrong in the field.
    expect(declination.degrees).toBeGreaterThan(14);
    expect(declination.degrees).toBeLessThan(17);
    expect(declination.stale).toBe(false);
  });

  it('writes the epoch the log format expects', () => {
    // The library says "WMM-2025"; the log format says "WMM2025". A report carries this string
    // forever, so a reimplementation reading it has to find what the contract promised.
    const { epoch } = declinationAt(BELLINGHAM.lat, BELLINGHAM.lon, new Date('2026-07-15'));
    expect(epoch).toMatch(/^WMM\d{4}$/);
    expect(epoch).not.toContain('-');
  });

  it('degrades rather than throwing once the model expires', () => {
    // `geomagnetism` hard-throws past 2029-11-12. A hunter on a hilltop in 2030 with an uncaught
    // exception has no bearing entry at all; a stale model is wrong by a fraction of a degree a
    // year, against 10–30° of compass error. The wrong answer here is a crash, not a stale model.
    const expired = new Date('2030-06-01');
    expect(() => declinationAt(BELLINGHAM.lat, BELLINGHAM.lon, expired)).not.toThrow();

    const declination = declinationAt(BELLINGHAM.lat, BELLINGHAM.lon, expired);
    expect(declination.stale).toBe(true);
    // Still a usable number, and still roughly right — that is what makes degrading the honest
    // choice rather than a shrug.
    expect(declination.degrees).toBeGreaterThan(13);
    expect(declination.degrees).toBeLessThan(18);
  });

  it('says so when the model is stale, rather than quietly carrying on', () => {
    // The flag is what lets a reader tell a fresh model from an expired one. If `stale` were
    // always false the degradation would be invisible, which is the same failure as not having it.
    const fresh = declinationAt(BELLINGHAM.lat, BELLINGHAM.lon, new Date('2026-07-15'));
    const expired = declinationAt(BELLINGHAM.lat, BELLINGHAM.lon, new Date('2030-06-01'));
    expect([fresh.stale, expired.stale]).toEqual([false, true]);
  });
});

describe('magnetic to true', () => {
  it('adds the declination', () => {
    expect(toTrueHeading(0, 15.2)).toBeCloseTo(15.2);
    expect(toTrueHeading(100, -10)).toBeCloseTo(90);
  });

  it('wraps rather than running past north', () => {
    // A bearing of 355° with 15° of easterly declination is 10°, not 370°. Every heading in the
    // log is in [0, 360) and the wedge geometry depends on it.
    expect(toTrueHeading(355, 15)).toBeCloseTo(10);
    expect(toTrueHeading(5, -15)).toBeCloseTo(350);
  });

  it('normalizes anything into [0, 360)', () => {
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(-1)).toBe(359);
    expect(normalizeHeading(720.5)).toBeCloseTo(0.5);
  });
});
