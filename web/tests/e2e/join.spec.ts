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
