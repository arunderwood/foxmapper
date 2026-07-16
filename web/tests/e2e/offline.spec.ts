/**
 * SC-005: reports survive being offline, and 100% are present after reconnect.
 *
 * **A blank basemap is expected. A lost report is not.** That distinction is the whole of this
 * file — the recorded Complexity Tracking violation says the map degrades to blank ground, and
 * Principle III says a report is never lost or blocked.
 *
 * The quickstart's Level 4 asks for real airplane mode with the HTTP cache cleared, on a real
 * phone. `setOffline` is a fair approximation of the network being gone; it is not a substitute
 * for T061's field check, and it cannot evict iOS storage.
 */
import { expect, test } from '@playwright/test';
import { createHunt, grantPosition, joinAs, localReports, renderedFeatures, reportHeardNothing, RELAY } from './helpers.js';

test('three reports are accepted and rendered with no network', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await context.setOffline(true);

  for (let i = 0; i < 3; i++) await reportHeardNothing(page);

  // Accepted, stored, and drawn — with the network gone the whole time. Nothing blocked.
  expect(await localReports(page)).toHaveLength(3);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(3);

  await context.setOffline(false);
});

test('the queue depth tells the hunter reports are stuck on this phone', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await context.setOffline(true);
  await reportHeardNothing(page);

  await expect(page.getByTestId('queue-depth')).toBeVisible();
  await expect(page.getByTestId('queue-depth')).toContainText('1');

  await context.setOffline(false);
});

test('100% of offline reports reach the server after reconnect — SC-005', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await context.setOffline(true);
  for (let i = 0; i < 3; i++) await reportHeardNothing(page);
  const authored = (await localReports(page)).map((r) => r.id).sort();

  await context.setOffline(false);
  // The queue drains on reconnect. A dropped report is the one unacceptable outcome.
  await expect.poll(async () => page.getByTestId('queue-depth').count(), { timeout: 20_000 }).toBe(0);

  const response = await fetch(`${RELAY}/api/hunts/${code}/ids`);
  const { ids } = (await response.json()) as { ids: string[] };
  expect(ids.sort()).toEqual(authored);
});

test('an unsynced report survives a force-quit', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await context.setOffline(true);
  await reportHeardNothing(page);
  const before = await localReports(page);

  // Closing the page outright is the closest thing to a force-quit: nothing gets a chance to
  // flush, so whatever survives was already durable the moment it was authored. Reopening in the
  // same context keeps the storage, which is what reopening the app on the phone does.
  await page.close();
  const reopened = await context.newPage();
  await context.setOffline(false);
  await reopened.goto(`/h/${code}`);
  await reopened.getByTestId('report-bar').waitFor();

  // The report is still here, and still queued — it was never sent, and nothing dropped it.
  expect(await localReports(reopened)).toEqual(before);
  await expect
    .poll(async () => reopened.getByTestId('queue-depth').count(), { timeout: 20_000 })
    .toBe(0);
});

test('the app-shell precache contains the app, not just the page', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) {
        urls.push(new URL(request.url).pathname);
      }
    }
    return urls;
  });

  // The trap this catches: a worker claims the page *after* its scripts have been fetched, so the
  // fingerprinted JS and CSS never pass through the fetch handler and never get cached. The shell
  // then loads offline and dies fetching the app.
  expect(cached).toContain('/index.html');
  expect(cached.some((u) => /^\/assets\/.*\.js$/.test(u))).toBe(true);
  expect(cached.some((u) => /^\/assets\/.*\.css$/.test(u))).toBe(true);
});

/**
 * The cold offline start — airplane mode, app closed, open it and get a map — is **not verified
 * here, and cannot be**. Playwright's offline emulation fails renderer-initiated loads before the
 * service worker sees them: `fetch()` through the worker returns the cached asset fine, while
 * `<script src>` for the same URL fails. So a passing test would prove nothing and a failing one
 * accuses the wrong thing.
 *
 * The test above covers the mechanism (the shell is cached, including the app). The behaviour
 * belongs to [quickstart.md](../../../specs/001-shared-bearing-picture/quickstart.md) Level 4, on
 * a real phone in real airplane mode with the HTTP cache cleared — which is what it already says,
 * and this is why.
 */
test.skip('the app cold-starts with no network — device check, quickstart Level 4', () => {});

test('a blank basemap is expected, and the reports still draw', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  // Block the tile host specifically, which is the field case: no basemap, but the relay and the
  // local log are untouched. Principle III's wording is "degrading only to the reports the device
  // already holds" — it is the context that goes, never a report.
  await context.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.reload();
  await page.getByTestId('report-bar').waitFor();

  await reportHeardNothing(page);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(1);

  // An unreachable tile host must not read as an error — it is what a hunt looks like.
  const status = (await page.getByTestId('status-bar').textContent()) ?? '';
  expect(status).not.toMatch(/error|failed|problem/i);
});
