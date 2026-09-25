/**
 * From admitted cells to the shapes the map draws (research R7).
 *
 * The admitted cells split into 8-connected components, labelled in scan order so the labels are the
 * same everywhere. Each component becomes one region: "more than one place" is then literal (FR-012),
 * and two groups of reports are never averaged into one blob between them.
 *
 * Each region's outline is contoured from the probability itself, not from a 0/1 mask, so its edge
 * follows the real density rather than a staircase of cells. Holes survive: a "heard nothing" inside
 * a region makes one.
 */
import { contours } from 'd3-contour';
import type { MultiPolygon, Position } from 'geojson';
import { unproject, type Density, type Grid, type Projection } from './grid.js';
import type { Region } from './types.js';
import type { EstimateValues } from './values.js';

export interface Component {
  /** Cell indices, ascending. */
  cells: number[];
  /** Share of the whole grid's probability. */
  probability: number;
  /** The lowest cell index in the component: the tie-break after probability. */
  first: number;
}

const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** Connected components of the admitted cells, most probable first, then by first cell. */
export function components(grid: Grid, density: Density): Component[] {
  const { n } = grid;
  const admitted = new Uint8Array(n * n);
  for (const index of density.admitted) admitted[index] = 1;
  const label = new Int32Array(n * n).fill(-1);

  const found: Component[] = [];
  for (let start = 0; start < n * n; start++) {
    if (admitted[start] === 0 || label[start] !== -1) continue;
    const id = found.length;
    const cells: number[] = [];
    const stack = [start];
    label[start] = id;
    while (stack.length > 0) {
      const index = stack.pop()!;
      cells.push(index);
      const row = Math.floor(index / n);
      const column = index - row * n;
      for (const [dc, dr] of NEIGHBOURS) {
        const c = column + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= n || r >= n) continue;
        const next = r * n + c;
        if (admitted[next] === 0 || label[next] !== -1) continue;
        label[next] = id;
        stack.push(next);
      }
    }
    cells.sort((a, b) => a - b);
    let mass = 0;
    for (const index of cells) mass += density.prob[index]!;
    found.push({ cells, probability: mass / density.total, first: start });
  }

  return found.sort((a, b) => b.probability - a.probability || a.first - b.first);
}

function rounder(values: EstimateValues): (v: number) => number {
  // Divide by the step's exact reciprocal, so 48.752345 comes out as the double nearest to it.
  const perDegree = Math.floor(1 / values.COORDINATE_STEP_DEG + 0.5);
  return (v) => Math.floor(v * perDegree + 0.5) / perDegree;
}

/**
 * One region per component: its probability grid, with every cell outside the component held below
 * the cut, contoured at the probability of the last admitted cell.
 */
export function buildRegions(
  grid: Grid,
  density: Density,
  parts: readonly Component[],
  projection: Projection,
  values: EstimateValues,
): Region[] {
  const { n } = grid;
  const inAnyPart = new Uint8Array(n * n);
  for (const part of parts) for (const index of part.cells) inAnyPart[index] = 1;
  const round = rounder(values);
  const generator = contours().size([n, n]);

  return parts.map((part) => {
    const field = new Float64Array(n * n);
    const mine = new Uint8Array(n * n);
    for (const index of part.cells) mine[index] = 1;
    for (let index = 0; index < n * n; index++) {
      const p = density.prob[index]!;
      if (mine[index] === 1) field[index] = p;
      // Another region's cells, and cells tied with the cut but not admitted, sit below it.
      else if (inAnyPart[index] === 1 || p >= density.threshold) field[index] = 0;
      else field[index] = p;
    }

    const contour = generator.contour(Array.from(field), density.threshold);
    const toLonLat = (point: Position): Position => {
      const [lon, lat] = unproject(
        projection,
        grid.x0 + point[0]! * grid.cell,
        grid.y0 + point[1]! * grid.cell,
      );
      return [round(lon), round(lat)];
    };
    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: contour.coordinates.map((polygon) => polygon.map((ring) => ring.map(toLonLat))),
    };
    return { geometry, probability: part.probability };
  });
}
