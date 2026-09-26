/**
 * The four measured values behind the warnings, and the warnings they raise (research R6, FR-010 to
 * FR-012a, FR-034).
 *
 * Each value is exposed on the result (FR-036), and each warning is one comparison against one named
 * threshold. Agreement is measured per report but leaves this module only as its minimum, so nothing
 * downstream can rank or label a report by how well it agrees (FR-026).
 */
import { atan2, PI, toDegrees } from './detmath.js';
import { cellCentre, highestDensityCells, type Density, type Grid } from './grid.js';
import { kernel, type PreparedReport } from './kernels.js';
import type { Component } from './regions.js';
import type { EstimateMetrics, WarningKind } from './types.js';
import type { EstimateValues } from './values.js';

const FULL_TURN_DEG = 2 * toDegrees(PI);

/** The probability-weighted centre of a component, in the local plane. */
function centreOf(grid: Grid, density: Density, part: Component): { x: number; y: number } {
  let mass = 0;
  let x = 0;
  let y = 0;
  for (const index of part.cells) {
    const p = density.prob[index]!;
    const c = cellCentre(grid, index);
    mass += p;
    x += p * c.x;
    y += p * c.y;
  }
  return { x: x / mass, y: y / mass };
}

/**
 * The angular span of the positive observers as seen from the centre: a full turn minus the largest
 * gap between their directions. `null` when one of them stands within reach of the centre — a
 * station at the fox, or a find, is the best geometry there is. Zero when they all stand in one place:
 * three bearings from one spot cannot fix a distance.
 */
function observerSpan(
  positives: readonly PreparedReport[],
  centre: { x: number; y: number },
  values: EstimateValues,
): number | null {
  const near2 = values.SPREAD_NEAR_KM * values.SPREAD_NEAR_KM;
  for (const p of positives) {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    if (dx * dx + dy * dy < near2) return null;
  }

  const apart2 = values.SAME_PLACE_KM * values.SAME_PLACE_KM;
  let spread = false;
  for (let a = 0; a < positives.length && !spread; a++) {
    for (let b = a + 1; b < positives.length; b++) {
      const dx = positives[a]!.x - positives[b]!.x;
      const dy = positives[a]!.y - positives[b]!.y;
      if (dx * dx + dy * dy > apart2) {
        spread = true;
        break;
      }
    }
  }
  if (!spread) return 0;

  const directions = positives
    .map((p) => {
      const deg = toDegrees(atan2(p.x - centre.x, p.y - centre.y));
      return deg < 0 ? deg + FULL_TURN_DEG : deg;
    })
    .sort((a, b) => a - b);
  let largestGap = directions[0]! + FULL_TURN_DEG - directions[directions.length - 1]!;
  for (let i = 1; i < directions.length; i++) {
    largestGap = Math.max(largestGap, directions[i]! - directions[i - 1]!);
  }
  return FULL_TURN_DEG - largestGap;
}

/**
 * How well one report agrees with the whole estimate: its expected kernel under the posterior,
 * rescaled so its floor reads 0 and full support reads 1. On one scale for every kind, so a "heard
 * nothing" at the centre of the region conflicts just as a bearing pointing away does.
 *
 * The expectation runs over the cells holding nearly all the probability (`core`), not every cell:
 * the rest carries too little weight to move it, and skipping it keeps 500 reports within budget.
 */
function agreement(p: PreparedReport, grid: Grid, density: Density, core: Int32Array): number {
  let weight = 0;
  let sum = 0;
  for (const index of core) {
    const w = density.prob[index]!;
    const { x, y } = cellCentre(grid, index);
    weight += w;
    sum += w * kernel(p, x, y);
  }
  return (sum / weight - p.floor) / (1 - p.floor);
}

export function measure(
  prepared: readonly PreparedReport[],
  grid: Grid,
  density: Density,
  parts: readonly Component[],
  values: EstimateValues,
): EstimateMetrics {
  const core = highestDensityCells(grid, values.REFINE_LEVEL).admitted;
  const positives = prepared.filter((p) => p.kind !== 'null');
  const centre = centreOf(grid, density, parts[0]!);
  let minAgreement = 1;
  for (const p of prepared)
    minAgreement = Math.min(minAgreement, agreement(p, grid, density, core));
  return {
    positive_reports: positives.length,
    observer_span_deg: observerSpan(positives, centre, values),
    second_place_share: parts[1]?.probability ?? 0,
    min_agreement: minAgreement,
    active_reports: prepared.length,
  };
}

export function warningsFor(metrics: EstimateMetrics, values: EstimateValues): WarningKind[] {
  const warnings: WarningKind[] = [];
  if (metrics.positive_reports < values.TOO_FEW_REPORTS) warnings.push('too_few');
  if (metrics.observer_span_deg !== null && metrics.observer_span_deg < values.NARROW_SPREAD_DEG) {
    warnings.push('narrow_spread');
  }
  // The level is shared across the reports: each honest report has some small chance of falling
  // short by luck, and the lowest of hundreds almost always does. Split this way, the chance that an
  // honest hunt raises the warning stays about the same at any size, while a report that rejects
  // the whole estimate (agreement near 0) still falls below it.
  const conflictBelow = values.CONFLICT_AGREEMENT / Math.max(1, metrics.active_reports);
  if (
    metrics.second_place_share >= values.SECOND_PLACE_SHARE ||
    metrics.min_agreement < conflictBelow
  ) {
    warnings.push('disagree');
  }
  return warnings;
}
