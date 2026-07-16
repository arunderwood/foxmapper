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
import { createHunt, grantPosition, joinAs, localReports, renderedFeatures, RELAY } from './helpers.js';

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

test('a relayed report carries the observers position, not net controls', async ({ page, context }) => {
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
    const all: { kind: string; observer: Record<string, unknown> }[] = await new Promise((resolve) => {
      const rq = db.transaction('reports', 'readonly').objectStore('reports').getAll();
      rq.onsuccess = () => resolve(rq.result);
    });
    return all.find((r) => r.kind === 'bearing')?.observer;
  });

  expect(observer).toEqual({ callsign: 'VE3QRP' });
  expect(observer).not.toHaveProperty('participant_id');
});

test('net control reporting their own observation is not marked relayed', async ({ page, context }) => {
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
