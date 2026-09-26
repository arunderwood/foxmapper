/**
 * The posterior on a grid, and the smallest set of cells that holds a given share of it
 * (research R1, R4).
 *
 * Every report's kernel is multiplied over a uniform prior — summed, in logs — cell by cell, in `id`
 * order. Only cells some bearing, signal-strength report or find supports carry prior at all:
 * without that mask, floor-level cells far from any evidence fill the region with flat ties.
 *
 * Ties in cell order break by cell index, and every sum runs in a fixed order, so the same reports
 * give the same cells on every device (FR-018).
 */
import { cos, exp, ln, toRadians } from './detmath.js';
import {
  multiplyRow,
  reachBox,
  restingLog,
  supportBox,
  type Box,
  type PreparedReport,
} from './kernels.js';
import type { EstimateReport } from './types.js';
import type { EstimateValues } from './values.js';

// ---- Projection ----

/**
 * A local equirectangular projection. Within 50 km of its centre it is off by well under 1° of
 * bearing, against a narrowest claimable wedge of 16°.
 */
export interface Projection {
  lat0: number;
  lon0: number;
  kmPerDegLat: number;
  kmPerDegLon: number;
}

/**
 * Centred on the midpoint of the bounding box of the positive observers: a min/max box, so the
 * centre does not depend on report order.
 */
export function makeProjection(
  positives: readonly EstimateReport[],
  values: EstimateValues,
): Projection {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const r of positives) {
    minLat = Math.min(minLat, r.position.lat);
    maxLat = Math.max(maxLat, r.position.lat);
    minLon = Math.min(minLon, r.position.lon);
    maxLon = Math.max(maxLon, r.position.lon);
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLon + maxLon) / 2;
  const kmPerDegLat = toRadians(1) * values.EARTH_RADIUS_KM;
  return { lat0, lon0, kmPerDegLat, kmPerDegLon: kmPerDegLat * cos(toRadians(lat0)) };
}

export function project(
  projection: Projection,
  position: { lat: number; lon: number },
): { x: number; y: number } {
  return {
    x: (position.lon - projection.lon0) * projection.kmPerDegLon,
    y: (position.lat - projection.lat0) * projection.kmPerDegLat,
  };
}

/** Local plane back to [longitude, latitude]. */
export function unproject(projection: Projection, x: number, y: number): [number, number] {
  return [
    projection.lon0 + x / projection.kmPerDegLon,
    projection.lat0 + y / projection.kmPerDegLat,
  ];
}

// ---- Boxes ----

export function unionBox(boxes: readonly Box[]): Box {
  const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of boxes) {
    out.minX = Math.min(out.minX, b.minX);
    out.minY = Math.min(out.minY, b.minY);
    out.maxX = Math.max(out.maxX, b.maxX);
    out.maxY = Math.max(out.maxY, b.maxY);
  }
  return out;
}

/** The square with the same centre whose side is the box's longer side, grown by `pad` each way. */
export function squareAround(box: Box, pad = 0): Box {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const half = Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2 + pad;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}

/** The square holding every positive report's support. Empty support makes an empty box. */
export function positiveSupportBox(prepared: readonly PreparedReport[]): Box | null {
  const boxes = prepared.map(supportBox).filter((b): b is Box => b !== null);
  return boxes.length === 0 ? null : squareAround(unionBox(boxes));
}

// ---- The grid ----

export interface Grid {
  /** Lower-left corner of the square, in the local plane. */
  x0: number;
  y0: number;
  /** Side of one cell, in km. */
  cell: number;
  /** Cells per side. Cell index = row × n + column; rows run north, columns east. */
  n: number;
  /** Log posterior per cell, up to a constant. −∞ outside the support. */
  logPost: Float64Array;
}

export function cellCentre(grid: Grid, index: number): { x: number; y: number } {
  const row = Math.floor(index / grid.n);
  const column = index - row * grid.n;
  return { x: grid.x0 + (column + 0.5) * grid.cell, y: grid.y0 + (row + 0.5) * grid.cell };
}

/**
 * The inclusive column (or row) range whose centres could fall in [lo, hi]. It may include one
 * cell too many on each side, which costs a kernel evaluation and changes nothing: outside its reach
 * box a kernel returns exactly its resting value.
 */
export function span(grid: Grid, lo: number, hi: number, origin: number): [number, number] {
  const from = Math.max(0, Math.floor((lo - origin) / grid.cell - 0.5));
  const to = Math.min(grid.n - 1, Math.floor((hi - origin) / grid.cell - 0.5) + 1);
  return [from, to];
}

/**
 * How many kernel ratios a cell may multiply before the product is folded into its log. A ratio lies
 * between the lowest floor and the reciprocal of the lowest floor, so half the log of the largest
 * double, over the log of that reciprocal, keeps the running product clear of overflow and
 * underflow both.
 */
function flushEvery(prepared: readonly PreparedReport[]): number {
  let lowest = 1;
  for (const p of prepared) lowest = Math.min(lowest, p.floor);
  return Math.max(1, Math.floor(ln(Number.MAX_VALUE) / 2 / -ln(lowest)));
}

/**
 * Multiplies every report's kernel over a square, in `id` order. A report contributes its resting
 * value everywhere — once, as a shared base in logs — and its ratio to that value inside its reach
 * box. Ratios multiply per cell and fold into the log every few reports, which spares a log per
 * kernel; the order of every operation is fixed, so the bits are too.
 */
export function buildGrid(prepared: readonly PreparedReport[], box: Box, n: number): Grid {
  const cell = (box.maxX - box.minX) / n;
  const cells = n * n;
  const grid: Grid = { x0: box.minX, y0: box.minY, cell, n, logPost: new Float64Array(cells) };
  const supported = new Uint8Array(cells);
  const product = new Float64Array(cells).fill(1);

  let base = 0;
  for (const p of prepared) base += restingLog(p);
  grid.logPost.fill(base);

  const fold = (): void => {
    for (let index = 0; index < cells; index++) {
      const q = product[index]!;
      if (q === 1) continue;
      grid.logPost[index] = grid.logPost[index]! + ln(q);
      product[index] = 1;
    }
  };

  const every = flushEvery(prepared);
  let pending = 0;
  for (const p of prepared) {
    const reach = reachBox(p);
    const [i0, i1] = reach ? span(grid, reach.minX, reach.maxX, grid.x0) : [0, n - 1];
    const [j0, j1] = reach ? span(grid, reach.minY, reach.maxY, grid.y0) : [0, n - 1];
    for (let j = j0; j <= j1; j++) {
      multiplyRow(p, grid.y0 + (j + 0.5) * cell, grid.x0, cell, i0, i1, j * n, product, supported);
    }
    pending++;
    if (pending === every) {
      fold();
      pending = 0;
    }
  }
  fold();

  // A square no cell centre of which lands in any support: the whole square is the prior. It is
  // wider than any real support, which errs toward claiming less.
  if (!supported.includes(1)) return grid;
  for (let index = 0; index < cells; index++) {
    if (supported[index] === 0) grid.logPost[index] = -Infinity;
  }
  return grid;
}

// ---- The highest-density cell set ----

export interface Density {
  /** Each cell's probability relative to the most probable cell: 1 at the peak, 0 off support. */
  prob: Float64Array;
  /** Sum of `prob` over every cell, in index order. */
  total: number;
  /** The admitted cells, most probable first. */
  admitted: Int32Array;
  /** `prob` of the last cell admitted: the level the region's edge is drawn at. */
  threshold: number;
}

/**
 * The smallest set of cells holding `level` of the probability: cells sorted by log posterior,
 * highest first, ties by index, admitted until the running share reaches `level`.
 */
export function highestDensityCells(grid: Grid, level: number): Density {
  const cells = grid.n * grid.n;
  let peak = -Infinity;
  for (let index = 0; index < cells; index++) peak = Math.max(peak, grid.logPost[index]!);

  const prob = new Float64Array(cells);
  let total = 0;
  const order: number[] = [];
  for (let index = 0; index < cells; index++) {
    const l = grid.logPost[index]!;
    if (l === -Infinity) continue;
    const p = exp(l - peak);
    prob[index] = p;
    total += p;
    order.push(index);
  }

  const logPost = grid.logPost;
  order.sort((a, b) => logPost[b]! - logPost[a]! || a - b);

  const admitted: number[] = [];
  let running = 0;
  let threshold = 0;
  for (const index of order) {
    admitted.push(index);
    running += prob[index]!;
    threshold = prob[index]!;
    if (running >= level * total) break;
  }

  return { prob, total, admitted: Int32Array.from(admitted), threshold };
}

/**
 * The square the second pass re-grids: the bounding box of the given cells, squared, padded by a
 * share of its side plus one first-pass cell on each side.
 */
export function refineBox(grid: Grid, cells: Int32Array, values: EstimateValues): Box {
  const half = grid.cell / 2;
  const boxes: Box[] = [];
  for (const index of cells) {
    const { x, y } = cellCentre(grid, index);
    boxes.push({ minX: x - half, minY: y - half, maxX: x + half, maxY: y + half });
  }
  const tight = squareAround(unionBox(boxes));
  const side = tight.maxX - tight.minX;
  return squareAround(tight, side * values.REFINE_PAD_FRACTION + grid.cell);
}
