/**
 * A hunt over time: what a device knows offline, and what happens when the hunt is gone.
 *
 * FR-004b puts the target in the primary view; FR-004c promises the remembered hunt reopens
 * offline. Together they mean the target cannot live only in a fetch — and the spec is exact about
 * the other end: a participant "is not dropped into a purged hunt. They land where a first-time
 * visitor lands."
 */
import { expect, test } from '@playwright/test';
import { createHunt, grantPosition, joinAs, reportHeardNothing } from './helpers.js';

const AT = { latitude: 48.79, longitude: -122.51 };

/**
 * These tests answer the relay themselves, and a service-worker-controlled page makes its requests
 * from the worker — which Playwright cannot intercept in WebKit. Left on, the mocks silently do
 * nothing there and the tests pass against the live relay, proving nothing.
 *
 * Blocking it costs these tests nothing: neither is about the worker. The offline app-shell path it
 * does own is covered in offline.spec.
 */
test.use({ serviceWorkers: 'block' });

test('the target survives a reopen with the relay unreachable — FR-004b/c', async ({
  page,
  context,
}) => {
  await grantPosition(context, AT);
  const code = await createHunt('Saturday fox');
  await joinAs(page, code, 'KI7XYZ');
  await expect(page.getByTestId('target-label')).toHaveText('Saturday fox');

  // The hunter reopens the hunt out of coverage. The hunt is remembered; the target has to be too,
  // or the primary view forgets what is being hunted — and FR-004b puts the frequency there.
  //
  // The relay is made unreachable rather than the whole network: loading the app shell with no
  // network at all depends on the service worker precache, which this suite deliberately leaves to
  // the device check (quickstart Level 4). What is under test here is the target cache.
  await page.route(/\/api\/hunts\/[^/]+$/, (route) => route.abort());
  await page.reload();
  await page.getByTestId('report-bar').waitFor();

  await expect(page.getByTestId('target-label')).toHaveText('Saturday fox');
  await expect(page.getByTestId('target-frequency')).toHaveText('146.52');
});

test('a target this device was never told is not invented', async ({ page, context }) => {
  await grantPosition(context, AT);
  const code = await createHunt('Saturday fox');

  // Joined, then straight offline before the target fetch could land — and the app must say it
  // does not know rather than show a plausible label nobody typed.
  await page.route(/\/api\/hunts\/[^/]+$/, (route) => route.abort());
  await page.goto(`/h/${code}`);
  await page.getByTestId('callsign-input').fill('KI7XYZ');
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();

  await expect(page.getByTestId('target-unknown')).toBeVisible();
  await expect(page.getByTestId('target-label')).toHaveCount(0);
});

test('a purged hunt lands the participant where a newcomer lands — FR-004c', async ({
  page,
  context,
}) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  // The hunt goes away underneath them: purged after 30 idle days, which the relay answers with a
  // 404. Served here rather than by waiting a month — the purge itself is the server's test
  // (server/tests/purge.rs); what is under test is what this device does about it.
  // A RegExp, not a glob: the glob form silently matched nothing in WebKit, so the test passed in
  // Chromium and hung everywhere else while the relay answered normally.
  await page.route(/\/api\/hunts\//, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );

  await reportHeardNothing(page);

  // They are not left sitting in a dead hunt while sync reconnects to a 204 and polls a 404
  // forever. They land where a first-time visitor lands.
  await expect(page.getByTestId('start-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('report-bar')).toHaveCount(0);

  // ...and the dead code is forgotten, so opening the app afresh does not march them back into it.
  // Opening the *link* again would legitimately return them there — the link is the durable handle
  // for a hunt, and a hunter who taps it means to go. It is the remembered hunt that is dropped.
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
});
