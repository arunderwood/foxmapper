/**
 * Bearing entry.
 *
 * The compass **drafts** the heading and the reporter sees and can adjust it before submitting
 * (feature 001's FR-008b). That is not politeness: compass error is 10–30° near a vehicle or an
 * antenna, and a heading the reporter never saw would be a number the log attributes to them that
 * they never claimed. A bearing is a bearing, though — the log records the number, not whether it
 * came from the compass or was set by hand (004 FR-010).
 */
import type { BearingPayload, BearingReport, ConfidenceQ, MaxRangeR } from '../log/types.js';
import { declinationAt, normalizeHeading, toTrueHeading } from '../sensors/declination.js';
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
  /** What the compass said, or what the reporter set on the dial. Always magnetic. */
  heading_magnetic: number;
}

export interface BearingEntry extends AuthorContext {
  draft: BearingDraft;
  /** Both required. This is what makes an unbounded or zero-width wedge unrepresentable. */
  confidence_q: ConfidenceQ;
  max_range_r: MaxRangeR;
}

/**
 * Both magnetic and true are recorded, plus the declination and the model epoch — so the bearing
 * stays reinterpretable when the magnetic model updates. A log storing only `heading_true` would
 * assert a conversion it cannot show its work for. Where the number came from — compass, twist, or
 * keypad — is deliberately not recorded: a bearing is a bearing (004 FR-010).
 */
export function composeBearing(entry: BearingEntry): BearingReport {
  const declination = declinationAt(entry.position.lat, entry.position.lon);
  const magnetic = normalizeHeading(entry.draft.heading_magnetic);

  const payload: BearingPayload = {
    heading_true: toTrueHeading(magnetic, declination.degrees),
    heading_magnetic: magnetic,
    declination: declination.degrees,
    wmm_epoch: declination.epoch,
    confidence_q: entry.confidence_q,
    max_range_r: entry.max_range_r,
  };

  return { ...envelope(entry), kind: 'bearing', payload };
}
