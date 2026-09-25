/**
 * The location estimate, end to end (specs/006-location-estimate/quickstart.md §4).
 *
 * The map's own sources and the status bar are read rather than canvas pixels: the region count is
 * published on the status bar, the warnings are chips, and the regions are the `estimate` source's
 * features. The same engine also runs here, in the test process, so a browser's result can be
 * compared byte for byte with what the reference hunts produce (SC-005).
 *
 * SC-002's timing lives in estimate-timing.spec.ts, which runs alone.
 */
import { expect, test } from '@playwright/test';
import { estimate } from '../../src/estimate/estimate.js';
import { toEstimateInput } from '../../src/estimate/input.js';
import { SCENARIOS } from '../reference/scenarios.js';
import { Ids, nullAt } from '../reference/simulate.js';
import {
  crossing,
  device,
  drawnRegions,
  expectedChips,
  expectedRegions,
  HOME,
  huntWith,
  localHunt,
  regionCount,
  seedLog,
  setEstimate,
  toReport,
  warningKinds,
} from './estimate-helpers.js';
import {
  grantPosition,
  joinAs,
  reportBearing,
  reportHeardNothing,
  retractOwnReport,
} from './helpers.js';

// Most of these hunts never reach the relay (localHunt). WebKit sends a service worker's network
// requests past Playwright's routing, so the worker stays out of this file except where it is the
// thing under test.
test.use({ serviceWorkers: 'block' });

test('off by default: no region and no estimate warnings (FR-029, SC-011)', async ({
  page,
  context,
}) => {
  await localHunt(page, context, 'K7OFF', crossing(HOME, [0, 120, 240]));

  await expect.poll(() => drawnRegions(page)).toBe('[]');
  await expect(page.getByTestId('estimate-warning')).toHaveCount(0);
  expect(await regionCount(page)).toBe(0);
  await expect(page.getByTestId('estimate-toggle')).toHaveCount(0);
});

test('switched on, two crossing bearings draw one region; a third lifts "too few" (FR-001, FR-010)', async ({
  page,
  context,
}) => {
  await localHunt(page, context, 'K7ONE', crossing(HOME, [0, 110]));
  await setEstimate(page, true);

  await expect.poll(() => regionCount(page)).toBe(1);
  await expect.poll(() => warningKinds(page)).toContain('too_few');

  // A third bearing, from where the other two cross.
  await reportBearing(page, 90);
  await expect.poll(() => warningKinds(page), { timeout: 15_000 }).not.toContain('too_few');
  expect(await regionCount(page)).toBe(1);
});

test('one bearing: a region, and "too few reports" (scenario 2)', async ({ page, context }) => {
  await localHunt(page, context, 'K7TWO', crossing(HOME, [200]));
  await setEstimate(page, true);

  await expect.poll(() => regionCount(page)).toBe(1);
  await expect.poll(() => warningKinds(page)).toContain('too_few');
});

test('two groups pointing apart: two regions, and "the reports disagree" (FR-012)', async ({
  page,
  context,
}) => {
  const groups = SCENARIOS.find((s) => s.name === 'two-groups')!;
  await localHunt(page, context, 'K7GRP', groups.reports);
  await setEstimate(page, true);

  await expect.poll(() => regionCount(page)).toBe(2);
  await expect.poll(() => warningKinds(page)).toContain('disagree');
});

test('only "heard nothing": no region, and nothing points at the fox (FR-015)', async ({
  page,
  context,
}) => {
  const ids = new Ids(7);
  await localHunt(
    page,
    context,
    'K7NUL',
    [0, 120, 240].map((from) => nullAt(ids, HOME, { from, km: 2 })),
  );
  await setEstimate(page, true);

  await expect.poll(() => warningKinds(page)).toEqual(['none']);
  expect(await regionCount(page)).toBe(0);
});

test('a retraction recomputes the region on another device (FR-007, scenario 9)', async ({
  browser,
}) => {
  const code = await huntWith(crossing(HOME, [10, 130, 250]));
  const hunter = await device(browser, code, 'K7RET', HOME);
  const watcher = await device(browser, code, 'K7WCH');
  await setEstimate(watcher.page, true);

  await expect.poll(() => regionCount(watcher.page)).toBe(1);
  const before = await drawnRegions(watcher.page);

  // "Heard nothing" right where the bearings cross: the region must give ground.
  await reportHeardNothing(hunter.page);
  await expect.poll(() => drawnRegions(watcher.page), { timeout: 15_000 }).not.toBe(before);

  await retractOwnReport(hunter.page);
  await expect.poll(() => drawnRegions(watcher.page), { timeout: 15_000 }).toBe(before);

  await hunter.context.close();
  await watcher.context.close();
});

test('switching off clears this map at once and no other (FR-031, scenario 13)', async ({
  browser,
}) => {
  const code = await huntWith(crossing(HOME, [0, 120, 240]));
  const one = await device(browser, code, 'K7AAA');
  const two = await device(browser, code, 'K7BBB');
  await setEstimate(one.page, true);
  await setEstimate(two.page, true);
  await expect.poll(() => regionCount(one.page)).toBe(1);
  await expect.poll(() => regionCount(two.page)).toBe(1);

  await setEstimate(one.page, false);
  expect(await regionCount(one.page)).toBe(0);
  expect(await drawnRegions(one.page)).toBe('[]');
  await expect(one.page.getByTestId('estimate-warning')).toHaveCount(0);

  expect(await regionCount(two.page)).toBe(1);

  await one.context.close();
  await two.context.close();
});

test('the choice survives a restart, and the region follows a report filed offline (FR-020, FR-030)', async ({
  page,
  context,
}) => {
  await localHunt(page, context, 'K7RST', crossing(HOME, [0, 120, 240]));
  await setEstimate(page, true);
  await expect.poll(() => regionCount(page)).toBe(1);

  await page.reload();
  await page.getByTestId('report-bar').waitFor();
  await expect.poll(() => regionCount(page)).toBe(1);
  const before = await drawnRegions(page);

  // A cold offline start cannot be emulated here (see offline.spec.ts); a report filed with the
  // network gone can, and the region has to follow it.
  await context.setOffline(true);
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();
  await reportHeardNothing(page);
  await expect.poll(() => drawnRegions(page), { timeout: 10_000 }).not.toBe(before);
  await context.setOffline(false);
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('a first switch-on with no network still draws, after one online visit (research R10)', async ({
    page,
    context,
    browserName,
  }) => {
    // WebKit's offline emulation fails a load the browser starts itself before the service worker
    // sees it — the same limit offline.spec.ts records for `<script src>` — so a worker cannot start
    // there even with its script cached. The cache half still runs; iOS itself is a device check.
    const workerStartsOffline = browserName !== 'webkit';
    await grantPosition(context);
    await joinAs(page, await huntWith(crossing(HOME, [0, 120, 240])), 'K7COLD');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    // The warm-up put the worker in the shell cache without the estimate ever being on.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          for (const name of await caches.keys()) {
            for (const request of await (await caches.open(name)).keys()) {
              if (/\/assets\/worker-[\w-]+\.js$/.test(new URL(request.url).pathname)) return true;
            }
          }
          return false;
        }),
      )
      .toBe(true);

    if (!workerStartsOffline) return;
    await context.setOffline(true);
    await setEstimate(page, true);
    await expect.poll(() => regionCount(page), { timeout: 15_000 }).toBe(1);
    await context.setOffline(false);
  });
});

test('the browser draws exactly what the reference engine computes (SC-005, FR-018)', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  // Each scenario goes straight into this device's log, with no relay in between: the browser and
  // the engine here then read the very same numbers.
  const code = await localHunt(page, context, 'K7REF');

  for (const name of [
    'one-bearing',
    'two-crossing',
    'two-groups',
    'signal-strength-and-heard-nothing',
    'two-conflicting-finds',
    'one-wrong-bearing',
    'heard-nothing-at-the-fox',
  ]) {
    const scenario = SCENARIOS.find((s) => s.name === name)!;
    const records = scenario.reports.map((r) => toReport(r, code));
    const expected = estimate(toEstimateInput(records, 0));

    await seedLog(page, records, { replace: true, estimate: true });
    await page.reload();
    await page.getByTestId('report-bar').waitFor();

    await expect
      .poll(() => drawnRegions(page), { message: name, timeout: 15_000 })
      .toBe(expectedRegions(expected));
    await expect.poll(() => warningKinds(page), { message: name }).toEqual(expectedChips(expected));
  }
});

test('switching sends only whether it is on (FR-041)', async ({ page, context }) => {
  await context.addInitScript(() => {
    const events: { event: string; props: unknown }[] = [];
    (window as unknown as { __events: typeof events }).__events = events;
    (
      window as unknown as { __foxmapperTrack: (event: string, props?: unknown) => void }
    ).__foxmapperTrack = (event, props) => events.push({ event, props });
  });
  await localHunt(page, context, 'K7ANL');

  await setEstimate(page, true);
  await setEstimate(page, false);

  const events = await page.evaluate(
    () => (window as unknown as { __events: { event: string; props: unknown }[] }).__events,
  );
  expect(events.filter((e) => e.event === 'estimate_toggled')).toEqual([
    { event: 'estimate_toggled', props: { enabled: true } },
    { event: 'estimate_toggled', props: { enabled: false } },
  ]);
});
