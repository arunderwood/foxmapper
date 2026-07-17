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

/**
 * Asserts every visible interactive element in scope meets the floor.
 *
 * One atomic page.evaluate on purpose: the status bar rebuilds about once a second, so a
 * locator walked element-by-element can check the exemption on one element and measure a
 * different one. Layout boxes (offset*), not boundingBox — a press-scale transform mid-release
 * or sub-pixel rounding must not fail the audit; the *laid-out* target is what the floor
 * governs.
 */
async function auditTargets(page: Page, surface: string): Promise<void> {
  const result = await page.evaluate((floor) => {
    const candidates = document.querySelectorAll<HTMLElement>(
      'button, a, input, [role="button"], [role="radio"]',
    );
    const violations: string[] = [];
    let audited = 0;
    for (const node of candidates) {
      // Visible, and not MapLibre's licence furniture (the one exemption, documented above).
      if (node.closest('[class*="maplibregl-ctrl"]')) continue;
      if (node.offsetParent === null && getComputedStyle(node).position !== 'fixed') continue;
      audited++;
      const name =
        node.getAttribute('data-testid') ?? node.textContent?.slice(0, 30) ?? node.tagName;
      if (node.offsetHeight < floor - 0.5 || node.offsetWidth < floor - 0.5) {
        violations.push(`"${name}" ${node.offsetWidth}×${node.offsetHeight}`);
      }
    }
    return { audited, violations };
  }, FLOOR);

  expect(
    result.audited,
    `${surface}: no interactive elements found — selector drift?`,
  ).toBeGreaterThan(0);
  expect(result.violations, `${surface}: targets under ${FLOOR}px`).toEqual([]);
}

async function walk(page: Page, surface: string): Promise<void> {
  await page.getByTestId('callsign-input').waitFor();
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
  expect(
    Math.max(...widths) - Math.min(...widths),
    `${surface}: kind buttons unequal`,
  ).toBeLessThanOrEqual(1);

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

  // A report popup. Wait for the report to reach the map's sources before projecting a tap —
  // filing is durable-first and the render follows a beat later.
  await reportHeardNothing(page);
  await page.waitForFunction(() => {
    const map = (window as unknown as { __map?: maplibregl.Map }).__map;
    const source = map?.getSource('reports-markers') as maplibregl.GeoJSONSource | undefined;
    const data = (source?.serialize() as { data?: GeoJSON.FeatureCollection } | undefined)?.data;
    return (data?.features?.length ?? 0) > 0;
  });
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
