/**
 * Authoring a report: the envelope every kind shares.
 *
 * The write path is local-only by construction — this builds a report, store.ts makes it durable,
 * sync.ts sends it whenever it can. Nothing here awaits the network, which is what makes
 * "connectivity loss cannot lose or block a report" a structural property rather than a promise.
 */
import type {
  ClockOffset,
} from '../log/clock.js';
import type { Identity } from '../log/identity.js';
import type { Position, PositionSource, Report } from '../log/types.js';
import { FORMAT_VERSION } from '../log/types.js';

export interface AuthorContext {
  huntCode: string;
  identity: Identity;
  position: Position;
  position_source: PositionSource;
  /** Advisory only — carried for display, never computed on. */
  position_accuracy_m?: number;
  /** When the observation happened, not when it was typed. */
  observed_at: number;
  /** `null` when this device has never reached the server. Not zero. */
  clock_offset_ms: ClockOffset;
  /**
   * Whose observation it is. Defaults to the entering operator; set it for a relayed report.
   * An observer need not be a participant — a voice-only operator with no phone appears on the
   * map having never joined.
   */
  observerCallsign?: string;
}

export function envelope(context: AuthorContext): Omit<Report, 'kind' | 'payload'> {
  return {
    v: FORMAT_VERSION,
    // 128 random bits, uncoordinated and offline. Never content-derived: two operators relaying
    // one voice call produce reports that may serialize identically, and both must survive.
    id: crypto.randomUUID(),
    hunt_code: context.huntCode,
    observer: { callsign: context.observerCallsign ?? context.identity.callsign },
    position: context.position,
    position_source: context.position_source,
    ...(context.position_accuracy_m !== undefined
      ? { position_accuracy_m: context.position_accuracy_m }
      : {}),
    observed_at: context.observed_at,
    clock_offset_ms: context.clock_offset_ms,
    entered_by: {
      participant_id: context.identity.participant_id,
      callsign: context.identity.callsign,
    },
  };
}
