/**
 * SC-001: link to map in under 15 seconds, cold.
 *
 * The threshold is from a cold link on real cell, which this cannot simulate — see T073. What it
 * can prove is that nothing in the join path *blocks*: no account, no round-trip, no install.
 */
import { expect, test } from '@playwright/test';
import { createHunt, grantPosition } from './helpers.js';

test('a hunter goes from link to map in under 15 seconds', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();

  const start = Date.now();
  await page.goto(`/h/${code}`);
  await page.getByTestId('callsign-input').fill('KI7XYZ');
  await page.getByTestId('join-button').click();
  await page.getByTestId('map').waitFor();
  await page.getByTestId('report-bar').waitFor();
  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(15_000);
});

test('joining needs no account, no install and no payment', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await page.goto(`/h/${code}`);

  const body = (await page.getByTestId('join-screen').textContent()) ?? '';
  expect(body).not.toMatch(/password|sign in|log in|register|email|\$|subscribe/i);
  // A callsign is the whole of it.
  await expect(page.getByTestId('callsign-input')).toBeVisible();
});

test('the target is shown before any report arrives', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt('Stuck mic on the 146.96 machine');
  await page.goto(`/h/${code}`);

  await expect(page.getByTestId('join-target')).toContainText('Stuck mic on the 146.96 machine');
});

test('the join screen does not wait for the network — FR-002, Constitution III', async ({
  page,
  context,
}) => {
  // The target fetch used to be awaited before the join screen was rendered, under a comment
  // claiming it never blocked. Offline it rejected fast and the claim held by luck; a captive
  // portal or a weak link — which is what "out of coverage" usually looks like — left the
  // participant staring at nothing for the life of the request. Joining is a purely local act.
  await grantPosition(context);
  const code = await createHunt('Saturday fox');

  // A relay that accepts the connection and then says nothing at all.
  await page.route(/\/api\/hunts\/[^/]+$/, () => {
    /* never resolves */
  });

  await page.goto(`/h/${code}`);
  await expect(page.getByTestId('callsign-input')).toBeVisible({ timeout: 10_000 });
  // The code stands in until the target lands, so the hunter knows which hunt they are joining.
  await expect(page.getByTestId('join-target')).toContainText(code);
});

test('joining is not interrupted by the target arriving', async ({ page, context }) => {
  // The target fills the line in place. Re-rendering the screen instead raced the hunter: it wiped
  // a half-typed callsign, and if they had already joined it replaced the map with a join screen
  // for the hunt they were in — a hang that reproduced about once in twenty-four runs.
  await grantPosition(context);
  const code = await createHunt('Saturday fox');
  await page.goto(`/h/${code}`);

  await page.getByTestId('callsign-input').fill('KI7XYZ');
  await page.getByTestId('join-button').click();

  // The map comes up and stays up.
  await page.getByTestId('report-bar').waitFor();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('report-bar')).toBeVisible();
  await expect(page.getByTestId('join-screen')).toHaveCount(0);
  // ...and the target reaches the map even though it landed after the join.
  await expect(page.getByTestId('target-label')).toHaveText('Saturday fox');
});

test('the limits are in the interface, not in terms of service', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt();
  await page.goto(`/h/${code}`);

  // FR-022 and FR-027. Not behind a link, not in a modal to dismiss.
  const limits = page.getByTestId('limits');
  await expect(limits).toBeVisible();
  await expect(limits).toContainText(/not certified/i);
  await expect(limits).toContainText(/only as good as the reports/i);
  await expect(limits).toContainText(/anyone with the hunt link/i);
});

test('joining works with the network already gone', async ({ page, context }) => {
  // Principle III: a participant who loaded the link and then lost coverage can still join. There
  // is no join endpoint to fail — this proves it structurally.
  await grantPosition(context);
  const code = await createHunt();
  await page.goto(`/h/${code}`);
  await page.getByTestId('join-form').waitFor();

  await context.setOffline(true);
  await page.getByTestId('callsign-input').fill('KI7XYZ');
  await page.getByTestId('join-button').click();

  await expect(page.getByTestId('report-bar')).toBeVisible();
  await context.setOffline(false);
});

test('returning to the app reopens the last hunt', async ({ page, context }) => {
  // FR-004c. No hunt list, no switcher.
  await grantPosition(context);
  const code = await createHunt();
  await page.goto(`/h/${code}`);
  await page.getByTestId('callsign-input').fill('KI7XYZ');
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();

  await page.goto('/');
  await expect(page.getByTestId('report-bar')).toBeVisible();
  await expect(page.getByTestId('start-screen')).toHaveCount(0);
});
