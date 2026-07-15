/**
 * Local participant identity.
 *
 * There is no join endpoint, and that is a decision rather than an omission. Joining means: open
 * the link, pick a callsign, start reporting. The device mints its own `participant_id` and keeps
 * it; the server is never told and holds no roster.
 *
 * **Everything here must work with the network already gone** — a participant who loaded the link
 * and then lost coverage can still pick a callsign and report.
 */
import type { FoxmapperDb } from './store.js';
import { getMeta, setMeta } from './store.js';

const PARTICIPANT_ID_KEY = 'participant_id';
const CALLSIGN_KEY = 'callsign';
/** FR-004c: reopen the last hunt on return. One string, no hunt list, no switcher. */
const LAST_HUNT_KEY = 'foxmapper:last_hunt';

export interface Identity {
  participant_id: string;
  callsign: string;
}

/**
 * The device's own id, minted on first use and kept forever.
 *
 * `crypto.randomUUID()` is CSPRNG-backed and needs no coordination, which is what lets a device
 * author reports offline that will never collide with anyone else's.
 */
export async function participantId(db: FoxmapperDb): Promise<string> {
  const existing = await getMeta<string>(db, PARTICIPANT_ID_KEY);
  if (existing) return existing;
  const minted = crypto.randomUUID();
  await setMeta(db, PARTICIPANT_ID_KEY, minted);
  return minted;
}

export async function getCallsign(db: FoxmapperDb): Promise<string | undefined> {
  return getMeta<string>(db, CALLSIGN_KEY);
}

export async function setCallsign(db: FoxmapperDb, callsign: string): Promise<void> {
  await setMeta(db, CALLSIGN_KEY, callsign.trim().toUpperCase());
}

/** Joining, in full. No account, no round-trip, no server involvement. */
export async function join(db: FoxmapperDb, callsign: string): Promise<Identity> {
  await setCallsign(db, callsign);
  return {
    participant_id: await participantId(db),
    callsign: callsign.trim().toUpperCase(),
  };
}

export async function currentIdentity(db: FoxmapperDb): Promise<Identity | undefined> {
  const callsign = await getCallsign(db);
  if (!callsign) return undefined;
  return { participant_id: await participantId(db), callsign };
}

/**
 * The last hunt, in localStorage rather than IndexedDB: it is read before the database opens, on
 * the path that decides which screen to show.
 */
export function rememberHunt(huntCode: string): void {
  try {
    localStorage.setItem(LAST_HUNT_KEY, huntCode);
  } catch {
    // Private mode, or storage denied. Forgetting the last hunt costs one paste of a link; it is
    // not worth failing a join over.
  }
}

export function lastHunt(): string | undefined {
  try {
    return localStorage.getItem(LAST_HUNT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function forgetHunt(): void {
  try {
    localStorage.removeItem(LAST_HUNT_KEY);
  } catch {
    // See above.
  }
}
