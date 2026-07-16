/**
 * The basemap's licence obligation, checked in pixels rather than in the DOM.
 *
 * MapLibre's own stylesheet was never imported, so for a long time the attribution control was
 * `position: static` and the rule written to lift it clear of the report bar did nothing at all.
 * Every existing test passed: they read the map's GeoJSON sources, and the sources were right.
 *
 * "Present in the DOM" is not the obligation. Being readable is.
 */
import { expect, test } from '@playwright/test';
import { createHunt, grantPosition, joinAs, reportHeardNothing } from './helpers.js';

const AT = { latitude: 48.7519, longitude: -122.4787 };

test('the attribution is shown, and nothing is painted over it', async ({ page, context }) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  const attrib = page.locator('.maplibregl-ctrl-attrib');
  await expect(attrib).toContainText('OpenFreeMap');
  await expect(attrib).toContainText('OpenStreetMap');

  // The report bar sits at the bottom of the map and would happily cover it.
  const readable = await page.evaluate(() => {
    const ctrl = document.querySelector('.maplibregl-ctrl-attrib');
    if (!ctrl) return false;
    const r = ctrl.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) return false;
    // Whatever is painted at the control's own position must be the control.
    const at = document.elementFromPoint(r.left + r.width - 20, r.top + r.height / 2);
    return ctrl.contains(at);
  });
  expect(readable).toBe(true);
});

test('a callsign is drawn even with the glyph host unreachable — FR-002b', async ({
  page,
  context,
  browserName,
}) => {
  // FR-002b forbids telling stations apart by colour alone, and labels are drawn from glyphs the
  // tile host serves — so the obvious reading is that offline every report is colour-only. **It is
  // not.** MapLibre shapes the codepoints locally when a glyph range fails, so the callsign
  // survives with the host gone. This pins that, because the whole of FR-002b rests on it and it
  // is a behaviour of a dependency rather than of our code.
  test.skip(
    browserName !== 'chromium',
    'WebKit + Playwright cross-origin route interception stops the app loading; the same fallback is visible there from the glyph 404s the host produces anyway',
  );

  await context.route(/openfreemap\.org\/fonts/, (route) => route.abort());
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');
  await reportHeardNothing(page);

  // A symbol feature only comes back from queryRenderedFeatures once its text has been shaped and
  // placed. Empty here would mean the label never made it to the screen.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const map = (window as unknown as { __map?: maplibregl.Map }).__map;
          return (map?.queryRenderedFeatures({ layers: ['marker-label'] }) ?? []).map(
            (f) => f.properties?.['map_label'],
          );
        }),
      { timeout: 10_000 },
    )
    .toEqual(['KI7XYZ']);
});

test('MapLibre’s stylesheet is loaded, so its own furniture is positioned', async ({
  page,
  context,
}) => {
  await grantPosition(context, AT);
  const code = await createHunt();
  await joinAs(page, code, 'KI7XYZ');

  // The canary for the whole class: without the stylesheet these are `static`, and popups flow out
  // of the bottom of the map instead of anchoring to the report they describe.
  const positioned = await page.evaluate(() => {
    const ctrl = document.querySelector('.maplibregl-ctrl-attrib');
    return ctrl ? getComputedStyle(ctrl.parentElement!).position : 'missing';
  });
  expect(positioned).toBe('absolute');
});
