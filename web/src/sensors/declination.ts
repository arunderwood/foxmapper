/**
 * Magnetic declination from the World Magnetic Model, on-device and offline.
 *
 * **Both iOS and Android give a magnetic heading, never true.** FR-009 requires true north, so
 * this always runs — it is not an optional refinement, and a bearing that skipped it would be
 * wrong by ~15° in Bellingham.
 */
import geomagnetism from 'geomagnetism';

export interface Declination {
  /** Signed degrees to add to a magnetic heading to get true. */
  degrees: number;
  /** Which model produced it, e.g. "WMM2025". Recorded on every bearing. */
  epoch: string;
  /**
   * True when the model is being used outside its validity window.
   *
   * The bearing is still recorded and still rendered — a stale model is wrong by a fraction of a
   * degree per year, and compass error is 10–30°. Refusing to compute would be the larger error.
   */
  stale: boolean;
}

/**
 * The WMM expires hard: `geomagnetism` **throws** past 2029-11-12 rather than extrapolating.
 *
 * Catching it is not defensive padding. A hunter on a hilltop in 2030 with an uncaught exception
 * has no bearing entry at all, and the honest degradation — an out-of-date model, marked as
 * out-of-date — is better than a crash by every measure Principle I cares about.
 */
export function declinationAt(lat: number, lon: number, at: Date = new Date()): Declination {
  try {
    const model = geomagnetism.model(at);
    return {
      degrees: model.point([lat, lon]).decl,
      epoch: normalizeEpoch(model.name),
      stale: false,
    };
  } catch {
    // Out of the model's window. Fall back to the nearest model we have and say so.
    const model = geomagnetism.model(at, { allowOutOfBoundsModel: true });
    return {
      degrees: model.point([lat, lon]).decl,
      epoch: normalizeEpoch(model.name),
      stale: true,
    };
  }
}

/** The library reports "WMM-2025"; the log format writes "WMM2025". */
function normalizeEpoch(name: string): string {
  return name.replace('-', '');
}

/** Magnetic → true. The one conversion FR-009 requires, kept in one place. */
export function toTrueHeading(headingMagnetic: number, declinationDegrees: number): number {
  return normalizeHeading(headingMagnetic + declinationDegrees);
}

/** Wraps into [0, 360). Every heading in the log is in this range. */
export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
