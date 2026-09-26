/**
 * SC-002: with 500 active reports, a new report moves the region within 2 seconds, on a phone-class
 * CPU (Chromium throttled 4×), with the network cut.
 *
 * A wall-clock budget means nothing while other browsers compete for the same cores, so this file
 * has a Playwright project of its own that starts only after every other project has finished
 * (playwright.config.ts).
 */
import { expect, test } from '@playwright/test';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { SCENARIOS } from '../reference/scenarios.js';
import { drawnRegions, regionCount, retag, seedLog, toReport } from './estimate-helpers.js';
import { createHunt, grantPosition, joinAs, reportHeardNothing } from './helpers.js';

test('500 reports: a new report moves the region within 2 s at 4× CPU throttling (SC-002)', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium DevTools feature');
  test.setTimeout(120_000);
  const big = SCENARIOS.find((s) => s.name === 'five-hundred')!;
  await grantPosition(context, { latitude: big.fox.lat, longitude: big.fox.lon });
  const code = await createHunt('Five hundred');
  await joinAs(page, code, 'K7BIG');

  // Straight into this device's log, with the relay cut off: 500 reports through the relay would
  // spend the rate-limit bucket every other test is sharing.
  await context.route('**/api/**', (route) => route.abort());
  const reports = retag(big.reports).map((r) => toReport(r, code));
  await seedLog(page, reports, { estimate: true });

  await page.reload();
  await page.getByTestId('report-bar').waitFor();
  await expect.poll(() => regionCount(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();
  const before = await drawnRegions(page);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const started = Date.now();
  await reportHeardNothing(page);
  await page.waitForFunction(
    (previous) => {
      const map = (window as unknown as { __map?: MapLibreMap }).__map;
      const source = map?.getSource('estimate') as GeoJSONSource | undefined;
      const data = (source?.serialize() as { data?: GeoJSON.FeatureCollection } | undefined)?.data;
      const now = JSON.stringify(
        (data?.features ?? []).map((f) => [f.geometry, f.properties?.['probability']]),
      );
      return now !== previous;
    },
    before,
    { timeout: 10_000, polling: 50 },
  );
  const elapsed = Date.now() - started;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  console.log(`SC-002: 500 reports, 4× throttled, region moved ${elapsed} ms after the report`);
  expect(elapsed).toBeLessThan(2_000);
});
