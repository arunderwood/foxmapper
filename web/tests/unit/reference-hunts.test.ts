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
import {
  bearingAt,
  calibrationBatch,
  Ids,
  mulberry32,
  type LatLon,
  type ReferenceHunt,
} from '../reference/simulate.js';
import { ESTIMATE_VALUES } from '../../src/estimate/values.js';
import { rangeKm, wedgeHalfWidthDegrees } from '../../src/log/confidence.js';

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

/** Longitude/latitude to km east and north of `origin`, on a local flat earth. */
function localKm(origin: LatLon): (lonLat: number[]) => { x: number; y: number } {
  const kmPerDegLat = (Math.PI / 180) * ESTIMATE_VALUES.EARTH_RADIUS_KM;
  const kmPerDegLon = kmPerDegLat * Math.cos((origin.lat * Math.PI) / 180);
  return ([lon, lat]) => ({
    x: (lon! - origin.lon) * kmPerDegLon,
    y: (lat! - origin.lat) * kmPerDegLat,
  });
}

/** The regions' centre, weighted by each region's probability and each ring's area, in km from `origin`. */
function centreKm(result: EstimateResult, origin: LatLon): { x: number; y: number } {
  const toKm = localKm(origin);
  let weight = 0;
  let x = 0;
  let y = 0;
  for (const region of result.regions) {
    for (const polygon of region.geometry.coordinates) {
      const ring = polygon[0]!.map(toKm);
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const cross = ring[i]!.x * ring[i + 1]!.y - ring[i + 1]!.x * ring[i]!.y;
        area += cross;
        cx += (ring[i]!.x + ring[i + 1]!.x) * cross;
        cy += (ring[i]!.y + ring[i + 1]!.y) * cross;
      }
      area /= 2;
      if (area === 0) continue;
      const w = region.probability * Math.abs(area);
      x += w * (cx / (6 * area));
      y += w * (cy / (6 * area));
      weight += w;
    }
  }
  return { x: x / weight, y: y / weight };
}

/** The longest side of the box around every region, in km. */
function longestSideKm(result: EstimateResult, origin: LatLon): number {
  const points = result.regions.flatMap((r) =>
    r.geometry.coordinates.flatMap((polygon) => polygon[0]!.map(localKm(origin))),
  );
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
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

  describe('a single bearing (US1/AC2, FR-004a)', () => {
    const fox = { lat: 48.75, lon: -122.48 };
    const kmPerDegLat = (Math.PI / 180) * ESTIMATE_VALUES.EARTH_RADIUS_KM;
    const kmPerDegLon = kmPerDegLat * Math.cos((fox.lat * Math.PI) / 180);

    it.each([
      [3, 1],
      [4, 3],
      [5, 3],
      [5, 5],
    ] as const)('Q%i R%i: runs the length of its wedge and lies within it', (q, r) => {
      const report = bearingAt(mulberry32(q * 10 + r), new Ids(q * 10 + r), fox, {
        from: 180,
        km: 2,
        q,
        r,
        errorDeg: 0,
      });
      const result = run([report]);
      const half = wedgeHalfWidthDegrees(q)!;
      const range = rangeKm(r);

      const points = result.regions.flatMap((region) =>
        region.geometry.coordinates.flatMap((polygon) => polygon[0]!),
      );
      const local = points.map(([lon, lat]) => ({
        x: (lon! - report.position.lon) * kmPerDegLon,
        y: (lat! - report.position.lat) * kmPerDegLat,
      }));
      const far = Math.max(...local.map((p) => Math.hypot(p.x, p.y)));
      const longest = Math.max(
        Math.max(...local.map((p) => p.x)) - Math.min(...local.map((p) => p.x)),
        Math.max(...local.map((p) => p.y)) - Math.min(...local.map((p) => p.y)),
      );
      // The second grid is at least this fine, so no edge can be drawn closer than this to the true
      // one: the outline is contoured from cells, not from the wedge's own lines.
      const cell =
        (longest * (1 + 2 * ESTIMATE_VALUES.REFINE_PAD_FRACTION)) /
        ESTIMATE_VALUES.GRID_CELLS_PER_SIDE;

      expect(far).toBeLessThanOrEqual(range);
      expect(far).toBeGreaterThanOrEqual(range * (1 - ESTIMATE_VALUES.BEARING_RANGE_TAPER));
      for (const p of local) {
        const d = Math.hypot(p.x, p.y);
        const off = Math.abs((Math.atan2(p.x, p.y) * 180) / Math.PI) - half;
        const lateral = off > 0 ? d * Math.sin((off * Math.PI) / 180) : 0;
        expect(lateral).toBeLessThanOrEqual(cell);
      }
    });
  });

  describe.each(SCENARIOS)('$name', (hunt) => {
    const result = run(hunt.reports);
    const want = hunt.expect ?? {};

    it('meets its expectation (SC-003, SC-004, SC-012)', () => {
      if (want.status) expect(result.status).toBe(want.status);
      if (want.regions !== undefined) expect(result.regions).toHaveLength(want.regions);
      if (want.foxInside !== undefined) expect(foxInside(result, hunt.fox)).toBe(want.foxInside);
      for (const w of want.warnings ?? []) expect(result.warnings).toContain(w);
      for (const w of want.absent ?? []) expect(result.warnings).not.toContain(w);
      if (want.alongKm !== undefined) {
        expect(longestSideKm(result, hunt.fox)).toBeGreaterThanOrEqual(want.alongKm);
      }
      if (want.shifts) {
        const { added, point, direction } = want.shifts;
        const before = run(hunt.reports.filter((r) => !added.includes(r.id)));
        const from = (r: EstimateResult): number => {
          const c = centreKm(r, point);
          return Math.hypot(c.x, c.y);
        };
        if (direction === 'toward') expect(from(result)).toBeLessThan(from(before));
        else expect(from(result)).toBeGreaterThan(from(before));
      }
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
