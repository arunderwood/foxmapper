/** Shared by the estimate e2e specs: seeding hunts, and reading what the map draws. */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { EstimateReport, EstimateResult } from '../../src/estimate/types.js';
import type { ObservationReport } from '../../src/log/types.js';
import { bearingAt, Ids, mulberry32, type LatLon } from '../reference/simulate.js';
import { createHunt, grantPosition, joinAs, RELAY } from './helpers.js';

export const HOME: LatLon = { lat: 48.7519, lon: -122.4787 };

/** A full log record around the kernel fields, as a participant's device would have filed it. */
export function toReport(r: EstimateReport, code: string): ObservationReport {
  const callsign = 'W7SIM';
  const base = {
    v: 1 as const,
    id: r.id,
    hunt_code: code,
    observer: { callsign },
    position: r.position,
    position_source: 'measured' as const,
    observed_at: 1_790_000_000_000,
    clock_offset_ms: 0,
    entered_by: { participant_id: '0b9d7c1e-5a1f-4c3b-9d2e-7f6a5b4c3d2e', callsign },
  };
  switch (r.kind) {
    case 'bearing':
      return {
        ...base,
        kind: 'bearing',
        payload: {
          heading_true: r.heading_true,
          heading_magnetic: r.heading_true,
          declination: 0,
          wmm_epoch: 'WMM2025',
          confidence_q: r.confidence_q as 3 | 4 | 5,
          max_range_r: r.max_range_r as 1 | 3 | 5,
        },
      };
    case 'omni':
      return { ...base, kind: 'omni', payload: { strength_s: r.strength_s as 2 | 5 | 8 } };
    case 'null':
      return { ...base, kind: 'null', payload: {} };
    case 'fix':
      return { ...base, kind: 'fix', payload: {} };
  }
}

/**
 * Fresh ids for every run, in the same order: the relay keeps ids unique, and the estimate reads
 * only their order.
 */
export function retag(reports: EstimateReport[]): EstimateReport[] {
  const tag = crypto.randomUUID().slice(0, 8);
  return reports.map((r) => ({ ...r, id: r.id.replace(/^[0-9a-f]{8}/, tag) }));
}

export async function post(code: string, reports: EstimateReport[]): Promise<void> {
  const body = JSON.stringify(reports.map((r) => toReport(r, code)));
  const response = await untilAdmitted(() =>
    fetch(`${RELAY}/api/hunts/${code}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
  expect(response.status).toBe(202);
}

/**
 * Retries while the relay answers 429. Every test in the run shares one rate-limit bucket, so a
 * refusal means "later", exactly as the app itself treats it.
 */
export async function untilAdmitted(send: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await send();
    if (response.status !== 429 || attempt === 20) return response;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * Writes reports straight into this device's log, as if it had received them. `replace` empties the
 * log first; `estimate` sets the device's switch.
 */
export async function seedLog(
  page: Page,
  records: ObservationReport[],
  options: { replace?: boolean; estimate?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    async ({ records, replace, estimate }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('foxmapper');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['reports', 'meta'], 'readwrite');
        const store = tx.objectStore('reports');
        if (replace) store.clear();
        for (const record of records) store.put(record);
        if (estimate !== null) tx.objectStore('meta').put(estimate, 'estimate_enabled');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { records, replace: options.replace ?? false, estimate: options.estimate ?? null },
  );
}

/**
 * A hunt the relay never hears of, holding these reports: the relay is cut off before the page
 * loads, so the device works from its own log alone — the offline case the estimate is built for.
 * It also spends none of the relay's rate limit, which every other test in the run shares.
 */
export async function localHunt(
  page: Page,
  context: BrowserContext,
  callsign: string,
  reports: EstimateReport[] = [],
  at: LatLon = HOME,
): Promise<string> {
  await context.route('**/api/**', (route) => route.abort());
  await grantPosition(context, { latitude: at.lat, longitude: at.lon });
  const code = `local-${crypto.randomUUID().slice(0, 8)}`;
  await joinAs(page, code, callsign);
  if (reports.length > 0) {
    await seedLog(
      page,
      reports.map((r) => toReport(r, code)),
    );
    await page.reload();
    await page.getByTestId('report-bar').waitFor();
  }
  return code;
}

/** A hunt already holding these reports. */
export async function huntWith(reports: EstimateReport[]): Promise<string> {
  const code = await createHunt('Estimate test');
  if (reports.length > 0) await post(code, reports);
  return code;
}

/** Bearings that cross at `fox`, from the given directions, without error. */
export function crossing(fox: LatLon, from: number[], seed = 1): EstimateReport[] {
  const rng = mulberry32(seed);
  const ids = new Ids(seed);
  return retag(from.map((f) => bearingAt(rng, ids, fox, { from: f, km: 3, q: 4, errorDeg: 0 })));
}

export async function setEstimate(page: Page, on: boolean): Promise<void> {
  await page.getByTestId('open-settings').click();
  const toggle = page.getByTestId('estimate-toggle');
  if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(on));
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
}

export async function regionCount(page: Page): Promise<number> {
  return Number(await page.getByTestId('status-bar').getAttribute('data-estimate-region-count'));
}

export async function warningKinds(page: Page): Promise<string[]> {
  return page
    .getByTestId('estimate-warning')
    .evaluateAll((chips) => chips.map((c) => (c as HTMLElement).dataset['kind'] ?? ''));
}

/** The regions the map is drawing, as the bytes the worker produced. */
export async function drawnRegions(page: Page): Promise<string> {
  return page.evaluate(() => {
    const map = (window as unknown as { __map?: MapLibreMap }).__map;
    const source = map?.getSource('estimate') as GeoJSONSource | undefined;
    const data = (source?.serialize() as { data?: GeoJSON.FeatureCollection } | undefined)?.data;
    return JSON.stringify(
      (data?.features ?? []).map((f) => [f.geometry, f.properties?.['probability']]),
    );
  });
}

export function expectedRegions(result: EstimateResult): string {
  return JSON.stringify(result.regions.map((r) => [r.geometry, r.probability]));
}

export function expectedChips(result: EstimateResult): string[] {
  return result.status === 'none' ? ['none'] : result.warnings;
}

export async function device(
  browser: Browser,
  code: string,
  callsign: string,
  at: LatLon = HOME,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await grantPosition(context, { latitude: at.lat, longitude: at.lon });
  const page = await context.newPage();
  await joinAs(page, code, callsign);
  return { context, page };
}
