/**
 * The first-visit product tour (spec 003, US1 + US2).
 *
 * Every assertion here is one a first-timer's experience rests on: the tour is *offered* not forced,
 * it walks the core loop in order, it works with the network gone, it is operable by keyboard alone,
 * and declining it costs nothing. The share step (US2) is checked in the same walk since it is one
 * more stop on the same overlay.
 *
 * A fresh Playwright context per test means a fresh IndexedDB, so `tour_state` starts `unseen` and
 * the offer appears — exactly the first-time condition the feature is about.
 */
import { test, expect, type Page } from '@playwright/test';
import { createHunt, grantPosition, joinAs } from './helpers.js';

/** The fixed order of the walkthrough (data-model.md), share included (US2). */
const STEP_ORDER = ['estimate', 'bearing', 'omni', 'null', 'share', 'finish'] as const;

async function openHunt(page: Page, context: Parameters<typeof grantPosition>[0]): Promise<void> {
  const code = await createHunt('tour walkthrough');
  await grantPosition(context);
  await joinAs(page, code, 'KI7TUR');
}

/** The tour status this device has persisted to the `meta` store (`unseen` when there is none). */
async function persistedStatus(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('foxmapper');
        req.onsuccess = () => {
          const store = req.result.transaction('meta', 'readonly').objectStore('meta');
          const get = store.get('tour_state');
          get.onsuccess = () =>
            resolve((get.result as { status?: string } | undefined)?.status ?? 'unseen');
          get.onerror = () => resolve('error');
        };
        req.onerror = () => resolve('open-error');
      }),
  );
}

test('offers the tour on the first hunt view and walks the core loop in order', async ({
  page,
  context,
}) => {
  await openHunt(page, context);

  // Offered, and non-blocking: the report bar underneath is already usable.
  await expect(page.getByTestId('tour-offer')).toBeVisible();
  await expect(page.getByTestId('report-bar')).toBeVisible();

  await page.getByTestId('tour-offer-accept').click();
  await expect(page.getByTestId('tour-overlay')).toBeVisible();

  for (let i = 0; i < STEP_ORDER.length; i++) {
    await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', STEP_ORDER[i]!);
    await expect(page.getByTestId('tour-progress')).toHaveText(
      `Step ${i + 1} of ${STEP_ORDER.length}`,
    );
    await expect(page.getByTestId('tour-step-title')).not.toBeEmpty();

    const isLast = i === STEP_ORDER.length - 1;
    await expect(page.getByTestId('tour-next')).toHaveText(isLast ? 'Done' : 'Next');
    await page.getByTestId('tour-next').click();
  }

  // Finishing lands on a live, usable hunt view — not a dead-end modal (FR-015).
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
  await expect(page.getByTestId('report-bar')).toBeVisible();

  // Completion is durably recorded, then never re-offered unprompted (FR-013). Waiting on the
  // persisted state keeps this about the record, not about out-racing an async write.
  await expect.poll(() => persistedStatus(page)).toBe('completed');
  await page.reload();
  await page.getByTestId('report-bar').waitFor();
  await expect(page.getByTestId('tour-offer')).toHaveCount(0);
});

test('the estimate step shows a region sample and the omni step names the stock handheld', async ({
  page,
  context,
}) => {
  await openHunt(page, context);
  await page.getByTestId('tour-offer-accept').click();

  // estimate: the walkthrough opens here now, and the scripted credible-region sample stands in on
  // an empty hunt (FR-014) — a region, not a point.
  await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', 'estimate');
  await expect(page.getByTestId('tour-sample')).toBeVisible();

  // omni: a stock handheld can contribute (FR-008 / Principle II).
  for (const to of ['bearing', 'omni']) {
    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', to);
  }
  await expect(page.getByTestId('tour-step-body')).toContainText('handheld');
});

test('the share step spotlights the share affordance and explains how a teammate joins (US2)', async ({
  page,
  context,
}) => {
  await openHunt(page, context);
  await page.getByTestId('tour-offer-accept').click();

  // The walkthrough opens on estimate; advance to the share step.
  await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', 'estimate');
  for (const to of ['bearing', 'omni', 'null', 'share']) {
    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', to);
  }

  // The share step spotlights the real share affordance...
  const spotlight = await page.getByTestId('tour-spotlight').boundingBox();
  const share = await page.getByTestId('share-hunt').boundingBox();
  expect(spotlight).not.toBeNull();
  expect(share).not.toBeNull();
  expect(rectsOverlap(spotlight!, share!)).toBe(true);

  // ...and its copy explains that a teammate joins by opening the shared link.
  await expect(page.getByTestId('tour-step-body')).toContainText('share the hunt');
});

test('is fully operable by keyboard, and the scrim and Esc both exit', async ({
  page,
  context,
}) => {
  await openHunt(page, context);
  await page.getByTestId('tour-offer-accept').click();
  await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', 'estimate');

  // Focus lands in the callout when a step becomes active (FR-020).
  await expect(page.getByTestId('tour-callout')).toBeFocused();

  // Arrow keys advance and go back.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', 'bearing');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', 'estimate');

  // Enter (with focus on the callout, not a button) advances too.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', 'bearing');

  // Esc exits, leaving the hunt usable.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
  await expect(page.getByTestId('report-bar')).toBeVisible();

  // Relaunch from Settings, then exit via a scrim tap (a click outside the callout).
  await page.getByTestId('open-settings').click();
  await page.getByTestId('replay-tour').click();
  await expect(page.getByTestId('tour-overlay')).toBeVisible();
  await page.getByTestId('tour-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
});

test('honours reduced motion: the overlay runs with no animation over 50ms (FR-020)', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHunt(page, context);
  await page.getByTestId('tour-offer-accept').click();
  await expect(page.getByTestId('tour-overlay')).toBeVisible();

  // Advance a few steps — including the spotlight jumping between anchors — and confirm nothing
  // decorates the journey. (The walkthrough opens on estimate.)
  for (const to of ['bearing', 'omni', 'null']) {
    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', to);
    const longest = await page.evaluate(() =>
      document
        .getAnimations()
        .map((a) => {
          const t = a.effect?.getTiming();
          return (typeof t?.duration === 'number' ? t.duration : 0) + Number(t?.delay ?? 0);
        })
        .reduce((max, d) => Math.max(max, d), 0),
    );
    expect(longest, `a step transition animated under reduced motion`).toBeLessThanOrEqual(50);
  }
});

test('declining and mid-tour exit add zero steps to reporting (SC-005)', async ({
  page,
  context,
}) => {
  // Decline path: the offer goes away and a report is filed with no tour steps in between.
  await openHunt(page, context);
  await page.getByTestId('tour-offer-decline').click();
  await expect(page.getByTestId('tour-offer')).toHaveCount(0);
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0);

  await page.getByTestId('report-null').click();
  await page.getByTestId('send-null').click();
  await expect(page.getByTestId('sheet')).toHaveCount(0);

  // Declined is terminal (FR-013): once the decline is recorded, reloading does not bring it back.
  await expect.poll(() => persistedStatus(page)).toBe('declined');
  await page.reload();
  await page.getByTestId('report-bar').waitFor();
  await expect(page.getByTestId('tour-offer')).toHaveCount(0);
});

test('runs start to finish with the network offline and adds no dependency (FR-012, SC-004)', async ({
  page,
  context,
}) => {
  await openHunt(page, context);

  // The tour must introduce no network dependency of its own. The app's own origin and the tile
  // host are the only allowed destinations (network-audit.spec.ts); anything else while the tour
  // runs would be the tour reaching out.
  const appHost = new URL(process.env['FOXMAPPER_URL'] ?? 'http://localhost:4173').host;
  const TILE_HOST = 'tiles.openfreemap.org';
  const offenders: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (url.host === appHost || url.host === TILE_HOST) return;
    offenders.push(request.url());
  });

  await context.setOffline(true);
  await page.getByTestId('tour-offer-accept').click();

  // Every step still starts, advances and completes with the network gone (SC-004).
  for (let i = 0; i < STEP_ORDER.length; i++) {
    await expect(page.getByTestId('tour-overlay')).toHaveAttribute('data-step', STEP_ORDER[i]!);
    await page.getByTestId('tour-next').click();
  }
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
  await expect(page.getByTestId('report-bar')).toBeVisible();

  expect(offenders, `the tour reached external hosts:\n${offenders.join('\n')}`).toEqual([]);

  await context.setOffline(false);
});

/** True when two viewport rectangles share any area. */
function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
