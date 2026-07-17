/**
 * US1's Independent Test, mechanically — SC-003.
 *
 * The spec asks for *"four people in different locations [who] join one hunt, each submits one
 * bearing, and each can see the other three rendered on their own device within seconds."*
 *
 * **This is not that test, and must not be mistaken for it.** Four browser contexts are not four
 * people, four geolocations are not four places, and a loopback relay is not real cell at a
 * trailhead. What this proves is the *mechanism*: four independent participants, four independent
 * logs, no report missing on any of them.
 *
 * The rest — four real phones, four real hunters, real coverage — is T066, deferred with the field
 * debt (constitution 1.1.0). The half that needed people is still owed.
 */
import { expect, test, type Browser } from '@playwright/test';
import { createHunt, grantPosition, joinAs, renderedFeatures, reportBearing } from './helpers.js';

/** Four locations, spread far enough apart that nobody shares a fix. */
const HUNTERS = [
  { callsign: 'KI7XYZ', at: { latitude: 48.7519, longitude: -122.4787 }, bearing: 45 },
  { callsign: 'W7ABC', at: { latitude: 48.7902, longitude: -122.5101 }, bearing: 135 },
  { callsign: 'N7FOX', at: { latitude: 48.7201, longitude: -122.4402 }, bearing: 225 },
  { callsign: 'KD7QRP', at: { latitude: 48.7655, longitude: -122.3998 }, bearing: 315 },
];

async function device(browser: Browser, code: string, h: (typeof HUNTERS)[number]) {
  const context = await browser.newContext();
  await grantPosition(context, h.at);
  const page = await context.newPage();
  await joinAs(page, code, h.callsign);
  return { context, page };
}

test('four devices, four locations, one hunt, no report missing — SC-003', async ({ browser }) => {
  const code = await createHunt('Four-device test');

  // Sequential joins: four cold starts at once is a load test, not this test.
  const devices = [];
  for (const h of HUNTERS) devices.push(await device(browser, code, h));

  // Each hunter takes one bearing from where they stand.
  for (const [i, d] of devices.entries()) await reportBearing(d.page, HUNTERS[i]!.bearing);

  // The whole claim: every device ends up holding all four, with nobody touching anything.
  for (const [i, d] of devices.entries()) {
    await expect
      .poll(
        async () => (await renderedFeatures(d.page)).filter((f) => f.kind === 'bearing').length,
        {
          timeout: 15_000,
        },
      )
      .toBe(4);

    const labels = (await renderedFeatures(d.page))
      .filter((f) => f.kind === 'bearing')
      .map((f) => f.label)
      .sort();
    expect(labels, `device ${i + 1} (${HUNTERS[i]!.callsign}) should see all four`).toEqual(
      HUNTERS.map((h) => h.callsign).sort(),
    );
  }

  for (const d of devices) await d.context.close();
});
