/**
 * Magnetic declination from the World Magnetic Model, on-device and offline.
 *
 * **Both iOS and Android give a magnetic heading, never true.** The log requires true north
 * (feature 001 FR-009), so this always runs — it is not an optional refinement, and a bearing
 * that skipped it would be wrong by ~15° in Bellingham. Since feature 005 the conversion is also
 * *visible*: entry surfaces display true-north headings with the reference labeled, so both
 * directions of the conversion live here, side by side.
 */
import geomagnetism from 'geomagnetism';

/**
 * The frame a *displayed or entered* number is expressed in — never a property of the physical
 * direction, and never stored on a report (both headings land in every payload regardless).
 */
export type NorthReference = 'true' | 'magnetic';

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

/** Magnetic → true. Kept beside its inverse — these two are the only conversions in the app. */
export function toTrueHeading(headingMagnetic: number, declinationDegrees: number): number {
  return normalizeHeading(headingMagnetic + declinationDegrees);
}

/** True → magnetic. The inverse, for displaying a heading the way a handheld compass reads. */
export function toMagneticHeading(headingTrue: number, declinationDegrees: number): number {
  return normalizeHeading(headingTrue - declinationDegrees);
}

/**
 * The local declination in the words a hunter would use, whole degrees only — sub-degree
 * precision here would out-precise a compass that is honest to maybe a degree (Principle I).
 *
 * The model vintage appears as a year, never as "WMM": naming the model is an interop fact, and
 * interop facts stay off participant surfaces (Principle V).
 */
export function describeDeclination(d: Declination): string {
  const magnitude = Math.abs(d.degrees);
  const first =
    magnitude < 0.5
      ? 'Magnetic and true north line up here.'
      : `Magnetic north is about ${Math.round(magnitude)}° ${d.degrees > 0 ? 'east' : 'west'} of true north here.`;

  const year = /(\d{4})/.exec(d.epoch)?.[1];
  const vintage = year === undefined ? '' : ` Using the ${year} magnetic model.`;
  const staleness = d.stale
    ? ' That model is out of date, so this could be off by a fraction of a degree.'
    : '';
  return `${first}${vintage}${staleness}`;
}

/** Wraps into [0, 360). Every heading in the log is in this range. */
export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
