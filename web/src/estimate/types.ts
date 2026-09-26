/**
 * The estimate's input and result (specs/006-location-estimate/data-model.md §1, §3, §4).
 *
 * Nothing here is stored or sent: the result is derived state, recomputed from the log on every
 * device (FR-022). The input holds only what the kernels read, so the estimate cannot weight a
 * report by its age, clock, position accuracy, hand placement or relay — it never receives them
 * (FR-006, FR-008, FR-009).
 */
import type { MultiPolygon } from 'geojson';
import type { Position, WireDigit } from '../log/types.js';

export interface BearingInput {
  kind: 'bearing';
  id: string;
  position: Position;
  heading_true: number;
  /** Raw digit: an ingested report may carry one the interface cannot author. */
  confidence_q: WireDigit;
  max_range_r: WireDigit;
}

export interface OmniInput {
  kind: 'omni';
  id: string;
  position: Position;
  strength_s: WireDigit;
}

export interface NullInput {
  kind: 'null';
  id: string;
  position: Position;
}

export interface FixInput {
  kind: 'fix';
  id: string;
  position: Position;
}

export type EstimateReport = BearingInput | OmniInput | NullInput | FixInput;

/** A report that claims to have heard the fox. Only these can create ground for the region. */
export type PositiveReport = BearingInput | OmniInput | FixInput;

export interface EstimateInput {
  /** Active reports only, sorted by `id` ascending. */
  reports: EstimateReport[];
  /** Increments per request; a result for an older generation is dropped. */
  generation: number;
}

export interface Region {
  /** Longitude/latitude, rounded. Holes are ground a "heard nothing" cleared. */
  geometry: MultiPolygon;
  /** Share of the whole estimate's probability inside this region. */
  probability: number;
}

/** The measured value behind each warning (FR-036). */
export interface EstimateMetrics {
  positive_reports: number;
  /** `null` when an observer stands within reach of the centre: the spread warning does not apply. */
  observer_span_deg: number | null;
  second_place_share: number;
  /** One aggregate minimum. No per-report agreement leaves the module (FR-026). */
  min_agreement: number;
  /** Every active report, "heard nothing" included: how many chances one had to fall short. */
  active_reports: number;
}

export type WarningKind = 'too_few' | 'narrow_spread' | 'disagree';

export interface EstimateResult {
  generation: number;
  status: 'none' | 'estimate';
  regions: Region[];
  level: number;
  metrics: EstimateMetrics;
  /** Stable order: too_few, narrow_spread, disagree. */
  warnings: WarningKind[];
  /** SHA-256 of the canonical values, so a result names the release that produced it. */
  values_digest: string;
}
