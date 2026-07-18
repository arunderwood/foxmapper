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

  test('the rose rotates about the dial centre, not a corner', async ({ page, context }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7ROT');

    await page.getByTestId('report-bearing').click();
    const rotator = page.getByTestId('compass-dial').locator('.rose-rotator');

    // The rose is a near-circular shape drawn symmetric about the viewBox origin. Rotate it about
    // its own centre and its on-screen bounding box barely moves; rotate it about a corner and the
    // whole rose swings off — its box centre lands far from the dial. Set two headings via the
    // accessible field and measure the rose's box centre against the dial's own.
    const centreAt = async (deg: number): Promise<{ rose: number[]; svg: number[] }> => {
      await page.getByTestId('heading-input').fill(String(deg));
      // The fill commits synchronously and rotates the rose; wait for the transform to land rather
      // than race it. (The numeric field keeps the raw typed value while focused, so its formatting
      // is not what to key off — the applied rotation is.)
      await expect(rotator).toHaveAttribute('style', new RegExp(`rotate\\(-?${deg}deg\\)`));
      return page.evaluate(() => {
        const dial = document.querySelector('[data-testid="compass-dial"]')!;
        const rose = dial.querySelector('.rose-rotator')!.getBoundingClientRect();
        const svg = dial.querySelector('.dial-rose')!.getBoundingClientRect();
        return {
          rose: [rose.x + rose.width / 2, rose.y + rose.height / 2],
          svg: [svg.x + svg.width / 2, svg.y + svg.height / 2],
        };
      });
    };

    const c0 = await centreAt(0);
    const c90 = await centreAt(90);

    // Invariant under rotation (about centre), and coincident with the dial centre.
    expect(Math.hypot(c90.rose[0]! - c0.rose[0]!, c90.rose[1]! - c0.rose[1]!)).toBeLessThan(4);
    expect(Math.hypot(c0.rose[0]! - c0.svg[0]!, c0.rose[1]! - c0.svg[1]!)).toBeLessThan(8);
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
