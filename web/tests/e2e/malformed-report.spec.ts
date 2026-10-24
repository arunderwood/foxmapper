/**
 * A body the relay accepts but no reader can draw must not take the map down with it.
 *
 * The relay checks only that a report's `id` is a UUID, so anyone with the hunt code can post one
 * with no `observer`. Every participant then holds it — in memory, in IndexedDB, and again from the
 * stream after a reload — and the fold runs on every report, position tick and reconnect.
 */
import { test, expect } from '@playwright/test';
import {
  RELAY,
  createHunt,
  grantPosition,
  joinAs,
  localReports,
  renderedFeatures,
  reportHeardNothing,
} from './helpers.js';
import { untilAdmitted } from './estimate-helpers.js';

test('a report with no observer is skipped, and the map keeps working', async ({
  page,
  context,
}) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  const code = await createHunt('malformed report');
  await grantPosition(context);
  await joinAs(page, code, 'KI7VIC');
  await reportHeardNothing(page);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(1);

  const poisonId = crypto.randomUUID();
  const response = await untilAdmitted(() =>
    fetch(`${RELAY}/api/hunts/${code}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        id: poisonId,
        hunt_code: code,
        kind: 'omni',
        payload: { strength_s: 5 },
        position: { lat: 48.7, lon: -122.4 },
        position_source: 'placed',
        observed_at: Date.now(),
        clock_offset_ms: 0,
        entered_by: { participant_id: crypto.randomUUID(), callsign: 'GHOST' },
      }),
    }),
  );
  expect(response.status).toBe(202);

  // Held, not drawn: the device stores it like any other member of the log.
  await expect.poll(async () => (await localReports(page)).map((r) => r.id)).toContain(poisonId);

  // The fold runs again on the next report; a reader that dereferenced the body would throw here.
  await reportHeardNothing(page);
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(2);
  await expect(page.getByTestId('sync-state')).toHaveAttribute('data-state', /live|synced/);

  // A reload re-reads IndexedDB and replays the stream; the poison comes back both ways.
  await page.reload();
  await page.getByTestId('report-bar').waitFor();
  await expect.poll(async () => (await renderedFeatures(page)).length).toBe(2);

  expect(errors.map((e) => e.message)).toEqual([]);
});
