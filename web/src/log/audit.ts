/**
 * The divergence audit.
 *
 * The cursor protocol has exactly one silent-loss failure mode. The constitution says no report
 * may be lost; the honest response is to **detect divergence rather than assume correctness**.
 * Compare a digest for free; do the expensive diff only when it says something is wrong.
 *
 * This audit is our own construction, not a standard protocol.
 */
import { sha256Utf8, toHex } from './sha256.js';
import { outboxDepth, type FoxmapperDb } from './store.js';

export interface AuditResult {
  /** `skipped` is the common case, not a failure: the queue is rarely empty during a hunt. */
  status: 'agreed' | 'diverged' | 'skipped' | 'unreachable';
  /** Ids the server holds and this device does not. Populated only on divergence. */
  missingLocally?: string[];
  /** Ids this device holds and the server does not. Populated only on divergence. */
  missingRemotely?: string[];
}

/**
 * digest = "sha256:" + hex(SHA-256(join(sort_asc([lowercase(id) for id in reports]), "\n")))
 *
 * Sort ascending bytewise over lowercase canonical UUIDs (ASCII, so bytewise and lexicographic
 * agree). Join with a single `\n`, **no trailing newline**. The digest of an empty log is the
 * SHA-256 of the empty string.
 */
export function idDigest(ids: readonly string[]): string {
  const sorted = [...ids].map((id) => id.toLowerCase()).sort();
  return `sha256:${toHex(sha256Utf8(sorted.join('\n')))}`;
}

/**
 * Compares this device's log against the server's.
 *
 * **Only audits when the outbound queue is empty.** The client's digest covers reports it has not
 * yet synced, so a mismatch is expected while anything is queued — auditing anyway would cry wolf
 * every time someone reports offline, which is the normal case.
 */
export async function audit(
  db: FoxmapperDb,
  huntCode: string,
  apiOrigin: string,
  localIds: readonly string[],
): Promise<AuditResult> {
  if ((await outboxDepth(db, huntCode)) > 0) return { status: 'skipped' };

  try {
    const response = await fetch(`${apiOrigin}/api/hunts/${huntCode}`, { cache: 'no-store' });
    if (!response.ok) return { status: 'unreachable' };

    const detail = (await response.json()) as { id_digest: string };
    if (detail.id_digest === idDigest(localIds)) return { status: 'agreed' };

    // Only now is the slow path worth it: ~180 KB for 5,000 reports, far too much to poll and
    // fine as a rare repair.
    const idsResponse = await fetch(`${apiOrigin}/api/hunts/${huntCode}/ids`, {
      cache: 'no-store',
    });
    if (!idsResponse.ok) return { status: 'unreachable' };

    const { ids: remoteIds } = (await idsResponse.json()) as { ids: string[] };
    const remote = new Set(remoteIds.map((id) => id.toLowerCase()));
    const local = new Set(localIds.map((id) => id.toLowerCase()));

    return {
      status: 'diverged',
      missingLocally: [...remote].filter((id) => !local.has(id)),
      missingRemotely: [...local].filter((id) => !remote.has(id)),
    };
  } catch {
    return { status: 'unreachable' };
  }
}
