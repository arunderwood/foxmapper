/**
 * The touch-target audit (SC-002, FR-013).
 *
 * Every interactive element the app draws must offer a gloved thumb at least 56×56 px — the
 * field floor `--fx-touch` records. Walked across every surface: join screen, map chrome, all
 * four report sheets, a report popup, and the hand-placement banner. Run at two widths: a
 * default phone, and a narrow 320 px where labels must compress before targets do.
 *
 * Exemption: `.maplibregl-ctrl` (the attribution control) is licence furniture rendered by
 * MapLibre, not an app affordance — enlarging it to 56 px would fight the map for room the
 * report bar already defends. Everything FoxMapper itself draws is held to the floor.
 */
import { test, expect, type Page } from '@playwright/test';
import { createHunt, grantPosition, reportHeardNothing, tapReport } from './helpers.js';

const FLOOR = 56;

/** Asserts every visible interactive element in scope meets the floor. */
async function auditTargets(page: Page, surface: string): Promise<void> {
  const elements = page.locator(
    'button:visible, a:visible, input:visible, [role="button"]:visible, [role="radio"]:visible',
  );
  const count = await elements.count();
  expect(count, `${surface}: no interactive elements found — selector drift?`).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const element = elements.nth(i);
    if (await element.evaluate((node) => Boolean(node.closest('.maplibregl-ctrl')))) continue;
    const box = await element.boundingBox();
    const name = await element.evaluate(
      (node) => node.getAttribute('data-testid') ?? node.textContent?.slice(0, 30) ?? node.tagName,
    );
    expect(box, `${surface}: "${name}" has no box`).toBeTruthy();
    expect(box!.height, `${surface}: "${name}" height ${box!.height}`).toBeGreaterThanOrEqual(FLOOR);
    expect(box!.width, `${surface}: "${name}" width ${box!.width}`).toBeGreaterThanOrEqual(FLOOR);
  }
}

async function walk(page: Page, surface: string): Promise<void> {
  await auditTargets(page, `${surface}/join`);

  await page.getByTestId('callsign-input').fill('KI7AUD');
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();
  await auditTargets(page, `${surface}/map`);

  // The four kind buttons stay equal at any width: none may shrink below its siblings.
  const kindBoxes = [];
  for (const kind of ['bearing', 'omni', 'null', 'fix']) {
    const box = await page.getByTestId(`report-${kind}`).boundingBox();
    expect(box).toBeTruthy();
    kindBoxes.push(box!);
  }
  const widths = kindBoxes.map((b) => Math.round(b.width));
  expect(Math.max(...widths) - Math.min(...widths), `${surface}: kind buttons unequal`).toBeLessThanOrEqual(1);

  for (const kind of ['bearing', 'omni', 'null', 'fix']) {
    await page.getByTestId(`report-${kind}`).click();
    await page.getByTestId('sheet').waitFor();
    await auditTargets(page, `${surface}/sheet-${kind}`);
    await page.getByTestId('sheet').click({ position: { x: 8, y: 8 } }); // backdrop dismiss
    await expect(page.getByTestId('sheet')).toHaveCount(0);
  }

  // The hand-placement banner.
  await page.getByTestId('place-position').click();
  await page.getByTestId('placing-banner').waitFor();
  await auditTargets(page, `${surface}/placing-banner`);
  await page.getByTestId('cancel-placing').click();

  // A report popup.
  await reportHeardNothing(page);
  await tapReport(page);
  await auditTargets(page, `${surface}/popup`);
}

test('every interactive target ≥ 56px — default phone viewport', async ({ page, context }) => {
  const code = await createHunt('targets audit');
  await grantPosition(context);
  await page.goto(`/h/${code}`);
  await walk(page, 'default');
});

test('every interactive target ≥ 56px — narrow 320px viewport', async ({ page, context }) => {
  const code = await createHunt('targets audit narrow');
  await grantPosition(context);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/h/${code}`);
  await walk(page, '320px');
});
