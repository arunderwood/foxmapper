/**
 * Clock offset: how wrong this device's clock is known to be.
 *
 * `clock_offset_ms` is for display honesty, not arithmetic. Without it, only the reporter would
 * know their timestamps were wrong while every other hunter read them as exact — the map would be
 * lying to precisely the people who cannot tell.
 */
import type { FoxmapperDb } from './store.js';
import { getMeta, setMeta } from './store.js';

const OFFSET_KEY = 'clock_offset_ms';

/** Above this, the reporter is warned. Never silently corrected — that would mutate a fact. */
export const SKEW_WARNING_MS = 2 * 60 * 1_000;

/**
 * Device clock minus true time; positive means the device is running fast.
 *
 * **`null` means never measured — it is not zero.** Zero means "checked, and correct". An
 * implementation that coalesces null to zero is asserting a clock is good when nothing knows that,
 * which is precisely the confident-looking wrongness this format exists to prevent.
 */
export type ClockOffset = number | null;

/**
 * Measures the offset against the server's `Date` header and retains it for offline use.
 *
 * Half the round-trip is subtracted, which is the standard estimate and is wrong by the link's
 * asymmetry. That does not matter here: the threshold this feeds is two minutes, and no cellular
 * round-trip is off by anything close.
 */
export async function measureOffset(db: FoxmapperDb, apiOrigin: string): Promise<ClockOffset> {
  try {
    const before = Date.now();
    const response = await fetch(`${apiOrigin}/health`, { cache: 'no-store' });
    const after = Date.now();

    const serverDate = response.headers.get('date');
    if (!serverDate) return getOffset(db);

    const serverMs = Date.parse(serverDate);
    if (Number.isNaN(serverMs)) return getOffset(db);

    // The Date header has one-second resolution, so this is accurate to about a second — three
    // orders of magnitude better than the threshold it serves.
    const midpoint = before + (after - before) / 2;
    const offset = Math.round(midpoint - serverMs);
    await setMeta(db, OFFSET_KEY, offset);
    return offset;
  } catch {
    // Offline. Keep whatever we last knew: a device that measured its clock in the car park
    // should still caveat its reports on the hilltop.
    return getOffset(db);
  }
}

/** The retained offset, or `null` if this device has never reached the server. */
export async function getOffset(db: FoxmapperDb): Promise<ClockOffset> {
  const stored = await getMeta<number>(db, OFFSET_KEY);
  return stored ?? null;
}

export function isSkewed(offset: ClockOffset): boolean {
  return offset !== null && Math.abs(offset) > SKEW_WARNING_MS;
}

/**
 * A corrected time **for display only**.
 *
 * Never subtract this from `observed_at` in the log. The report says what the reporter's device
 * said, forever — rewriting it would make the log a record of what we think happened rather than
 * what was reported.
 */
export function displayTime(observedAt: number, offset: ClockOffset): number {
  return offset === null ? observedAt : observedAt - offset;
}
