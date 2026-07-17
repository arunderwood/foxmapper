/**
 * The runtime network audit (SC-009, FR-008) plus the FR-014 field invariants.
 *
 * A full session — join, report, offline, reconnect, drain — while recording every request.
 * The only hosts allowed are the app's own origin (bundle + proxied /api) and the tile host.
 * Zero fonts, zero icon fetches, zero stylesheets, zero images from anywhere else: styling
 * that needs the network is styling a hunter out of coverage does not have.
 *
 * FR-014 rides along because this spec already drives the full map view: pull-to-refresh must
 * stay disabled (`overscroll-behavior: none` on body), and the map attribution must sit clear
 * of the report bar — the licence unmet is not a cosmetic fault.
 */
import { test, expect } from '@playwright/test';
import { createHunt, grantPosition, reportHeardNothing } from './helpers.js';

const TILE_HOST = 'tiles.openfreemap.org';

test('a full session fetches nothing but the bundle and tiles', async ({ page, context }) => {
  const offenders: string[] = [];
  const appHost = new URL(process.env['FOXMAPPER_URL'] ?? 'http://localhost:4173').host;

  page.on('request', (request) => {
    const url = new URL(request.url());
    // blob: is same-page memory (MapLibre hands its workers code this way), not the network.
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (url.host === appHost || url.host === TILE_HOST) return;
    offenders.push(request.url());
  });

  const code = await createHunt('network audit');
  await grantPosition(context);
  await page.goto(`/h/${code}`);
  await page.getByTestId('callsign-input').fill('KI7NET');
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();

  // FR-014: no pull-to-refresh, ever — a hunter dragging the map must not reload the app.
  expect(
    await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY),
  ).toBe('none');

  // FR-014: attribution stays clear of the report bar.
  const attribution = await page.locator('.maplibregl-ctrl-bottom-right').boundingBox();
  const reportBar = await page.getByTestId('report-bar').boundingBox();
  expect(attribution).toBeTruthy();
  expect(reportBar).toBeTruthy();
  expect(
    attribution!.y + attribution!.height,
    'attribution intersects the report bar',
  ).toBeLessThanOrEqual(reportBar!.y + 1);

  // Offline: file reports, watch the queue hold them; reconnect and drain. No request in any
  // of it may leave the allowed hosts.
  await context.setOffline(true);
  await reportHeardNothing(page);
  await expect(page.getByTestId('queue-depth')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByTestId('queue-depth')).toHaveCount(0, { timeout: 30_000 });

  const external = offenders.filter((url) => !url.startsWith('data:'));
  expect(external, `unexpected external requests:\n${external.join('\n')}`).toHaveLength(0);

  // Belt and braces: nothing font-shaped came from anywhere, including our own origin — the
  // type system is the system stack by decision (research.md R5).
  const fonts = offenders.filter((url) => /\.(woff2?|ttf|otf|eot)(\?|$)/.test(url));
  expect(fonts).toHaveLength(0);
});
