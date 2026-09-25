/**
 * The location estimate: active reports in, regions and warnings out (contracts/estimate-module.md).
 *
 * Pure. It reads its arguments and nothing else — no clock, no storage, no network, no randomness —
 * and it uses only arithmetic ECMAScript defines exactly (detmath.ts), so the same reports give a
 * byte-identical result on every device on the same release (FR-018). It is derived state: never
 * stored, never sent, recomputed from the log whenever the log changes (FR-022).
 *
 * Two passes over a grid (research R4): the first covers every positive report's support, the
 * second re-grids the box holding nearly all of the first pass's probability, so a find narrows a
 * 100 km first grid down to metres. The region, its probability and the warnings come from the
 * second pass.
 */
import { sha256Utf8, toHex } from '../log/sha256.js';
import {
  buildGrid,
  highestDensityCells,
  makeProjection,
  positiveSupportBox,
  project,
  refineBox,
  type Projection,
} from './grid.js';
import { byId } from './input.js';
import { prepare, type PreparedReport } from './kernels.js';
import { buildRegions, components } from './regions.js';
import type { EstimateInput, EstimateReport, EstimateResult } from './types.js';
import { ESTIMATE_VALUES, type EstimateValues } from './values.js';
import { measure, warningsFor } from './warnings.js';

/** JSON with object keys sorted at every depth, so equal values always give equal bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(',')}}`;
}

export function valuesDigest(values: EstimateValues): string {
  return toHex(sha256Utf8(canonicalJson(values)));
}

function prepareAll(
  reports: readonly EstimateReport[],
  projection: Projection,
  values: EstimateValues,
  resolutionKm: number,
): PreparedReport[] {
  return reports.map((r) => prepare(r, project(projection, r.position), values, resolutionKm));
}

export function estimate(
  input: EstimateInput,
  values: EstimateValues = ESTIMATE_VALUES,
): EstimateResult {
  const reports = [...input.reports].sort(byId);
  const positives = reports.filter((r) => r.kind !== 'null');
  const common = {
    generation: input.generation,
    level: values.REGION_LEVEL,
    values_digest: valuesDigest(values),
  };

  // Silence rules places out and points at nothing (FR-015).
  const none = (): EstimateResult => ({
    ...common,
    status: 'none',
    regions: [],
    metrics: {
      positive_reports: positives.length,
      observer_span_deg: null,
      second_place_share: 0,
      min_agreement: 1,
      active_reports: reports.length,
    },
    warnings: [],
  });
  if (positives.length === 0) return none();

  const n = values.GRID_CELLS_PER_SIDE;
  const projection = makeProjection(positives, values);

  const box1 = positiveSupportBox(prepareAll(positives, projection, values, 0));
  if (!box1) return none();
  const prepared1 = prepareAll(reports, projection, values, (box1.maxX - box1.minX) / n);
  const grid1 = buildGrid(prepared1, box1, n);
  const wide = highestDensityCells(grid1, values.REFINE_LEVEL);

  const box2 = refineBox(grid1, wide.admitted, values);
  const prepared2 = prepareAll(reports, projection, values, (box2.maxX - box2.minX) / n);
  const grid2 = buildGrid(prepared2, box2, n);
  const density = highestDensityCells(grid2, values.REGION_LEVEL);

  const parts = components(grid2, density);
  const regions = buildRegions(grid2, density, parts, projection, values);
  const metrics = measure(prepared2, grid2, density, parts, values);

  return {
    ...common,
    status: 'estimate',
    regions,
    metrics,
    warnings: warningsFor(metrics, values),
  };
}
