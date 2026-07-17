/**
 * SC-011: **0 relayed reports attributed to the operator who typed them.**
 *
 * A voice hop is where error enters. If net control relays KI7XYZ's bearing and the map says it
 * came from net control, the picture has quietly fabricated a report from someone who never made
 * one — and put it at the wrong place, from the wrong position.
 *
 * These drive the real interface. An earlier version reached into the modules directly and would
 * have passed while net control had no way to relay anything at all.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createHunt,
  grantPosition,
  joinAs,
  localReports,
  renderedFeatures,
  RELAY,
} from './helpers.js';

const NET_CONTROL_AT = { latitude: 48.7519, longitude: -122.4787 };
const OBSERVER_AT = { lat: 48.9, lon: -122.6 };

/** Net control types in what they just heard on the radio. */
async function relayBearing(page: Page, observer: string, at = OBSERVER_AT): Promise<void> {
  await page.getByTestId('report-bearing').click();
  await page.getByTestId('heading-input').fill('270');
  await page.getByTestId('confidence-0').click();
  await page.getByTestId('range-1').click();

  await page.getByTestId('relay-toggle').click();
  await page.getByTestId('relay-callsign').fill(observer);
  await page.getByTestId('relay-lat').fill(String(at.lat));
  await page.getByTestId('relay-lon').fill(String(at.lon));

  await page.getByTestId('send-bearing').click();
}

test('every sheet opens with the relay fields collapsed — FR-005d', async ({ page, context }) => {
  // The fields have always carried `hidden`, but `.stack { display: flex }` outranked the
  // browser's `[hidden] { display: none }`, so all four sheets opened with four relay fields
  // spread under them — a report about someone else demanding answers from a hunter reporting
  // their own. Every other test in this file clicks the toggle first, so none of them ever
  // looked at the collapsed state, and the toggle went untested in the direction that matters.
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  for (const kind of ['bearing', 'omni', 'null', 'fix'] as const) {
    await page.getByTestId(`report-${kind}`).click();

    await expect(page.getByTestId('relay-fields')).toBeHidden();
    await expect(page.getByTestId('relay-callsign')).toBeHidden();
    await expect(page.getByTestId('relay-toggle')).toHaveAttribute('aria-pressed', 'false');

    // And the toggle still reveals them — collapsed by default is not the same as unreachable.
    await page.getByTestId('relay-toggle').click();
    await expect(page.getByTestId('relay-fields')).toBeVisible();
    await expect(page.getByTestId('relay-callsign')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('sheet')).toHaveCount(0);
  }
});

test('a half-filled relay files nothing at all — FR-008, Constitution I', async ({
  page,
  context,
}) => {
  // `Number('')` is 0, not NaN, so a blank coordinate used to pass the guard and put the observer
  // at lat 0, lon 0 — Null Island — marked "set by hand", under their own callsign. The observer
  // cannot correct it: they are not in the app.
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await page.getByTestId('report-null').click();
  await page.getByTestId('relay-toggle').click();
  await page.getByTestId('relay-callsign').fill('KI7XYZ');
  // Position left blank — the operator got interrupted by the next call.
  await page.getByTestId('send-null').click();

  await expect(page.getByTestId('sheet-problem')).toContainText('their latitude');
  await expect(page.getByTestId('sheet-problem')).toContainText('their longitude');
  expect(await localReports(page)).toHaveLength(0);
});

test('a half-filled relay is never filed as net control’s own — SC-011, FR-007b', async ({
  page,
  context,
}) => {
  // The failure that mattered more: with any field blank the report used to fall back to the
  // entering operator's own context — filed as *their* observation, from *their* position, with
  // the relay toggle visibly on. SC-011 puts the acceptable number of those at zero.
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await page.getByTestId('report-omni').click();
  await page.getByTestId('relay-toggle').click();
  // Callsign left blank; the position is filled in.
  await page.getByTestId('relay-lat').fill(String(OBSERVER_AT.lat));
  await page.getByTestId('relay-lon').fill(String(OBSERVER_AT.lon));
  await page.getByTestId('strength-1').click();

  await expect(page.getByTestId('sheet-problem')).toContainText('their callsign');
  // Nothing was filed — and in particular nothing wearing W7NET's name.
  expect(await localReports(page)).toHaveLength(0);
  expect(await renderedFeatures(page)).toHaveLength(0);
});

test('a coordinate that is not a coordinate is refused — FR-008', async ({ page, context }) => {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await page.getByTestId('report-null').click();
  await page.getByTestId('relay-toggle').click();
  await page.getByTestId('relay-callsign').fill('KI7XYZ');
  // 480° of latitude is not a place. A number input accepts it; the Earth does not.
  await page.getByTestId('relay-lat').fill('480');
  await page.getByTestId('relay-lon').fill(String(OBSERVER_AT.lon));
  await page.getByTestId('send-null').click();

  await expect(page.getByTestId('sheet-problem')).toContainText('their latitude');
  expect(await localReports(page)).toHaveLength(0);
});

test('net control can relay a signal report, not only a bearing — FR-007a/b', async ({
  page,
  context,
}) => {
  // The hunter most likely to be calling their report in over voice is the one with a handheld and
  // a rubber duck — exactly the person Principle II exists for. The relay path lived on the bearing
  // sheet alone, so their contribution was the one kind net control could not enter.
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await page.getByTestId('report-omni').click();
  await page.getByTestId('relay-toggle').click();
  await page.getByTestId('relay-callsign').fill('KI7XYZ');
  await page.getByTestId('relay-lat').fill(String(OBSERVER_AT.lat));
  await page.getByTestId('relay-lon').fill(String(OBSERVER_AT.lon));
  await page.getByTestId('strength-1').click();

  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);
  const [feature] = await renderedFeatures(page);
  expect(feature!.kind).toBe('omni');
  expect(feature!.label).toBe('KI7XYZ');
  expect(feature!.relayed).toBe(true);
  expect(feature!.entered_by).toBe('W7NET');
});

test('net control can relay a heard-nothing report — FR-007a/b', async ({ page, context }) => {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await page.getByTestId('report-null').click();
  await page.getByTestId('relay-toggle').click();
  await page.getByTestId('relay-callsign').fill('KI7XYZ');
  await page.getByTestId('relay-lat').fill(String(OBSERVER_AT.lat));
  await page.getByTestId('relay-lon').fill(String(OBSERVER_AT.lon));
  await page.getByTestId('send-null').click();

  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);
  const [feature] = await renderedFeatures(page);
  expect(feature!.kind).toBe('null');
  expect(feature!.label).toBe('KI7XYZ');
  expect(feature!.relayed).toBe(true);
});

test('a relayed report records when the observation was taken, not when it was typed — FR-007', async ({
  page,
  context,
}) => {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  const before = Date.now();
  await page.getByTestId('report-null').click();
  await page.getByTestId('relay-toggle').click();
  await page.getByTestId('relay-callsign').fill('KI7XYZ');
  await page.getByTestId('relay-lat').fill(String(OBSERVER_AT.lat));
  await page.getByTestId('relay-lon').fill(String(OBSERVER_AT.lon));
  // The operator heard this called five minutes ago. Recording "now" would file every relayed
  // report late by however long the voice traffic took.
  await page.getByTestId('relay-minutes-ago').fill('5');
  await page.getByTestId('send-null').click();

  await expect.poll(async () => (await localReports(page)).length, { timeout: 5_000 }).toBe(1);
  const observedAt = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('foxmapper');
      request.onsuccess = () => resolve(request.result);
    });
    const all: { observed_at: number }[] = await new Promise((resolve) => {
      const request = db.transaction('reports', 'readonly').objectStore('reports').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    return all[0]!.observed_at;
  });

  // Five minutes back, give or take the test's own runtime.
  expect(observedAt).toBeLessThan(before - 4 * 60_000);
  expect(observedAt).toBeGreaterThan(before - 6 * 60_000);
});

test('a relayed report is attributed to the observer, never the operator — SC-011', async ({
  page,
  context,
}) => {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await relayBearing(page, 'KI7XYZ');
  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);

  const [feature] = await renderedFeatures(page);
  // The whole of SC-011: zero reports wearing the wrong name.
  expect(feature!.label).toBe('KI7XYZ');
  expect(feature!.label).not.toContain('W7NET');
  expect(feature!.relayed).toBe(true);
});

test('the relay marking is visible, and names the entering operator', async ({ page, context }) => {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await relayBearing(page, 'KI7XYZ');
  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);

  // FR-012b: marked as having crossed a voice hop, in the primary view.
  const [feature] = await renderedFeatures(page);
  expect(feature!.entered_by).toBe('W7NET');
  expect(feature!.relayed).toBe(true);
  // The observer's position was set by hand, and the map says so (FR-008).
  expect(feature!.placed).toBe(true);
});

test('a relayed report carries the observers position, not net controls', async ({
  page,
  context,
}) => {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await relayBearing(page, 'KI7XYZ');
  await expect.poll(async () => (await localReports(page)).length, { timeout: 5_000 }).toBe(1);

  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('foxmapper');
      request.onsuccess = () => resolve(request.result);
    });
    const all: {
      kind: string;
      position: { lat: number };
      position_source: string;
      position_accuracy_m?: number;
    }[] = await new Promise((resolve) => {
      const rq = db.transaction('reports', 'readonly').objectStore('reports').getAll();
      rq.onsuccess = () => resolve(rq.result);
    });
    return all.find((r) => r.kind === 'bearing');
  });

  expect(stored?.position.lat).toBeCloseTo(48.9);
  // Not `measured`: the observer's device never took this fix, and claiming otherwise would
  // assert a GPS reading that does not exist.
  expect(stored?.position_source).toBe('placed');
  // Net control's GPS accuracy is not the observer's.
  expect(stored?.position_accuracy_m).toBeUndefined();
});

test('the observer need not be a participant', async ({ page, context }) => {
  // A voice-only operator with a radio and no phone appears on the map having never joined.
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await relayBearing(page, 'VE3QRP');
  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);

  const observer = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('foxmapper');
      request.onsuccess = () => resolve(request.result);
    });
    const all: { kind: string; observer: Record<string, unknown> }[] = await new Promise(
      (resolve) => {
        const rq = db.transaction('reports', 'readonly').objectStore('reports').getAll();
        rq.onsuccess = () => resolve(rq.result);
      },
    );
    return all.find((r) => r.kind === 'bearing')?.observer;
  });

  expect(observer).toEqual({ callsign: 'VE3QRP' });
  expect(observer).not.toHaveProperty('participant_id');
});

test('net control reporting their own observation is not marked relayed', async ({
  page,
  context,
}) => {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  // No relay toggle: an ordinary report from the operator's own position.
  await page.getByTestId('report-bearing').click();
  await page.getByTestId('heading-input').fill('90');
  await page.getByTestId('confidence-1').click();
  await page.getByTestId('range-1').click();
  await page.getByTestId('send-bearing').click();

  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);
  const [feature] = await renderedFeatures(page);
  expect(feature!.relayed).toBe(false);
  expect(feature!.label).toBe('W7NET');
});

test('two operators relaying one voice call produce two reports', async ({ page, context }) => {
  // Not deduplicated: the system cannot know they describe one observation, and collapsing them
  // would destroy a real report.
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');

  await relayBearing(page, 'KI7XYZ');
  await relayBearing(page, 'KI7XYZ');

  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(2);

  await expect
    .poll(
      async () => {
        const response = await fetch(`${RELAY}/api/hunts/${code}/ids`);
        const { ids } = (await response.json()) as { ids: string[] };
        return ids.length;
      },
      { timeout: 10_000 },
    )
    .toBe(2);
});
