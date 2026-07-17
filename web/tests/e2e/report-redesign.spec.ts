/**
 * US1 — reporting reads as an instrument (spec 002, acceptance scenarios 1–4).
 *
 * The four kinds are visual equals identified by icon + label; a press answers during the
 * press (the M3 state layer, not a post-release colour swap); sheets belong to the tap that
 * opened them and leave the way they came; a report of every kind still files.
 */
import { test, expect } from '@playwright/test';
import { createHunt, grantPosition, joinAs, localReports } from './helpers.js';

const KINDS = ['bearing', 'omni', 'null', 'fix'] as const;

test.beforeEach(async ({ page, context }) => {
  const code = await createHunt('us1 report redesign');
  await grantPosition(context);
  await joinAs(page, code, 'KI7US1');
});

test('four equal kind buttons, each icon + visible label', async ({ page }) => {
  const boxes = [];
  for (const kind of KINDS) {
    const button = page.getByTestId(`report-${kind}`);
    // The glyph is present and hidden from the tree; the visible label carries the meaning.
    await expect(button.locator('svg.icon[aria-hidden="true"]')).toHaveCount(1);
    await expect(button.locator('.kind-label')).toBeVisible();
    await expect(button.locator('.kind-label')).not.toHaveText('');
    boxes.push((await button.boundingBox())!);
  }
  // Visual equals: same size, same row (constitution II as geometry).
  const widths = boxes.map((b) => Math.round(b.width));
  const heights = boxes.map((b) => Math.round(b.height));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});

test('the press answers during the press: state layer visible on :active', async ({ page }) => {
  const button = page.getByTestId('report-bearing');
  const box = (await button.boundingBox())!;

  // Resting: no layer. (Read before the pointer arrives — hover is itself a state layer.)
  const restingOpacity = await button.evaluate(
    (node) => getComputedStyle(node, '::after').opacity,
  );
  expect(Number(restingOpacity)).toBe(0);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const hoverOpacity = await button.evaluate((node) => getComputedStyle(node, '::after').opacity);

  await page.mouse.down();
  const pressed = await button.evaluate((node) => ({
    layer: getComputedStyle(node, '::after').opacity,
    transform: getComputedStyle(node).transform,
  }));
  await page.mouse.up();
  await page.getByTestId('sheet').waitFor();

  // Both press channels: the state layer fades in past hover AND the button dips — sun-proof.
  expect(Number(pressed.layer)).toBeGreaterThan(0.1);
  expect(Number(pressed.layer)).toBeGreaterThan(Number(hoverOpacity));
  expect(pressed.transform).not.toBe('none');
});

test('sheets carry their kind identity and dismiss both ways', async ({ page }) => {
  for (const kind of KINDS) {
    await page.getByTestId(`report-${kind}`).click();
    const sheet = page.getByTestId('sheet');
    await sheet.waitFor();

    // The header wears the same icon + hue class as the button that opened it. Direct child:
    // the close button inside the header carries its own (close) icon.
    await expect(sheet.locator(`.sheet-header.kind-${kind} > svg.icon`)).toHaveCount(1);
    await expect(sheet.locator('.sheet-header h2')).toBeVisible();

    // Close affordance (icon-only, sanctioned) — and it actually closes.
    await sheet.getByTestId('close-sheet').click();
    await expect(page.getByTestId('sheet')).toHaveCount(0);

    // Backdrop dismiss still works too: the sheet leaves the way it arrived.
    await page.getByTestId(`report-${kind}`).click();
    await page.getByTestId('sheet').waitFor();
    await page.getByTestId('sheet').click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId('sheet')).toHaveCount(0);
  }
});

test('a report of every kind still files', async ({ page }) => {
  // Bearing: heading + confidence + range.
  await page.getByTestId('report-bearing').click();
  await page.getByTestId('heading-input').fill('120');
  await page.getByTestId('confidence-1').click();
  await page.getByTestId('range-1').click();
  await page.getByTestId('send-bearing').click();
  await expect(page.getByTestId('sheet')).toHaveCount(0);

  // Signal: one strength tap sends.
  await page.getByTestId('report-omni').click();
  await page.getByTestId('strength-1').click();
  await expect(page.getByTestId('sheet')).toHaveCount(0);

  // Nothing here, and Found it: single confirming tap each.
  await page.getByTestId('report-null').click();
  await page.getByTestId('send-null').click();
  await expect(page.getByTestId('sheet')).toHaveCount(0);
  await page.getByTestId('report-fix').click();
  await page.getByTestId('send-fix').click();
  await expect(page.getByTestId('sheet')).toHaveCount(0);

  await expect
    .poll(async () => (await localReports(page)).map((r) => r.kind).sort())
    .toEqual(['bearing', 'fix', 'null', 'omni']);
});
