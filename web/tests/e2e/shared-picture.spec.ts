/**
 * SC-002: a report is visible on another device within 5 seconds.
 *
 * This is the whole product in one test — the shared bearing picture. Two independent browser
 * contexts, two devices, one hunt.
 */
import { expect, test, type Browser } from '@playwright/test';
import {
  createHunt,
  grantPosition,
  joinAs,
  localReports,
  renderedFeatures,
  reportBearing,
  reportHeardNothing,
  retractOwnReport,
  tapReport,
} from './helpers.js';

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
    .poll(async () => (await renderedFeatures(b.page)).map((f) => f.kind).sort(), {
      timeout: 5_000,
    })
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

  // Through the interface a hunter actually has: tap your own report, take it back. This used to
  // POST a hand-built retraction because no UI existed to do it — which meant the requirement
  // (FR-010: a participant *can* retract) was never under test at all, only the fold was.
  await retractOwnReport(a.page);

  await expect
    .poll(async () => (await renderedFeatures(b.page)).length, { timeout: 5_000 })
    .toBe(0);

  // The original is still a fact in the log on both devices. A retraction withdraws a report; it
  // does not erase what someone said.
  expect((await localReports(a.page)).filter((r) => r.kind === 'null')).toHaveLength(1);
  expect((await localReports(a.page)).filter((r) => r.kind === 'retraction')).toHaveLength(1);

  await a.context.close();
  await b.context.close();
});

test('a participant cannot retract someone else’s report — FR-025', async ({ browser }) => {
  // There is no moderator, no creator privilege and no appeal. The interface offers the button
  // only on a report this phone entered, and that is the whole of the guarantee: the log is a set
  // of facts about what people said, and only the person who said it may withdraw it.
  const code = await createHunt();
  const a = await secondDevice(browser, code, 'KI7XYZ');
  const b = await secondDevice(browser, code, 'W7ABC');

  await reportHeardNothing(a.page);
  await expect
    .poll(async () => (await renderedFeatures(b.page)).length, { timeout: 5_000 })
    .toBe(1);

  // B is looking at A's report. There is nothing to press.
  await tapReport(b.page);
  await expect(b.page.getByTestId('retract')).toHaveCount(0);

  // ...and A, looking at their own, has the button.
  await tapReport(a.page);
  await expect(a.page.getByTestId('retract')).toHaveCount(1);

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
