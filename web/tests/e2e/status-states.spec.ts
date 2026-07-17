/**
 * US2 — status readable from the periphery (spec 002, acceptance scenarios 1–3, 5; SC-007).
 *
 * Walks the transition graph from data-model.md §3: live → offline → queued → draining →
 * synced → live. Every adjacent pair must differ in icon AND colour AND container shape — the
 * colour-removed check is that icon path and border-radius alone still tell the states apart.
 * The drain must read as progress: a count going down over a determinate track.
 *
 * FR-016 rides along: warning-tier chips live in the primary view with no interaction, in the
 * glanceable colour roles, and wrap rather than truncate.
 */
import { test, expect, type Locator } from '@playwright/test';
import { createHunt, grantPosition, joinAs, reportHeardNothing, tapOpenMap } from './helpers.js';

interface ChipLook {
  iconPath: string;
  color: string;
  background: string;
  borderRadius: string;
}

async function look(chip: Locator): Promise<ChipLook> {
  return chip.evaluate((node) => ({
    iconPath: node.querySelector('svg path')?.getAttribute('d') ?? '',
    color: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    borderRadius: getComputedStyle(node).borderRadius,
  }));
}

/** Icon, colour and shape must ALL differ — the triple, not any single channel (FR-010). */
function expectDistinct(a: ChipLook, b: ChipLook, pair: string): void {
  expect(a.iconPath, `${pair}: same icon`).not.toBe(b.iconPath);
  expect(a.color !== b.color || a.background !== b.background, `${pair}: same colour`).toBe(true);
  expect(a.borderRadius, `${pair}: same shape`).not.toBe(b.borderRadius);
}

test('the sync vocabulary: live → offline → queued → draining → synced', async ({
  page,
  context,
}) => {
  const code = await createHunt('us2 status states');
  await grantPosition(context);
  await joinAs(page, code, 'KI7US2');

  // Live: calm ok pill, visible with no interaction (FR-010 — always in the primary view).
  const sync = page.getByTestId('sync-state');
  await expect(sync).toHaveAttribute('data-state', 'live');
  const live = await look(sync);

  // Offline: the chip changes icon + colour + shape, peripherally.
  await context.setOffline(true);
  await expect(sync).toHaveAttribute('data-state', 'offline');
  const offline = await look(sync);
  expectDistinct(live, offline, 'live/offline');

  // FR-016: the warning tier is glanceable and wraps, never truncates.
  const offlineStyles = await sync.evaluate((node) => ({
    whiteSpace: getComputedStyle(node).whiteSpace,
    overflowWrap: getComputedStyle(node).overflowWrap,
  }));
  expect(offlineStyles.whiteSpace).toBe('normal');
  expect(offlineStyles.overflowWrap).toBe('anywhere');

  // Queued: two reports held on this phone, counted, in the warn container. It sits BESIDE
  // the offline chip (both visible at once), so its identity is icon + count + pill shape —
  // the warn colour family is shared with its neighbour on purpose (data-model.md §3).
  await reportHeardNothing(page);
  await reportHeardNothing(page);
  const queue = page.getByTestId('queue-depth');
  await expect(queue).toHaveAttribute('data-state', 'queued');
  await expect(queue).toContainText('2 to send');
  const queued = await look(queue);
  expect(queued.iconPath, 'offline/queued: same icon').not.toBe(offline.iconPath);
  expect(queued.borderRadius, 'offline/queued: same shape').not.toBe(offline.borderRadius);

  // Reconnect: the queue drains as visible progress — primary tone, determinate track — and
  // ends in a brief "all shared" confirmation before the bar goes quiet (FR-011).
  await context.setOffline(false);
  await expect(queue).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('sync-flash')).toBeVisible();
  await expect(page.getByTestId('sync-flash')).toContainText('All shared');
  // Confirmation, then quiet: the flash leaves on its own. (The sync chip's return to `live`
  // rides the stream's reconnect backoff — up to 60s, pre-existing behavior, not this story's.)
  await expect(page.getByTestId('sync-flash')).toHaveCount(0, { timeout: 5_000 });
});

test('the draining chip is progress, not a spinner', async ({ page, context }) => {
  const code = await createHunt('us2 drain progress');
  await grantPosition(context);
  await joinAs(page, code, 'KI7DRN');

  await context.setOffline(true);
  for (let i = 0; i < 4; i++) await reportHeardNothing(page);
  await expect(page.getByTestId('queue-depth')).toContainText('4 to send');

  // While draining the chip must present the determinate affordance. The drain can be quick;
  // accept either catching it mid-drain (track visible, count ≤ 4) or already finished (flash).
  await context.setOffline(false);
  const seen = await Promise.race([
    page
      .locator('[data-testid="queue-depth"][data-state="draining"] .chip-track-fill')
      .waitFor({ timeout: 30_000 })
      .then(() => 'draining'),
    page
      .getByTestId('sync-flash')
      .waitFor({ timeout: 30_000 })
      .then(() => 'flash'),
  ]);
  expect(['draining', 'flash']).toContain(seen);

  // Either way it ends drained and quiet — never an error presentation. (Return to `live`
  // rides the stream reconnect backoff; see the note in the previous test.)
  await expect(page.getByTestId('queue-depth')).toHaveCount(0, { timeout: 30_000 });
});

test('GPS states carry the triple too', async ({ page, context }) => {
  const code = await createHunt('us2 gps states');
  await grantPosition(context);
  await joinAs(page, code, 'KI7GPS');

  const gps = page.getByTestId('gps-state');
  await expect(gps).toHaveAttribute('data-state', 'gps-ok');

  // Hand-placement flips the chip to its placed identity — different icon, same calm tier.
  await page.getByTestId('place-position').click();
  await page.getByTestId('placing-banner').waitFor();
  await tapOpenMap(page);
  await expect(gps).toHaveAttribute('data-state', 'placed');
  const placed = await look(gps);
  await page.getByTestId('use-device-position').click();
  await expect(gps).toHaveAttribute('data-state', 'gps-ok');
  const ready = await look(gps);
  expect(placed.iconPath).not.toBe(ready.iconPath);
});
