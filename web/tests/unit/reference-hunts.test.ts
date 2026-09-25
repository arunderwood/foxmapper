/**
 * The reference hunts: the test every change to the estimate values must pass (FR-037).
 *
 * SC-001 on a fixed-seed calibration batch, every FR-038 scenario's expectation (SC-003, SC-004,
 * SC-012), and SC-006: signal-strength and "heard nothing" reports change the result wherever they
 * appear. Recorded hunts under `tests/reference/recorded/` run through the same checks.
 *
 * Every coverage claim states what it rests on (FR-039). Simulated hunts prove the estimate agrees
 * with its own assumptions, not that it is right in the field.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { canonicalJson, estimate } from '../../src/estimate/estimate.js';
import { toEstimateInput } from '../../src/estimate/input.js';
import type { EstimateReport, EstimateResult } from '../../src/estimate/types.js';
import { fold } from '../../src/log/fold.js';
import { toLog } from '../../src/log/gset.js';
import type { Report } from '../../src/log/types.js';
import { sha256Utf8, toHex } from '../../src/log/sha256.js';
import { SCENARIOS } from '../reference/scenarios.js';
import { calibrationBatch, type LatLon, type ReferenceHunt } from '../reference/simulate.js';
import { ESTIMATE_VALUES } from '../../src/estimate/values.js';

const CALIBRATION_SEED = 20260925;
const CALIBRATION_HUNTS = 1_000;
/** The share of honest hunts that may read one report as a conflict: a warning that fires on one
 *  honest hunt in twenty is still one hunters learn to trust. */
const HONEST_CONFLICT_RATE = 0.05;

function run(reports: EstimateReport[]): EstimateResult {
  return estimate({ reports, generation: 0 });
}

export function digest(result: EstimateResult): string {
  return toHex(sha256Utf8(canonicalJson({ ...result, generation: 0 })));
}

function foxInside(result: EstimateResult, fox: LatLon): boolean {
  return result.regions.some((region) =>
    booleanPointInPolygon([fox.lon, fox.lat], region.geometry),
  );
}

interface RecordedFile {
  name: string;
  fox: LatLon;
  confirmed_by: string;
  log: Report[];
}

function recordedHunts(): ReferenceHunt[] {
  const dir = fileURLToPath(new URL('../reference/recorded/', import.meta.url));
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const recorded = JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as RecordedFile;
      return {
        name: recorded.name,
        source: 'recorded' as const,
        fox: recorded.fox,
        reports: toEstimateInput(fold(toLog(recorded.log)).active, 0).reports,
      };
    });
}

describe('reference hunts', () => {
  const recorded = recordedHunts();

  const simulated = calibrationBatch(CALIBRATION_SEED, CALIBRATION_HUNTS);
  const results = new Map<ReferenceHunt, EstimateResult>();
  const resultOf = (hunt: ReferenceHunt): EstimateResult => {
    let result = results.get(hunt);
    if (!result) results.set(hunt, (result = run(hunt.reports)));
    return result;
  };

  it('holds the fox inside the region in at least 90% of hunts (SC-001, FR-039)', () => {
    const hunts = [...simulated, ...recorded];
    let inside = 0;
    for (const hunt of hunts) if (foxInside(resultOf(hunt), hunt.fox)) inside++;
    const coverage = inside / hunts.length;

    const basis =
      recorded.length === 0
        ? 'simulated only: self-consistency, not field accuracy'
        : 'includes recorded hunts';
    console.log(
      `coverage ${coverage.toFixed(3)} on ${simulated.length} simulated, ${recorded.length} recorded — ${basis}`,
    );
    expect(coverage).toBeGreaterThanOrEqual(0.9);
  }, 600_000);

  it('rarely says an honest report disagrees (FR-012a)', () => {
    // Honest reports all fall short by luck now and then; the shared level must not mistake that
    // luck for a conflict. Two regions are a real disagreement and are not counted here.
    const conflicts = simulated.filter((hunt) => {
      const { status, metrics } = resultOf(hunt);
      return (
        status === 'estimate' &&
        metrics.min_agreement < ESTIMATE_VALUES.CONFLICT_AGREEMENT / metrics.active_reports
      );
    }).length;
    console.log(
      `one honest report read as a conflict in ${conflicts} of ${simulated.length} simulated hunts`,
    );
    expect(conflicts / simulated.length).toBeLessThanOrEqual(HONEST_CONFLICT_RATE);
  }, 600_000);

  describe.each(SCENARIOS)('$name', (hunt) => {
    const result = run(hunt.reports);
    const want = hunt.expect ?? {};

    it('meets its expectation (SC-003, SC-004, SC-012)', () => {
      if (want.status) expect(result.status).toBe(want.status);
      if (want.regions !== undefined) expect(result.regions).toHaveLength(want.regions);
      if (want.foxInside !== undefined) expect(foxInside(result, hunt.fox)).toBe(want.foxInside);
      for (const w of want.warnings ?? []) expect(result.warnings).toContain(w);
      for (const w of want.absent ?? []) expect(result.warnings).not.toContain(w);
    });

    it('draws regions holding at least 9 in 10 of the probability', () => {
      const held = result.regions.reduce((sum, r) => sum + r.probability, 0);
      if (result.status === 'estimate') expect(held).toBeGreaterThanOrEqual(result.level);
      else expect(result.regions).toEqual([]);
    });

    // A hunt with no region has no region to change: silence alone draws nothing (FR-015).
    const hasOthers =
      result.status === 'estimate' &&
      hunt.reports.some((r) => r.kind === 'omni' || r.kind === 'null');
    it.runIf(hasOthers)(
      'changes when its signal-strength and "heard nothing" reports go (SC-006)',
      () => {
        const without = run(hunt.reports.filter((r) => r.kind !== 'omni' && r.kind !== 'null'));
        expect(digest(without)).not.toBe(digest(result));
      },
    );
  });

  describe.each(recorded.length > 0 ? recorded : [])('recorded: $name', (hunt) => {
    it('contains the confirmed fox position', () => {
      expect(foxInside(run(hunt.reports), hunt.fox)).toBe(true);
    });
  });
});
