/**
 * Where a report says it came from — FR-008, FR-008a, US1/AC7, and Principle I.
 *
 * The app used to fall back to a hard-coded map centre when the device had no fix, and record it
 * as `placed` — the value that renders as "Position set by hand". Every other participant was told
 * a human had put that report there. A wedge drawn from ground its reporter has never stood on,
 * wearing their callsign, is the exact confident-looking wrongness Principle I exists to reject,
 * and it is worse than no report at all.
 *
 * These tests deliberately do **not** grant geolocation: that is the hunter under canopy, in a
 * denied-permission tab, or holding a phone that never gets a fix.
 */
import { expect, test } from '@playwright/test';
import {
  createHunt,
  joinAs,
  localReports,
  placePosition,
  tapOpenMap,
  renderedFeatures,
  reportBearing,
  reportHeardNothing,
} from './helpers.js';

/** Joins with no geolocation at all — the app must not pretend it knows where this phone is. */
async function joinWithNoPosition(page: import('@playwright/test').Page, code: string) {
  await page.goto(`/h/${code}`);
  await page.getByTestId('callsign-input').fill('KI7XYZ');
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();
}

test('a phone with no position says so, rather than inventing one', async ({ page }) => {
  const code = await createHunt();
  await joinWithNoPosition(page, code);

  // The honest answer to "can this phone file a report", in the primary view.
  await expect(page.locator('[data-testid="gps-state"][data-ready="false"]')).toBeVisible();
  await expect(page.getByTestId('place-position')).toBeVisible();
});

test('reporting with no position asks where you are instead of guessing — US1/AC7', async ({
  page,
}) => {
  const code = await createHunt();
  await joinWithNoPosition(page, code);

  // Tapping a report kind must not open the sheet over a fabricated position. It asks.
  await page.getByTestId('report-null').click();
  await expect(page.getByTestId('placing-banner')).toBeVisible();
  await expect(page.getByTestId('sheet')).toHaveCount(0);

  // Nothing has been written. The report the hunter started does not exist yet, and certainly not
  // at a coordinate nobody chose.
  expect(await localReports(page)).toHaveLength(0);
});

test('point-at-map places the position, and the report is filed from there — FR-008a', async ({
  page,
}) => {
  const code = await createHunt();
  await joinWithNoPosition(page, code);

  await page.getByTestId('report-null').click();
  await page.getByTestId('placing-banner').waitFor();

  // The second entry method: tap where you are. Landing straight in the report you asked for.
  await tapOpenMap(page);
  await page.getByTestId('sheet').waitFor();
  await page.getByTestId('send-null').click();

  const reports = await localReports(page);
  expect(reports).toHaveLength(1);

  // `placed` here is true because a person placed it — which is what the word has to mean for the
  // map's "Position set by hand" to be worth reading.
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(1);
  expect((await renderedFeatures(page))[0]!.placed).toBe(true);
});

test('a placement tap inside a wedge places — it does not open the wedge popup', async ({
  browser,
}) => {
  // The placement listener consumed the tap and cleared #placing BEFORE the layer-filtered
  // listener saw the same click — so a tap that landed inside a prior bearing's cone both
  // placed the position AND opened that report's popup, retract button and all.
  const context = await browser.newContext();
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 48.7519, longitude: -122.4787 });
  const page = await context.newPage();

  const code = await createHunt();
  await joinAs(page, code, 'W7ABC');
  // A wedge pointing south from the hunter's own position: it covers the ground below centre.
  await reportBearing(page, 180);

  await page.getByTestId('place-position').click();
  await page.getByTestId('placing-banner').waitFor();

  // Tap deliberately INSIDE the wedge: a point just south of the observer's position.
  const point = await page.evaluate(() => {
    const map = (window as unknown as { __map?: maplibregl.Map }).__map!;
    const projected = map.project([-122.4787, 48.7519]);
    return { x: projected.x, y: projected.y + 120 };
  });
  await page.getByTestId('map').click({ position: point });

  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();
  await expect(page.getByTestId('gps-state')).toHaveAttribute('data-state', 'placed');
  // The whole of the fix: the same tap must NOT have opened the wedge's detail popup.
  await expect(page.getByTestId('report-detail')).toHaveCount(0);

  await context.close();
});

test('a placed position is not the map’s default centre', async ({ page }) => {
  const code = await createHunt();
  await joinWithNoPosition(page, code);

  await placePosition(page);
  await reportHeardNothing(page);

  // The tap was deliberately off-centre. If the report came back at the camera's starting point,
  // the fallback is still in there somewhere.
  const position = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('foxmapper');
      request.onsuccess = () => resolve(request.result);
    });
    const all: { position: { lat: number; lon: number } }[] = await new Promise((resolve) => {
      const request = db.transaction('reports', 'readonly').objectStore('reports').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    return all[0]!.position;
  });

  const DEFAULT_CENTRE = { lat: 48.7519, lon: -122.4787 };
  const movedAtAll =
    Math.abs(position.lat - DEFAULT_CENTRE.lat) > 1e-6 ||
    Math.abs(position.lon - DEFAULT_CENTRE.lon) > 1e-6;
  expect(movedAtAll).toBe(true);
});

test('a measured position is still recorded as measured — the fix did not break the normal path', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 48.79, longitude: -122.51 });
  const page = await context.newPage();

  const code = await createHunt();
  await joinAs(page, code, 'W7ABC');
  await reportHeardNothing(page);

  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(1);
  expect((await renderedFeatures(page))[0]!.placed).toBe(false);

  await context.close();
});
