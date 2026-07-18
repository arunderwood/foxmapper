/**
 * The bearing dial (feature 003): live compass + freeze, twist to correct/set, the by-hand path on
 * a phone with no compass, and the accessible numeric route. Orientation-driven tests run on
 * Chromium only — headless WebKit does not deliver `deviceorientationabsolute`.
 */
import { test, expect, type Page } from '@playwright/test';
import { createHunt, grantPosition, joinAs, localReports } from './helpers.js';

/** Feed the app one absolute-orientation sample for magnetic heading `m` (Android-style path). */
async function setHeading(page: Page, m: number): Promise<void> {
  await page.evaluate((magnetic) => {
    const alpha = (360 - magnetic + 360) % 360;
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientationabsolute', {
        alpha,
        beta: 0,
        gamma: 0,
        absolute: true,
      }),
    );
  }, m);
}

async function pickConfidenceRangeAndSend(page: Page): Promise<void> {
  await page.getByTestId('confidence-1').click();
  await page.getByTestId('range-1').click();
  await page.getByTestId('send-bearing').click();
}

test.describe('compass dial', () => {
  test('opens unset: Send stays disabled until a freeze or twist (SC-007, FR-003a)', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7AAA');

    await page.getByTestId('report-bearing').click();
    // No committed heading, no due-north default.
    await expect(page.getByTestId('heading-input')).toHaveValue('');
    await expect(page.getByTestId('send-bearing')).toBeDisabled();
    // Even with confidence + range chosen, still disabled until a heading is committed.
    await page.getByTestId('confidence-1').click();
    await page.getByTestId('range-1').click();
    await expect(page.getByTestId('send-bearing')).toBeDisabled();
  });

  test('the dial is a magnetic instrument — no declination control (FR-016)', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7DEC');
    await page.getByTestId('report-bearing').click();
    const dial = page.getByTestId('compass-dial');
    await expect(dial).toBeVisible();
    await expect(dial.getByText(/declinat/i)).toHaveCount(0);
    await expect(dial.getByText(/true north/i)).toHaveCount(0);
  });

  test('auto-live, freeze, and the frozen value does not drift (SC-002)', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'orientation emulation is Chromium-only');
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7BBB');

    await page.getByTestId('report-bearing').click();
    // Android-style auto-live: no start control needed.
    await expect(page.getByTestId('use-compass')).toBeHidden();

    await setHeading(page, 90);
    await expect(page.getByTestId('freeze')).toBeVisible();
    await page.getByTestId('freeze').click();
    await expect(page.getByTestId('heading-input')).toHaveValue('90.0');

    // A later reading must not move a frozen bearing.
    await setHeading(page, 200);
    await expect(page.getByTestId('heading-input')).toHaveValue('90.0');

    await pickConfidenceRangeAndSend(page);
    await expect
      .poll(async () => (await localReports(page)).filter((r) => r.kind === 'bearing').length)
      .toBe(1);
  });

  test('iOS-style explicit start behind a permission gesture (FR-004)', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'orientation emulation is Chromium-only');
    // Make the platform look like iOS: a gesture-gated requestPermission that grants.
    await page.addInitScript(() => {
      (
        window.DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission = () => Promise.resolve('granted');
    });
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7IOS');

    await page.getByTestId('report-bearing').click();
    // No auto-live here — the start control must be offered.
    await expect(page.getByTestId('use-compass')).toBeVisible();
    await page.getByTestId('use-compass').click();
    await setHeading(page, 45);
    await page.getByTestId('freeze').click();
    await expect(page.getByTestId('heading-input')).toHaveValue('45.0');
  });

  test('twist corrects a frozen bearing and detaches from the sensor (SC-004, FR-009)', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'orientation emulation is Chromium-only');
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7CCC');

    await page.getByTestId('report-bearing').click();
    await setHeading(page, 90);
    await page.getByTestId('freeze').click();
    await expect(page.getByTestId('heading-input')).toHaveValue('90.0');

    // Sweep the finger 90° clockwise about the dial centre (top → right). Grab-and-follow moves the
    // heading the other way: 90 → 0. Hover first so the sheet's enter animation has settled — raw
    // mouse coordinates do not auto-wait for stability the way actionable clicks do.
    const face = page.getByTestId('compass-dial').locator('.dial-face');
    await face.hover();
    const box = await face.boundingBox();
    if (!box) throw new Error('no dial box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy - box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.35, cy, { steps: 12 });
    await page.mouse.up();

    const after = Number(await page.getByTestId('heading-input').inputValue());
    expect(Math.abs(((after - 0 + 540) % 360) - 180)).toBeLessThan(10); // ≈ 0°, within tolerance

    // A subsequent sensor reading must not override the twisted value (FR-009).
    await setHeading(page, 250);
    const held = Number(await page.getByTestId('heading-input').inputValue());
    expect(Math.abs(held - after)).toBeLessThan(1);
  });

  test('a phone with no compass sets a bearing by twist alone, no keyboard (SC-005, FR-011)', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7DDD');

    await page.getByTestId('report-bearing').click();
    // No compass ever reports: no start control (no permission model here) and no Freeze appears.
    await expect(page.getByTestId('use-compass')).toBeHidden();
    await expect(page.getByTestId('freeze')).toBeHidden();

    const face = page.getByTestId('compass-dial').locator('.dial-face');
    await face.hover(); // let the sheet's enter animation settle before raw-mouse dragging
    const box = await face.boundingBox();
    if (!box) throw new Error('no dial box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx + box.width * 0.35, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - box.height * 0.35, { steps: 12 });
    await page.mouse.up();

    // A heading is now committed — set with zero keystrokes.
    await expect(page.getByTestId('heading-input')).not.toHaveValue('');
    await pickConfidenceRangeAndSend(page);
    await expect
      .poll(async () => (await localReports(page)).filter((r) => r.kind === 'bearing').length)
      .toBe(1);
  });

  test('accessible without the gesture: set by the numeric field alone (SC-010)', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7EEE');

    await page.getByTestId('report-bearing').click();
    // The rose is decorative to assistive tech.
    await expect(page.getByTestId('compass-dial').locator('.dial-rose')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await page.getByTestId('heading-input').fill('123');
    await expect(page.getByTestId('heading-input')).toHaveValue('123');
    await pickConfidenceRangeAndSend(page);
    await expect
      .poll(async () => (await localReports(page)).filter((r) => r.kind === 'bearing').length)
      .toBe(1);
  });
});
