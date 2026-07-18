/**
 * SC-011: **0 relayed reports attributed to the operator who typed them.**
 *
 * A voice hop is where error enters. If net control relays KI7XYZ's bearing and the map says it
 * came from net control, the picture has quietly fabricated a report from someone who never made
 * one — and put it at the wrong place, from the wrong position.
 *
 * The flow (feedback round 2): relay is a per-device mode enabled in settings; arming a target
 * (callsign + where they were, validated before "Report for them" enables) drops a pin at their
 * position and the NEXT report files as theirs, then the target disarms. The half-filled middle
 * state that used to threaten SC-011 is now unrepresentable — a target is either armed with
 * complete details or does not exist.
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

/** Flips this device into relay mode through the real settings pane. */
async function enableRelayMode(page: Page): Promise<void> {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('relay-mode-toggle').click();
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
  await page.getByTestId('begin-relay').waitFor();
}

/** Arms a relay target: who, where they were, and (optionally) how stale the call is. */
async function armRelay(
  page: Page,
  observer: string,
  at = OBSERVER_AT,
  minutesAgo?: number,
): Promise<void> {
  await page.getByTestId('begin-relay').click();
  await page.getByTestId('relay-callsign').fill(observer);
  await page.getByTestId('relay-lat').fill(String(at.lat));
  await page.getByTestId('relay-lon').fill(String(at.lon));
  if (minutesAgo !== undefined) {
    await page.getByTestId('relay-minutes-ago').fill(String(minutesAgo));
  }
  await page.getByTestId('relay-ready').click();
  await page.getByTestId('relay-armed').waitFor();
}

/** Net control types in the bearing they just heard on the radio. */
async function relayBearing(page: Page, observer: string, at = OBSERVER_AT): Promise<void> {
  await armRelay(page, observer, at);
  await page.getByTestId('report-bearing').click();
  await page.getByTestId('heading-input').fill('270');
  await page.getByTestId('confidence-0').click();
  await page.getByTestId('range-1').click();
  await page.getByTestId('send-bearing').click();
}

async function netControlSession(page: Page, context: Parameters<typeof grantPosition>[0]) {
  await grantPosition(context, NET_CONTROL_AT);
  const code = await createHunt();
  await joinAs(page, code, 'W7NET');
  return code;
}

test('relay does not exist until this device opts in — and the sheets carry none of it', async ({
  page,
  context,
}) => {
  await netControlSession(page, context);

  // Off by default: no relay affordance in the status bar, none in any report sheet.
  await expect(page.getByTestId('begin-relay')).toHaveCount(0);
  for (const kind of ['bearing', 'omni', 'null', 'fix'] as const) {
    await page.getByTestId(`report-${kind}`).click();
    await expect(page.getByTestId('sheet').locator('[data-testid^="relay"]')).toHaveCount(0);
    await page.getByTestId('close-sheet').click();
    await expect(page.getByTestId('sheet')).toHaveCount(0);
  }

  // The settings pane turns it on, per device...
  await enableRelayMode(page);
  await expect(page.getByTestId('begin-relay')).toBeVisible();

  // ...and it survives a reload: the switch is the device's, not the session's.
  await page.reload();
  await page.getByTestId('report-bar').waitFor();
  await expect(page.getByTestId('begin-relay')).toBeVisible();

  // Off again removes the affordance entirely.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('relay-mode-toggle').click();
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('begin-relay')).toHaveCount(0);
});

test('an incomplete arming cannot arm — FR-008, Constitution I, SC-011', async ({
  page,
  context,
}) => {
  // `Number('')` is 0, not NaN, so a blank coordinate once put an observer at Null Island. Now
  // the gate is at arming: "Report for them" stays dead until every claim is complete and sane,
  // so there is no half-armed state for a report to file under.
  await netControlSession(page, context);
  await enableRelayMode(page);

  await page.getByTestId('begin-relay').click();
  const ready = page.getByTestId('relay-ready');

  await page.getByTestId('relay-callsign').fill('KI7XYZ');
  await expect(ready).toBeDisabled(); // position still blank

  // 480° of latitude is not a place. A number input accepts it; the Earth does not.
  await page.getByTestId('relay-lat').fill('480');
  await page.getByTestId('relay-lon').fill(String(OBSERVER_AT.lon));
  await expect(ready).toBeDisabled();

  await page.getByTestId('relay-lat').fill(String(OBSERVER_AT.lat));
  await expect(ready).toBeEnabled();

  // Abandon instead: nothing armed, and the next report is honestly the operator's own.
  await page.getByTestId('close-relay-sheet').click();
  await expect(page.getByTestId('relay-armed')).toHaveCount(0);

  await page.getByTestId('report-null').click();
  await page.getByTestId('send-null').click();
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(1);
  expect((await renderedFeatures(page))[0]!.relayed).toBe(false);
  expect((await renderedFeatures(page))[0]!.label).toBe('W7NET');
});

test('arming drops a pin at the observer’s spot; filing lifts it and disarms', async ({
  page,
  context,
}) => {
  await netControlSession(page, context);
  await enableRelayMode(page);

  await armRelay(page, 'KI7XYZ');
  await expect(page.getByTestId('relay-pin')).toBeVisible();
  await expect(page.getByTestId('relay-armed')).toContainText('KI7XYZ');

  await page.getByTestId('report-null').click();
  await page.getByTestId('send-null').click();

  // One report per arming: pin lifted, chip gone, affordance back.
  await expect(page.getByTestId('relay-pin')).toHaveCount(0);
  await expect(page.getByTestId('relay-armed')).toHaveCount(0);
  await expect(page.getByTestId('begin-relay')).toBeVisible();
});

test('cancelling an armed relay files nothing and disarms', async ({ page, context }) => {
  await netControlSession(page, context);
  await enableRelayMode(page);

  await armRelay(page, 'KI7XYZ');
  await page.getByTestId('cancel-relay').click();
  await expect(page.getByTestId('relay-armed')).toHaveCount(0);
  await expect(page.getByTestId('relay-pin')).toHaveCount(0);
  expect(await localReports(page)).toHaveLength(0);
});

test('net control can relay a signal report, not only a bearing — FR-007a/b', async ({
  page,
  context,
}) => {
  // The hunter most likely to be calling their report in over voice is the one with a handheld
  // and a rubber duck — exactly the person Principle II exists for.
  await netControlSession(page, context);
  await enableRelayMode(page);

  await armRelay(page, 'KI7XYZ');
  await page.getByTestId('report-omni').click();
  await page.getByTestId('strength-1').click();

  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);
  const [feature] = await renderedFeatures(page);
  expect(feature!.kind).toBe('omni');
  expect(feature!.label).toBe('KI7XYZ');
  expect(feature!.relayed).toBe(true);
  expect(feature!.entered_by).toBe('W7NET');
});

test('net control can relay a heard-nothing report — FR-007a/b', async ({ page, context }) => {
  await netControlSession(page, context);
  await enableRelayMode(page);

  await armRelay(page, 'KI7XYZ');
  await page.getByTestId('report-null').click();
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
  await netControlSession(page, context);
  await enableRelayMode(page);

  const before = Date.now();
  // The operator heard this called five minutes ago. Recording "now" would file every relayed
  // report late by however long the voice traffic took.
  await armRelay(page, 'KI7XYZ', OBSERVER_AT, 5);
  await page.getByTestId('report-null').click();
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
  await netControlSession(page, context);
  await enableRelayMode(page);

  await relayBearing(page, 'KI7XYZ');
  await expect.poll(async () => (await renderedFeatures(page)).length, { timeout: 5_000 }).toBe(1);

  const [feature] = await renderedFeatures(page);
  // The whole of SC-011: zero reports wearing the wrong name.
  expect(feature!.label).toBe('KI7XYZ');
  expect(feature!.label).not.toContain('W7NET');
  expect(feature!.relayed).toBe(true);
});

test('the relay marking is visible, and names the entering operator', async ({ page, context }) => {
  await netControlSession(page, context);
  await enableRelayMode(page);

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
  await netControlSession(page, context);
  await enableRelayMode(page);

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
  await netControlSession(page, context);
  await enableRelayMode(page);

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
  await netControlSession(page, context);
  await enableRelayMode(page);

  // Relay mode on, but nothing armed: an ordinary report from the operator's own position.
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
  const code = await netControlSession(page, context);
  await enableRelayMode(page);

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
