/**
 * Feature 005: the number you see is the direction you get.
 *
 * The reported confusion: a bearing "entered as zero" rendered ~15° east of map north — a correct
 * conversion applied invisibly between entry and display. These flows pin the fix end-to-end: the
 * dial displays true north with the frame labeled, the entered value is what the log stores,
 * verbatim, and the chip's switch face previews the conversion before it is taken.
 *
 * Expected values are computed with the same `geomagnetism` package the app bundles, at the same
 * position and date, so assertions are exact rather than range-loose.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  createHunt,
  declinationDegrees,
  dialFormat,
  grantPosition,
  joinAs,
  localBearingPayloads,
} from './helpers.js';

/** Where the relayed hunter was standing — not where net control sits. */
const OBSERVER_AT = { lat: 48.9, lon: -122.6 };

/** Circular distance in degrees — 359.99 and 0.01 are 0.02 apart, not 359.98. */
const circularGap = (a: number, b: number): number => {
  const gap = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(gap, 360 - gap);
};

/**
 * Taps just inside a wedge, away from its apex. The shared `tapReport` clicks the polygon's first
 * vertex — the observer's position — which on the *authoring* device is also where the self-pin
 * sits and swallows the click. A short step along the wedge's centerline is unambiguous.
 */
async function tapOwnWedge(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    interface MapLike {
      isMoving(): boolean;
      isZooming(): boolean;
      getSource(id: string): { serialize(): { data?: GeoJSON.FeatureCollection } } | undefined;
      project(coords: [number, number]): { x: number; y: number };
    }
    const map = (window as unknown as { __map?: MapLike }).__map;
    if (!map || map.isMoving() || map.isZooming()) return false;
    const data = map.getSource('reports-wedges')?.serialize().data;
    return (data?.features?.length ?? 0) > 0;
  });
  const point = await page.evaluate(() => {
    interface MapLike {
      getSource(id: string): { serialize(): { data?: GeoJSON.FeatureCollection } } | undefined;
      project(coords: [number, number]): { x: number; y: number };
    }
    const map = (window as unknown as { __map?: MapLike }).__map;
    const feature = map?.getSource('reports-wedges')?.serialize().data?.features?.[0];
    if (!map || !feature || feature.geometry.type !== 'Polygon') return null;
    const ring = feature.geometry.coordinates[0]!;
    const apex = map.project(ring[0] as [number, number]);
    const midArc = map.project(ring[Math.floor(ring.length / 2)] as [number, number]);
    // A fixed 60px step from the apex toward the wedge interior: inside the sector, clear of the
    // self-pin, and still on-screen even on a phone viewport where the arc is far off the edge.
    const dx = midArc.x - apex.x;
    const dy = midArc.y - apex.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: apex.x + (dx / length) * 60, y: apex.y + (dy / length) * 60 };
  });
  if (!point) throw new Error('no wedge to tap');
  await page.getByTestId('map').click({ position: point });
  await page.getByTestId('report-detail').waitFor();
}

/** Feed one Android-style absolute-orientation sample for magnetic heading `m`. */
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

test.describe('entry and map agree (US1, SC-001)', () => {
  test('a compass pointed at true north reads 0.0° true, and the log stores exactly that', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'orientation emulation is Chromium-only');
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7TRU');

    const decl = declinationDegrees();
    // Point the device at true north: the sensor reads magnetic 360−decl (≈344.5 in Bellingham).
    const magneticNorthward = (360 - decl) % 360;

    await page.getByTestId('report-bearing').click();
    await expect(page.getByTestId('ref-unit')).toHaveText('° true');

    await setHeading(page, magneticNorthward);
    await page.getByTestId('freeze').click();
    // The screenshot case, fixed: pointing at true north reads as due north — not 15° off.
    await expect(page.getByTestId('heading-input')).toHaveValue('0.0');

    await page.getByTestId('confidence-1').click();
    await page.getByTestId('range-1').click();
    await page.getByTestId('send-bearing').click();

    await expect.poll(async () => (await localBearingPayloads(page)).length).toBe(1);
    const [payload] = await localBearingPayloads(page);
    // The displayed number IS the stored number — the wedge draws heading_true, so entry, log,
    // and map are one fact (FR-003). The magnetic counterpart is derived by exactly `decl`.
    expect(circularGap(payload!.heading_true, 0)).toBeLessThan(0.01);
    expect(circularGap(payload!.heading_magnetic, magneticNorthward)).toBeLessThan(0.01);
    expect(payload!.declination).toBeCloseTo(decl, 5);
  });

  test('the chip converts there and back without drift, direction unchanged (flow 6)', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'orientation emulation is Chromium-only');
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7FLP');

    const decl = declinationDegrees();
    const magneticNorthward = (360 - decl) % 360;

    await page.getByTestId('report-bearing').click();
    await setHeading(page, magneticNorthward);

    // While live the frame is not the reporter's to choose — the stream is true, full stop.
    await expect(page.getByTestId('ref-switch')).toBeDisabled();
    await page.getByTestId('freeze').click();
    await expect(page.getByTestId('ref-switch')).toBeEnabled();

    // The switch face shows the number it would switch to, before the tap (FR-005).
    await expect(page.getByTestId('ref-switch')).toHaveText(
      `= ${dialFormat(magneticNorthward)}° magnetic`,
    );

    // Flip: same direction, magnetic clothing.
    await page.getByTestId('ref-switch').click();
    await expect(page.getByTestId('ref-unit')).toHaveText('° magnetic');
    await expect(page.getByTestId('heading-input')).toHaveValue(dialFormat(magneticNorthward));

    // Flip back: the exact original, no accumulated drift.
    await page.getByTestId('ref-switch').click();
    await expect(page.getByTestId('ref-unit')).toHaveText('° true');
    await expect(page.getByTestId('heading-input')).toHaveValue('0.0');
  });

  test('a fresh typed number lands as magnetic — the empty-state rule (FR-005)', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7TYP');

    await page.getByTestId('report-bearing').click();
    // The compass sheet opens speaking true…
    await expect(page.getByTestId('ref-unit')).toHaveText('° true');
    await expect(page.getByTestId('ref-switch')).toHaveText('enter as magnetic');

    // …but a number typed from a physical compass is magnetic unless the reporter says otherwise.
    await page.getByTestId('heading-input').fill('220');
    await expect(page.getByTestId('ref-unit')).toHaveText('° magnetic');

    await page.getByTestId('confidence-1').click();
    await page.getByTestId('range-1').click();
    await page.getByTestId('send-bearing').click();

    await expect.poll(async () => (await localBearingPayloads(page)).length).toBe(1);
    const [payload] = await localBearingPayloads(page);
    // Entered verbatim as magnetic; true derived by the local declination.
    expect(payload!.heading_magnetic).toBe(220);
    expect(circularGap(payload!.heading_true, 220 + declinationDegrees())).toBeLessThan(0.01);
  });
});

test.describe('net control relays a magnetic bearing (US2, SC-002)', () => {
  test("types 220, performs zero arithmetic — converted at the hunter's position", async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'W7NET');

    // Relay mode on, target armed: who, and where THEY were standing.
    await page.getByTestId('open-settings').click();
    await page.getByTestId('relay-mode-toggle').click();
    await page.getByTestId('close-settings').click();
    await page.getByTestId('begin-relay').click();
    await page.getByTestId('relay-callsign').fill('KI7XYZ');
    await page.getByTestId('relay-lat').fill(String(OBSERVER_AT.lat));
    await page.getByTestId('relay-lon').fill(String(OBSERVER_AT.lon));
    await page.getByTestId('relay-ready').click();
    await page.getByTestId('relay-armed').waitFor();

    await page.getByTestId('report-bearing').click();
    // A dictated bearing is almost always a physical-compass reading: magnetic, by default,
    // with the frame named at the point of entry (FR-005).
    await expect(page.getByTestId('ref-unit')).toHaveText('° magnetic');

    await page.getByTestId('heading-input').fill('220');
    // The switch face is the free sanity check: "220 magnetic" and its true equivalent differ by
    // exactly the declination at the HUNTER's position (FR-006), visible before anything is filed.
    const observerDecl = declinationDegrees(OBSERVER_AT.lat, OBSERVER_AT.lon);
    await expect(page.getByTestId('ref-switch')).toHaveText(
      `= ${dialFormat(220 + observerDecl)}° true`,
    );

    await page.getByTestId('confidence-0').click();
    await page.getByTestId('range-1').click();
    await page.getByTestId('send-bearing').click();

    await expect.poll(async () => (await localBearingPayloads(page)).length).toBe(1);
    const [payload] = await localBearingPayloads(page);
    // Verbatim what was heard on the air; true derived with the observer's declination, not net
    // control's. Net control did no arithmetic anywhere in this flow.
    expect(payload!.heading_magnetic).toBe(220);
    expect(circularGap(payload!.heading_true, 220 + observerDecl)).toBeLessThan(0.01);
  });
});

test.describe('the on-demand detail (US3, SC-005)', () => {
  test('a bearing popup shows both frames; the retract path is right there', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7DET');

    await page.getByTestId('report-bearing').click();
    await page.getByTestId('heading-input').fill('220');
    await page.getByTestId('confidence-1').click();
    await page.getByTestId('range-1').click();
    await page.getByTestId('send-bearing').click();
    await expect.poll(async () => (await localBearingPayloads(page)).length).toBe(1);

    await tapOwnWedge(page);
    const wholeTrue = Math.round(220 + declinationDegrees()) % 360;
    await expect(page.getByTestId('bearing-both-ways')).toHaveText(
      `Bearing ${wholeTrue}° true (220° on a magnetic compass)`,
    );
    // A wrong-reference entry is corrected by supersession, and the way there is on this popup.
    await expect(page.getByTestId('retract')).toBeVisible();
  });

  test('settings says the local declination in plain words, two taps from the map', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7SET');

    await page.getByTestId('open-settings').click();
    const note = page.getByTestId('north-note');
    const expected = Math.round(Math.abs(declinationDegrees()));
    await expect(note).toContainText(
      `Magnetic north is about ${expected}° east of true north here.`,
    );
    await expect(note).toContainText(/Using the \d{4} magnetic model\./);
    await expect(note).toContainText('Bearings on the map are true north');
    // The word is allowed only here, defined by the sentence around it — and the default copy
    // avoids it entirely (FR-012).
    await expect(note).not.toContainText(/declination/i);
  });

  test('an out-of-date magnetic model is said plainly, not hidden (FR-009)', async ({
    page,
    context,
  }) => {
    // Past the model's validity window the value is still shown — refusing would be the larger
    // error — with its staleness declared where the value is.
    await page.clock.setFixedTime(new Date('2030-06-01T12:00:00Z'));
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7OLD');

    await page.getByTestId('open-settings').click();
    const note = page.getByTestId('north-note');
    await expect(note).toContainText('east of true north here');
    await expect(note).toContainText('That model is out of date');
  });
});

test.describe('offline is the normal case (FR-007)', () => {
  test('conversion, labels and the switch preview need no network at all', async ({
    page,
    context,
  }) => {
    await grantPosition(context);
    await joinAs(page, await createHunt(), 'KI7OFF');
    // The whole hunt happens out of coverage: the magnetic model is on-device, so entry,
    // conversion, preview and filing all proceed; sync catches up whenever it can.
    await context.setOffline(true);

    await page.getByTestId('report-bearing').click();
    await expect(page.getByTestId('ref-unit')).toHaveText('° true');
    await page.getByTestId('heading-input').fill('220');
    await expect(page.getByTestId('ref-unit')).toHaveText('° magnetic');
    await expect(page.getByTestId('ref-switch')).toHaveText(
      `= ${dialFormat(220 + declinationDegrees())}° true`,
    );

    await page.getByTestId('confidence-1').click();
    await page.getByTestId('range-1').click();
    await page.getByTestId('send-bearing').click();

    await expect.poll(async () => (await localBearingPayloads(page)).length).toBe(1);
    const [payload] = await localBearingPayloads(page);
    expect(payload!.heading_magnetic).toBe(220);
    expect(circularGap(payload!.heading_true, 220 + declinationDegrees())).toBeLessThan(0.01);

    await context.setOffline(false);
  });
});
