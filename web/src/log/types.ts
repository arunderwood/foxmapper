/**
 * Report types per contracts/log-format.md.
 *
 * The narrow unions here are the honesty cap expressed in the type system: an interface that
 * could author `confidence_q: 8` would render a needle-thin wedge that is fiction. Ingested
 * reports accept the full on-air range and keep it raw — see `WireFields`.
 */

/** Format version. Bumped only when an existing field changes meaning. */
export const FORMAT_VERSION = 1;

export type ReportKind = 'bearing' | 'omni' | 'null' | 'fix' | 'retraction';

/** Whose observation it is. Colour is derived from the callsign and never stored. */
export interface Observer {
  callsign: string;
}

/** Who typed it. Distinct from the observer whenever a report was relayed. */
export interface EnteredBy {
  participant_id: string;
  callsign: string;
}

export interface Position {
  lat: number;
  lon: number;
}

export type PositionSource = 'measured' | 'placed';

export type HeadingSource = 'compass' | 'manual';

/**
 * Raw APRS Q digit. Authored reports are capped at {3,4,5} — worst <64°, best <16°.
 * Compass error is 10–30° near metal, so the scale's <1° steps are unreachable on purpose.
 */
export type ConfidenceQ = 3 | 4 | 5;

/** Raw APRS R digit. Authored reports use {1,3,5} → 2, 8, or 32 miles. */
export type MaxRangeR = 1 | 3 | 5;

/** Raw APRS s digit. Authored reports use {2,5,8}. 0 is not valid here — that is a `null` report. */
export type StrengthS = 2 | 5 | 8;

/** Any digit the air may hand us. Retained raw; never clamped to the authored range. */
export type WireDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Raw on-air fields, present only on ingested reports. The `raw` string is the escape hatch:
 * if our parse was wrong, the original survives, and it wins over the parsed digits on re-emit.
 */
export type WireFields =
  | {
      format: 'DF';
      raw: string;
      n?: WireDigit;
      r?: WireDigit;
      q?: WireDigit;
    }
  | {
      format: 'DFS';
      raw: string;
      s?: WireDigit;
      h?: WireDigit;
      g?: WireDigit;
      d?: WireDigit;
    }
  | {
      format: 'third-party';
      raw: string;
    };

export interface BearingPayload {
  heading_true: number;
  heading_magnetic: number;
  declination: number;
  wmm_epoch: string;
  heading_source: HeadingSource;
  /** iOS `webkitCompassAccuracy` only. Android exposes no equivalent. */
  compass_accuracy_deg?: number;
  confidence_q: ConfidenceQ;
  max_range_r: MaxRangeR;
}

export interface OmniPayload {
  strength_s: StrengthS;
}

/** "I heard nothing here." Kind + position + time is the whole claim. */
export type NullPayload = Record<string, never>;

/** "I found it, here, then." Does not close the hunt. */
export type FixPayload = Record<string, never>;

export interface RetractionPayload {
  retracts_id: string;
}

interface ReportBase {
  v: typeof FORMAT_VERSION;
  id: string;
  hunt_code: string;
  observer: Observer;
  position: Position;
  position_source: PositionSource;
  /** Advisory only. The platforms disagree on what percentile it means — never compute on it. */
  position_accuracy_m?: number;
  /** When the observation happened, from the authoring device's clock. Not when it was typed. */
  observed_at: number;
  /** Device clock minus true time. `null` means never measured — which is not zero. */
  clock_offset_ms: number | null;
  entered_by: EnteredBy;
  /** Present only on ingested reports. Authored reports compute their on-air form on demand. */
  wire?: WireFields;
}

export interface BearingReport extends ReportBase {
  kind: 'bearing';
  payload: BearingPayload;
}

export interface OmniReport extends ReportBase {
  kind: 'omni';
  payload: OmniPayload;
}

/** The wire value is the string "null". It is not a JS null and must not be "fixed". */
export interface NullReport extends ReportBase {
  kind: 'null';
  payload: NullPayload;
}

export interface FixReport extends ReportBase {
  kind: 'fix';
  payload: FixPayload;
}

export interface RetractionReport extends ReportBase {
  kind: 'retraction';
  payload: RetractionPayload;
}

export type Report = BearingReport | OmniReport | NullReport | FixReport | RetractionReport;

/** A report that makes a claim about the world. Retractions are facts about other reports. */
export type ObservationReport = BearingReport | OmniReport | NullReport | FixReport;

/** The log is a set keyed by id. Merge is union; there is no conflict to resolve. */
export type Log = ReadonlyMap<string, Report>;

/**
 * Derived, never stored: a stored flag can disagree with the two names it summarises.
 * Net control relaying their own observation is therefore automatically not relayed.
 */
export function isRelayed(report: Report): boolean {
  return report.observer.callsign !== report.entered_by.callsign;
}

// There is deliberately no `isRetraction` guard. `kind === 'retraction'` narrows the union on its
// own everywhere it is asked (see fold.ts), and a guard that only restates the discriminant is one
// more place for the two to drift apart.
