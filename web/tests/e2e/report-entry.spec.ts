/**
 * What a report must contain before it can be sent.
 *
 * Every field guarded here is one the log attributes to the reporter by name. A value they never
 * chose, recorded as though they did, is the confident-looking wrongness Principle I rejects — and
 * it is worse than an empty map, because nobody can tell it apart from a real claim.
 */
import { expect, test } from '@playwright/test';
import { createHunt, grantPosition, joinAs, localReports } from './helpers.js';

const AT = { latitude: 48.79, longitude: -122.51 };

test('a bearing cannot be sent without a heading — FR-008b', async ({ page, context }) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await page.getByTestId('report-bearing').click();

  // The heading starts empty rather than at 0. Zero is due north — a real claim — and a reporter
  // who picks confidence and range without touching the compass would have filed it under their
  // own callsign.
  await expect(page.getByTestId('heading-input')).toHaveValue('');

  await page.getByTestId('confidence-0').click();
  await page.getByTestId('range-1').click();
  await expect(page.getByTestId('send-bearing')).toBeDisabled();

  // Only once the reporter says which way does it go.
  await page.getByTestId('heading-input').fill('270');
  await expect(page.getByTestId('send-bearing')).toBeEnabled();
});

test('a bearing cannot be sent without confidence and range — FR-006', async ({
  page,
  context,
}) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await page.getByTestId('report-bearing').click();
  await page.getByTestId('heading-input').fill('270');
  await expect(page.getByTestId('send-bearing')).toBeDisabled();

  await page.getByTestId('confidence-0').click();
  await expect(page.getByTestId('send-bearing')).toBeDisabled();

  await page.getByTestId('range-1').click();
  await expect(page.getByTestId('send-bearing')).toBeEnabled();
});

test('all four kinds are reachable from the one bar — FR-005d', async ({ page, context }) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  // Principle II as a layout: none of these is behind a menu, and none is smaller than another.
  for (const kind of ['bearing', 'omni', 'null', 'fix']) {
    await expect(page.getByTestId(`report-${kind}`)).toBeVisible();
  }

  const sizes = await page.evaluate(() =>
    ['bearing', 'omni', 'null', 'fix'].map((k) => {
      const el = document.querySelector(`[data-testid="report-${k}"]`)!;
      const r = el.getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height);
    }),
  );
  expect(new Set(sizes).size).toBe(1);
});

test('the hunt code is on the map — FR-001', async ({ page, context }) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  // A hunt is its code: it gets read aloud over a repeater. A creator whose only copy of it is the
  // address bar has been handed a hunt they cannot invite anyone to.
  await expect(page.getByTestId('hunt-code')).toContainText(code);
  await expect(page.getByTestId('share-hunt')).toBeVisible();
});

test('sharing the hunt puts its link on the clipboard — FR-001', async ({
  page,
  context,
  browserName,
}) => {
  // Chromium only: WebKit does not implement Playwright's clipboard permission, so the assertion
  // cannot be made there. The requirement is not browser-specific — the coverage is.
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');

  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('share-hunt').click();
  await expect(page.getByTestId('share-status')).toContainText('Link copied');

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`/h/${code}`);
});

test('a signal report is one tap, and says nothing about direction — SC-001b', async ({
  page,
  context,
}) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  await page.getByTestId('report-omni').click();
  await page.getByTestId('strength-1').click();

  await expect.poll(async () => (await localReports(page)).length, { timeout: 5_000 }).toBe(1);
  expect((await localReports(page))[0]!.kind).toBe('omni');
});
