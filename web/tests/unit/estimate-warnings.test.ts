/**
 * Each warning fires on its side of its named threshold and not on the other (research R6,
 * FR-010 to FR-012a, FR-034).
 */
import { describe, expect, it } from 'vitest';
import type { EstimateMetrics } from '../../src/estimate/types.js';
import { ESTIMATE_VALUES as V } from '../../src/estimate/values.js';
import { warningsFor } from '../../src/estimate/warnings.js';

/** Metrics that raise nothing: plenty of reports, wide spread, one place, full agreement. */
const QUIET: EstimateMetrics = {
  positive_reports: 10,
  observer_span_deg: 180,
  second_place_share: 0,
  min_agreement: 1,
  active_reports: 1,
};

function warn(overrides: Partial<EstimateMetrics>) {
  return warningsFor({ ...QUIET, ...overrides }, V);
}

describe('warnings', () => {
  it('raises nothing on good geometry', () => {
    expect(warn({})).toEqual([]);
  });

  it('too_few: below the report count, not at it (FR-010)', () => {
    expect(warn({ positive_reports: V.TOO_FEW_REPORTS - 1 })).toContain('too_few');
    expect(warn({ positive_reports: V.TOO_FEW_REPORTS })).not.toContain('too_few');
  });

  it('narrow_spread: below the angle, not at it (FR-011)', () => {
    expect(warn({ observer_span_deg: V.NARROW_SPREAD_DEG - 0.001 })).toContain('narrow_spread');
    expect(warn({ observer_span_deg: V.NARROW_SPREAD_DEG })).not.toContain('narrow_spread');
  });

  it('narrow_spread never applies when an observer stands at the centre', () => {
    expect(warn({ observer_span_deg: null })).not.toContain('narrow_spread');
  });

  it('disagree: a second place at the share, not just under it (FR-012)', () => {
    expect(warn({ second_place_share: V.SECOND_PLACE_SHARE })).toContain('disagree');
    expect(warn({ second_place_share: V.SECOND_PLACE_SHARE - 0.001 })).not.toContain('disagree');
  });

  it('disagree: one report below the agreement level, not at it (FR-012a)', () => {
    expect(warn({ min_agreement: V.CONFLICT_AGREEMENT - 0.001 })).toContain('disagree');
    expect(warn({ min_agreement: V.CONFLICT_AGREEMENT })).not.toContain('disagree');
  });

  it('disagree: the agreement level is shared across every active report', () => {
    const level = V.CONFLICT_AGREEMENT / 40;
    expect(warn({ active_reports: 40, min_agreement: level * 0.99 })).toContain('disagree');
    expect(warn({ active_reports: 40, min_agreement: level })).not.toContain('disagree');
    // What would conflict in a hunt of one is ordinary luck in a hunt of forty.
    expect(warn({ active_reports: 40, min_agreement: V.CONFLICT_AGREEMENT / 2 })).not.toContain(
      'disagree',
    );
  });

  it('raises disagree once for both causes', () => {
    expect(warn({ second_place_share: 0.5, min_agreement: 0 })).toEqual(['disagree']);
  });

  it('keeps a stable order', () => {
    expect(
      warn({
        positive_reports: 1,
        observer_span_deg: 0,
        second_place_share: 0.5,
        min_agreement: 0,
      }),
    ).toEqual(['too_few', 'narrow_spread', 'disagree']);
  });
});
