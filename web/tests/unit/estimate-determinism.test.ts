/**
 * The same reports give the same result, whatever order they arrive in, and a retracted report
 * leaves no trace (FR-007, FR-018, FR-026, contracts/estimate-module.md §4).
 *
 * Cross-engine identity is the e2e suite's job (SC-005): this suite runs on one engine, so it pins
 * everything that does not depend on the engine — order, retraction, and the result's shape.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalJson, estimate } from '../../src/estimate/estimate.js';
import { toEstimateInput } from '../../src/estimate/input.js';
import type { EstimateResult } from '../../src/estimate/types.js';
import { fold } from '../../src/log/fold.js';
import { toLog } from '../../src/log/gset.js';
import type { ObservationReport, Report } from '../../src/log/types.js';
import { observationReportArb, retractionOfArb } from './arbitraries.js';

const CENTRE = { lat: 48.75, lon: -122.48 };

/** Reports within a few km of one hunt: the arbitraries alone scatter them across the globe. */
const localReportArb = fc
  .tuple(
    observationReportArb,
    fc.double({ min: -0.06, max: 0.06, noNaN: true }),
    fc.double({ min: -0.09, max: 0.09, noNaN: true }),
  )
  .map(
    ([report, dLat, dLon]) =>
      ({
        ...report,
        position: { lat: CENTRE.lat + dLat, lon: CENTRE.lon + dLon },
      }) as ObservationReport,
  );

const huntArb = fc.uniqueArray(localReportArb, {
  minLength: 1,
  maxLength: 10,
  selector: (r) => r.id,
});

function bytes(result: EstimateResult): string {
  return canonicalJson({ ...result, generation: 0 });
}

function run(active: readonly ObservationReport[]): EstimateResult {
  return estimate(toEstimateInput(active, 0));
}

describe('estimate determinism', () => {
  it('gives byte-identical results for shuffled input', () => {
    fc.assert(
      fc.property(huntArb, fc.array(fc.nat()), (active, keys) => {
        const shuffled = active
          .map((report, i) => ({ report, key: keys[i] ?? i }))
          .sort((a, b) => a.key - b.key)
          .map(({ report }) => report);
        const input = toEstimateInput(active, 1);
        // Bypass the caller's sort: the function must re-sort on its own.
        const unsorted = { ...input, reports: toEstimateInput(shuffled, 1).reports.reverse() };
        expect(bytes(estimate(unsorted))).toBe(bytes(estimate(input)));
      }),
      { numRuns: 30 },
    );
  });

  it('forgets a retracted report entirely (FR-007)', () => {
    fc.assert(
      fc.property(
        huntArb.chain((active) =>
          fc.tuple(
            fc.constant(active),
            retractionOfArb(fc.constantFrom(...active.map((r) => r.id))),
          ),
        ),
        ([active, retraction]) => {
          const withRetraction = fold(toLog([...active, retraction] as Report[])).active;
          const without = active.filter((r) => r.id !== retraction.payload.retracts_id);
          expect(bytes(run(withRetraction))).toBe(bytes(run(without)));
        },
      ),
      { numRuns: 30 },
    );
  });

  it('holds at least 9 in 10 of the probability in its regions', () => {
    fc.assert(
      fc.property(huntArb, (active) => {
        const result = run(active);
        if (result.status === 'none') return result.regions.length === 0;
        const held = result.regions.reduce((sum, r) => sum + r.probability, 0);
        return held >= result.level;
      }),
      { numRuns: 30 },
    );
  });

  it('never says which report disagrees (FR-026)', () => {
    fc.assert(
      fc.property(huntArb, (active) => {
        const result = run(active);
        const text = canonicalJson(result);
        expect(Object.keys(result.metrics).sort()).toEqual([
          'active_reports',
          'min_agreement',
          'observer_span_deg',
          'positive_reports',
          'second_place_share',
        ]);
        for (const report of active) expect(text).not.toContain(report.id);
      }),
      { numRuns: 30 },
    );
  });
});
