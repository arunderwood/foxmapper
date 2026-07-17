/**
 * The reduced-motion audit (SC-006, FR-005).
 *
 * With the OS preference set, every state change still happens — sheets open, chips update —
 * but nothing decorates the journey: no animation or transition longer than 50 ms may run.
 * The stylesheet's global kill (`animation: none; transition: none` under the media query) is
 * the mechanism; this spec is the proof it survives every restyle.
 */
import { test, expect, type Page } from '@playwright/test';
import { createHunt, grantPosition } from './helpers.js';

/** Longest running animation/transition on the page right now, in ms. */
async function longestMotion(page: Page): Promise<number> {
  return page.evaluate(() => {
    const durations = document.getAnimations().map((animation) => {
      const timing = animation.effect?.getTiming();
      const duration = typeof timing?.duration === 'number' ? timing.duration : 0;
      return duration + Number(timing?.delay ?? 0);
    });
    return durations.length ? Math.max(...durations) : 0;
  });
}

test('reduced motion: state changes complete with no animation over 50ms', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const code = await createHunt('reduced motion audit');
  await grantPosition(context);
  await page.goto(`/h/${code}`);

  expect(await longestMotion(page)).toBeLessThanOrEqual(50);

  await page.getByTestId('callsign-input').fill('KI7RDM');
  await page.getByTestId('join-button').click();
  await page.getByTestId('report-bar').waitFor();
  await page.locator('[data-testid="gps-state"][data-ready="true"]').waitFor();
  expect(await longestMotion(page)).toBeLessThanOrEqual(50);

  // The sheet — the most motion-decorated affordance — must still open and close instantly.
  for (const kind of ['bearing', 'omni', 'null', 'fix']) {
    await page.getByTestId(`report-${kind}`).click();
    await page.getByTestId('sheet').waitFor();
    expect(
      await longestMotion(page),
      `sheet-${kind} animated under reduced motion`,
    ).toBeLessThanOrEqual(50);
    await page.getByTestId('sheet').click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId('sheet')).toHaveCount(0);
  }

  // A status change still lands (offline chip appears) without motion.
  await context.setOffline(true);
  await expect(page.getByTestId('sync-state')).toBeVisible();
  expect(await longestMotion(page)).toBeLessThanOrEqual(50);
  await context.setOffline(false);
});
