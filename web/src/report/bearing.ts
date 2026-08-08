/**
 * Bearing entry.
 *
 * The compass **drafts** the heading and the reporter sees and can adjust it before submitting
 * (feature 001's FR-008b). That is not politeness: compass error is 10–30° near a vehicle or an
 * antenna, and a heading the reporter never saw would be a number the log attributes to them that
 * they never claimed. A bearing is a bearing, though — the log records the number, not whether it
 * came from the compass or was set by hand (004 FR-010).
 *
 * Since feature 005 a draft names the reference its number is expressed in (true or magnetic),
 * because entry surfaces now display true north with the reference labeled (005 FR-002/FR-005).
 * The reference is a draft-time input only: both headings land in every payload, and which one was
 * entered is deliberately not recorded — a bearing is still a bearing.
 */
import type { BearingPayload, BearingReport, ConfidenceQ, MaxRangeR } from '../log/types.js';
import {
  normalizeHeading,
  toMagneticHeading,
  toTrueHeading,
  type Declination,
  type NorthReference,
} from '../sensors/declination.js';
import { envelope, type AuthorContext } from './author.js';

/**
 * Three buckets, in the hunter's words. The APRS scale reaches <1°, and we deliberately cannot:
 * a button offering that would render a needle-thin wedge that looks authoritative and is fiction.
 */
export const CONFIDENCE_CHOICES = [
  { q: 3 as ConfidenceQ, label: 'Rough guess' },
  { q: 4 as ConfidenceQ, label: 'Fairly sure' },
  { q: 5 as ConfidenceQ, label: 'Very sure' },
] as const;

/** Three buckets → 2, 8 or 32 miles. Ten targets is unhittable with a gloved thumb in ten seconds. */
export const RANGE_CHOICES = [
  { r: 1 as MaxRangeR, label: 'Close — within a couple of miles' },
  { r: 3 as MaxRangeR, label: 'Middling — within about eight miles' },
  { r: 5 as MaxRangeR, label: 'Far — could be thirty miles out' },
] as const;

export interface BearingDraft {
  /** What the dial displayed and the reporter vouched for, expressed in `reference`. */
  heading: number;
  reference: NorthReference;
}

export interface BearingEntry extends AuthorContext {
  draft: BearingDraft;
  /**
   * The declination the entry surface displayed with — computed once at sheet-open from the
   * report's origin position, so the conversion the reporter previewed and the one stored here
   * are the same number by construction (005 research R2).
   */
  declination: Declination;
  /** Both required. This is what makes an unbounded or zero-width wedge unrepresentable. */
  confidence_q: ConfidenceQ;
  max_range_r: MaxRangeR;
}

/**
 * Both magnetic and true are recorded, plus the declination and the model epoch — so the bearing
 * stays reinterpretable when the magnetic model updates. A log storing only `heading_true` would
 * assert a conversion it cannot show its work for.
 *
 * The **entered value is stored verbatim in its own field** and the counterpart is derived
 * (005 FR-003): the number the reporter saw and the number the log carries are identical by
 * construction, never by round-trip luck.
 */
export function composeBearing(entry: BearingEntry): BearingReport {
  const entered = normalizeHeading(entry.draft.heading);
  const declination = entry.declination;

  const payload: BearingPayload = {
    heading_true:
      entry.draft.reference === 'true' ? entered : toTrueHeading(entered, declination.degrees),
    heading_magnetic:
      entry.draft.reference === 'magnetic'
        ? entered
        : toMagneticHeading(entered, declination.degrees),
    declination: declination.degrees,
    wmm_epoch: declination.epoch,
    confidence_q: entry.confidence_q,
    max_range_r: entry.max_range_r,
  };

  return { ...envelope(entry), kind: 'bearing', payload };
}
