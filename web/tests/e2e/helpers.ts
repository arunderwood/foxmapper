/** Shared E2E helpers. */
import type { Page, BrowserContext } from '@playwright/test';

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
        resolve((all.result as { id: string; kind: string }[]).map((r) => ({ id: r.id, kind: r.kind })));
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
    const map = (window as unknown as { __map?: maplibregl.Map }).__map;
    if (!map) return [];

    const collect = (id: string): RenderedFeature[] => {
      const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
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
