/**
 * The Content-Security-Policy, exercised rather than reviewed.
 *
 * A CSP is the one kind of change that passes every unit test and then breaks the product in the
 * field, because nothing it forbids is forbidden until a real browser loads a real page. So this
 * drives the paths that would actually trip it — the map painting tiles, a bearing filed, a report
 * retracted — with every violation the browser raises collected and asserted empty.
 *
 * `Permissions-Policy` gets the same treatment for the same reason, and a stronger one: geolocation
 * is the app's core sensor, and `geolocation=()` is a plausible-looking spelling that would kill
 * every report silently, outdoors, where nobody is watching a console.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createHunt,
  grantPosition,
  joinAs,
  renderedFeatures,
  reportBearing,
  reportHeardNothing,
  retractOwnReport,
} from './helpers.js';

interface Violation {
  directive: string;
  blocked: string;
}

declare global {
  interface Window {
    __cspViolations?: Violation[];
  }
}

/**
 * Collects violations from the page itself rather than by matching console text: the event carries
 * which directive fired and what it blocked, which is the difference between a failure that names
 * the fix and one that says a test went red.
 */
async function collectViolations(page: Page): Promise<Violation[]> {
  return (await page.evaluate(() => window.__cspViolations ?? [])) as Violation[];
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });
});

test('the document is served with the security headers', async ({ page }) => {
  const response = await page.goto('/');
  expect(response).toBeTruthy();
  const headers = response!.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['permissions-policy']).toContain('geolocation=(self)');

  const csp = headers['content-security-policy'] ?? '';
  // Spot-checked by directive, not by whole string: what matters is that each one is present and
  // that none of them opened a hole, which a single equality assertion states less clearly.
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
});

test('a full session — map, report, retraction — raises no CSP violation', async ({
  page,
  context,
}) => {
  await grantPosition(context);
  const code = await createHunt('csp');
  await joinAs(page, code, 'KI7CSP');

  // The map is the hard part: MapLibre's worker, the tile host, and the sprites that arrive as
  // blobs are each governed by a different directive.
  await page.waitForFunction(() => {
    const map = (window as unknown as { __map?: { isStyleLoaded(): boolean } }).__map;
    return Boolean(map?.isStyleLoaded());
  });
  await expect(page.getByTestId('map')).toBeVisible();

  // Heard-nothing first, and retracted, because a retraction is reached by tapping the report on
  // the map: a marker can be tapped where it sits, while a wedge's apex is under the self-pin on
  // the device that authored it.
  await reportHeardNothing(page);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(1);
  await retractOwnReport(page);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(0);

  // Then a bearing, which paints a wedge — a different draw path, and the one with the dial and
  // the compass behind it.
  await reportBearing(page);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBeGreaterThan(0);

  const violations = await collectViolations(page);
  expect(
    violations,
    `CSP violations:\n${violations.map((v) => `${v.directive} blocked ${v.blocked}`).join('\n')}`,
  ).toHaveLength(0);
});

test('geolocation still works under the Permissions-Policy', async ({ page, context }) => {
  await grantPosition(context);
  const code = await createHunt('csp geolocation');

  // The header itself, at the source: a policy that omitted the app's own origin rejects this
  // before the permission prompt is ever consulted.
  await page.goto(`/h/${code}`);
  const fix = await page.evaluate(
    () =>
      new Promise<{ lat: number; lon: number } | string>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
          (error) => resolve(`${error.code}: ${error.message}`),
        );
      }),
  );
  expect(typeof fix, `getCurrentPosition failed: ${JSON.stringify(fix)}`).toBe('object');

  // And through the app, because a header can permit the sensor while the reporting flow still
  // falls back to hand-placement — which files a different, weaker claim.
  await page.getByTestId('callsign-input').fill('KI7GEO');
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();

  await reportBearing(page);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBeGreaterThan(0);
  const [report] = await renderedFeatures(page);
  expect(report?.placed, 'the report was hand-placed, so the device never got a fix').toBe(false);

  expect(await collectViolations(page)).toHaveLength(0);
});
