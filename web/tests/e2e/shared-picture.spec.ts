/**
 * SC-002: a report is visible on another device within 5 seconds.
 *
 * This is the whole product in one test — the shared bearing picture. Two independent browser
 * contexts, two devices, one hunt.
 */
import { expect, test, type Browser } from '@playwright/test';
import { createHunt, grantPosition, joinAs, renderedFeatures, reportBearing, reportHeardNothing } from './helpers.js';

/** A second device: its own storage, its own identity, its own log. */
async function secondDevice(browser: Browser, code: string, callsign: string) {
  const context = await browser.newContext();
  await grantPosition(context, { latitude: 48.79, longitude: -122.51 });
  const page = await context.newPage();
  await joinAs(page, code, callsign);
  return { context, page };
}

test('a report reaches another device within 5 seconds', async ({ browser }) => {
  const code = await createHunt();

  const a = await secondDevice(browser, code, 'KI7XYZ');
  const b = await secondDevice(browser, code, 'W7ABC');

  const start = Date.now();
  await reportBearing(a.page, 90);

  // The other device must show it without being touched.
  await expect
    .poll(async () => (await renderedFeatures(b.page)).filter((f) => f.kind === 'bearing').length, {
      timeout: 5_000,
    })
    .toBe(1);

  expect(Date.now() - start).toBeLessThan(5_000);

  await a.context.close();
  await b.context.close();
});

test('a bearing is attributed to its observer on the other device', async ({ browser }) => {
  const code = await createHunt();
  const a = await secondDevice(browser, code, 'KI7XYZ');
  const b = await secondDevice(browser, code, 'W7ABC');

  await reportBearing(a.page, 90);

  await expect
    .poll(async () => (await renderedFeatures(b.page)).find((f) => f.kind === 'bearing')?.label, {
      timeout: 5_000,
    })
    .toBe('KI7XYZ');

  await a.context.close();
  await b.context.close();
});

test('omni and null render without implying a direction', async ({ browser }) => {
  const code = await createHunt();
  const a = await secondDevice(browser, code, 'KI7XYZ');
  const b = await secondDevice(browser, code, 'W7ABC');

  await reportHeardNothing(a.page);
  await a.page.getByTestId('report-omni').click();
  await a.page.getByTestId('strength-1').click();

  await expect
    .poll(async () => (await renderedFeatures(b.page)).map((f) => f.kind).sort(), { timeout: 5_000 })
    .toEqual(['null', 'omni']);

  // FR-011a: neither is a wedge. A marker at a position claims no direction.
  const features = await renderedFeatures(b.page);
  expect(features.some((f) => f.kind === 'bearing')).toBe(false);

  await a.context.close();
  await b.context.close();
});

test('a retraction propagates and removes the report from every map', async ({ browser }) => {
  const code = await createHunt();
  const a = await secondDevice(browser, code, 'KI7XYZ');
  const b = await secondDevice(browser, code, 'W7ABC');

  await reportHeardNothing(a.page);
  await expect
    .poll(async () => (await renderedFeatures(b.page)).length, { timeout: 5_000 })
    .toBe(1);

  // Retract by appending a retraction directly: the UI for this is not built (T048 composes it),
  // and the property under test is that a retraction propagates and folds, not how it is typed.
  await a.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('foxmapper');
      request.onsuccess = () => resolve(request.result);
    });
    const reports: { id: string; kind: string; hunt_code: string }[] = await new Promise((resolve) => {
      const all = db.transaction('reports', 'readonly').objectStore('reports').getAll();
      all.onsuccess = () => resolve(all.result);
    });
    const target = reports.find((r) => r.kind === 'null')!;
    const retraction = {
      v: 1,
      id: crypto.randomUUID(),
      hunt_code: target.hunt_code,
      kind: 'retraction',
      observer: { callsign: 'KI7XYZ' },
      position: { lat: 48.75, lon: -122.47 },
      position_source: 'measured',
      observed_at: Date.now(),
      clock_offset_ms: null,
      entered_by: { participant_id: 'e2e', callsign: 'KI7XYZ' },
      payload: { retracts_id: target.id },
    };
    await fetch(`/api/hunts/${target.hunt_code}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(retraction),
    });
  });

  await expect
    .poll(async () => (await renderedFeatures(b.page)).length, { timeout: 5_000 })
    .toBe(0);

  await a.context.close();
  await b.context.close();
});

test('the map says whether it is showing everyone or only this phone', async ({ browser }) => {
  // FR-018. A hunter acting on this map must know whether it is the whole picture.
  const code = await createHunt();
  const a = await secondDevice(browser, code, 'KI7XYZ');

  await expect(a.page.getByTestId('sync-state')).toContainText(/everyone/i);

  await a.context.setOffline(true);
  await expect(a.page.getByTestId('sync-state')).toContainText(/only what this phone/i, {
    timeout: 10_000,
  });

  await a.context.close();
});
