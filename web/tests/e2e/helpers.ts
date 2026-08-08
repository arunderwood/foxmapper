/** Shared E2E helpers. */
import type { Page, BrowserContext } from '@playwright/test';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { createRequire } from 'node:module';

interface Geomagnetism {
  model(at: Date): { point(coords: [number, number]): { decl: number } };
}

/**
 * The declination the app itself will compute — same package, same model, same date — so specs
 * can assert exact displayed values instead of loose ranges. Defaults to the grantPosition spot.
 * Loaded via `require`: geomagnetism is CJS with circular internal requires, and a static ESM
 * import of it crashes Node's module loader under Playwright ("Unexpected module status 3").
 */
export function declinationDegrees(lat = 48.7519, lon = -122.4787): number {
  const geomagnetism = createRequire(import.meta.url)('geomagnetism') as Geomagnetism;
  return geomagnetism.model(new Date()).point([lat, lon]).decl;
}

/** The dial's own display rounding: one decimal, folded so 359.96 reads "0.0", never "360.0". */
export function dialFormat(value: number): string {
  return ((Math.round((((value % 360) + 360) % 360) * 10) / 10) % 360).toFixed(1);
}

export const RELAY = process.env['FOXMAPPER_RELAY'] ?? 'http://localhost:8080';

export interface Hunt {
  code: string;
}

/** Creates a hunt directly against the relay — the fixture, not the thing under test. */
export async function createHunt(label = 'Saturday fox'): Promise<string> {
  const response = await fetch(`${RELAY}/api/hunts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target: { frequency: '146.52', label } }),
  });
  const hunt = (await response.json()) as Hunt;
  return hunt.code;
}

/**
 * Geolocation must be granted and set: the app correctly refuses to claim a measured position it
 * does not have, so without this every report would be `placed` and the test would not exercise
 * the path a hunter actually takes.
 */
export async function grantPosition(
  context: BrowserContext,
  coords = { latitude: 48.7519, longitude: -122.4787 },
): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(coords);
}

export async function joinAs(page: Page, code: string, callsign: string): Promise<void> {
  await page.goto(`/h/${code}`);
  await page.getByTestId('callsign-input').fill(callsign);
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();

  // A report is a claim about a place, and the app refuses to invent one — so opening a sheet
  // before the fix lands drops the hunter into hand-placement instead. Waiting on the state the
  // page actually publishes, rather than on a timer.
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();
}

/**
 * Taps the map on genuinely open ground, found by hit-testing rather than arithmetic. Every
 * guessed point has eventually landed on chrome as the UI evolved — (200,200) on grown chips,
 * a 0.7-height fraction on the settings gear, a measured chip/bar midpoint on the expanded
 * attribution control. `elementFromPoint` answers the only question that matters: would this
 * tap reach the canvas?
 */
export async function tapOpenMap(page: Page): Promise<void> {
  const map = page.getByTestId('map');
  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error('map has no box');

  const x = mapBox.x + mapBox.width / 2;
  const y = await page.evaluate(
    ({ x, top, height }) => {
      for (let fraction = 0.35; fraction < 0.95; fraction += 0.05) {
        const cy = top + height * fraction;
        if (document.elementFromPoint(x, cy) instanceof HTMLCanvasElement) return cy;
      }
      return null;
    },
    { x, top: mapBox.y, height: mapBox.height },
  );
  if (y === null) throw new Error('no open map ground to tap');
  await map.click({ position: { x: mapBox.width / 2, y: Math.round(y - mapBox.y) } });
}

/** Places the reporting position by hand: the point-at-map method (FR-008a). */
export async function placePosition(page: Page): Promise<void> {
  await page.getByTestId('place-position').click();
  await page.getByTestId('placing-banner').waitFor();
  await tapOpenMap(page);
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();
}

/** Files a "heard nothing" report — the fastest kind, and the one that needs no antenna. */
export async function reportHeardNothing(page: Page): Promise<void> {
  await page.getByTestId('report-null').click();
  await page.getByTestId('send-null').click();
}

export async function reportBearing(page: Page, heading = 90): Promise<void> {
  await page.getByTestId('report-bearing').click();
  await page.getByTestId('heading-input').fill(String(heading));
  await page.getByTestId('confidence-1').click();
  await page.getByTestId('range-1').click();
  await page.getByTestId('send-bearing').click();
}

/**
 * Taps a report on the map and waits for its detail.
 *
 * The tap point is projected from the report's own coordinates rather than assumed to be the
 * middle of the screen: the camera eases to the first fix, so "the centre" is only the right
 * answer once the animation has finished, and a test that raced it would fail for a reason that
 * has nothing to do with what it is checking.
 */
export async function tapReport(page: Page, index = 0): Promise<void> {
  // The camera eases to the first fix. Projecting mid-ease gives a point the marker has already
  // left by the time the click lands.
  await page.waitForFunction(() => {
    const map = (window as unknown as { __map?: MapLibreMap }).__map;
    return Boolean(map) && !map!.isMoving() && !map!.isZooming();
  });

  const point = await page.evaluate(async (i) => {
    const map = (window as unknown as { __map?: MapLibreMap }).__map;
    if (!map) return null;
    for (const id of ['reports-markers', 'reports-wedges']) {
      const source = map.getSource(id) as GeoJSONSource | undefined;
      const data = (source?.serialize() as { data?: GeoJSON.FeatureCollection } | undefined)?.data;
      const feature = data?.features?.[i];
      if (!feature) continue;
      // A wedge is a polygon; its first vertex is the observer's position, where the marker sits.
      const coords =
        feature.geometry.type === 'Point'
          ? (feature.geometry.coordinates as [number, number])
          : ((feature.geometry as GeoJSON.Polygon).coordinates[0]![0] as [number, number]);
      const projected = map.project(coords);
      return { x: projected.x, y: projected.y };
    }
    return null;
  }, index);

  if (!point) throw new Error('no rendered report to tap');
  await page.getByTestId('map').click({ position: point });
  await page.getByTestId('report-detail').waitFor();
}

/** Retracts a report by tapping it and pressing the button — FR-010. */
export async function retractOwnReport(page: Page): Promise<void> {
  await tapReport(page);
  await page.getByTestId('retract').click();
}

export interface StoredBearingPayload {
  heading_true: number;
  heading_magnetic: number;
  declination: number;
  wmm_epoch: string;
}

/** The bearing payloads the device holds — for asserting what the log actually carries (005). */
export async function localBearingPayloads(page: Page): Promise<StoredBearingPayload[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('foxmapper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve) => {
      const store = db.transaction('reports', 'readonly').objectStore('reports');
      const all = store.getAll();
      all.onsuccess = () =>
        resolve(
          (all.result as { kind: string; payload: StoredBearingPayload }[])
            .filter((r) => r.kind === 'bearing')
            .map((r) => r.payload),
        );
    });
  });
}

/** Reports the device currently holds, read straight out of IndexedDB. */
export async function localReports(page: Page): Promise<{ id: string; kind: string }[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('foxmapper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve) => {
      const store = db.transaction('reports', 'readonly').objectStore('reports');
      const all = store.getAll();
      all.onsuccess = () =>
        resolve(
          (all.result as { id: string; kind: string }[]).map((r) => ({ id: r.id, kind: r.kind })),
        );
    });
  });
}

export interface RenderedFeature {
  kind: string;
  label: string;
  relayed: boolean;
  entered_by: string | undefined;
  placed: boolean;
  clock_unknown: boolean;
}

/**
 * What the map has been handed to draw, as opposed to what the log holds.
 *
 * Read from the sources rather than via `querySourceFeatures`, which answers only for the current
 * viewport and returns a feature once per tile it spans. A relayed report 20 km away is genuinely
 * on the map and genuinely outside the viewport, and a test that could not see it would be
 * measuring the camera rather than the fold.
 */
export async function renderedFeatures(page: Page): Promise<RenderedFeature[]> {
  return page.evaluate(() => {
    const map = (window as unknown as { __map?: MapLibreMap }).__map;
    if (!map) return [];

    const collect = (id: string): RenderedFeature[] => {
      const source = map.getSource(id) as GeoJSONSource | undefined;
      if (!source) return [];
      const serialized = source.serialize() as { data?: GeoJSON.FeatureCollection };
      return (serialized.data?.features ?? []).map((f) => ({
        kind: String(f.properties?.['kind']),
        label: String(f.properties?.['label']),
        relayed: Boolean(f.properties?.['relayed']),
        entered_by: f.properties?.['entered_by'] as string | undefined,
        placed: Boolean(f.properties?.['placed']),
        clock_unknown: Boolean(f.properties?.['clock_unknown']),
      }));
    };

    return [...collect('reports-wedges'), ...collect('reports-markers')];
  });
}

/** How many features a named map source currently holds — used for the self-position pins. */
export async function sourceFeatureCount(page: Page, sourceId: string): Promise<number> {
  return page.evaluate((id) => {
    const map = (window as unknown as { __map?: MapLibreMap }).__map;
    const source = map?.getSource(id) as GeoJSONSource | undefined;
    if (!source) return 0;
    const serialized = source.serialize() as { data?: GeoJSON.FeatureCollection };
    return serialized.data?.features?.length ?? 0;
  }, sourceId);
}
