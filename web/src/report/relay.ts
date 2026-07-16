/**
 * Entering a report on someone else's behalf — net control's job.
 *
 * The split this needs is the one AX.25 arrived at for third-party traffic: the original station's
 * callsign survives at the head of the header, and the relay is named separately. We derived it
 * from "a voice hop is where error enters"; that the two agree is a good sign.
 *
 * There is no relay-specific report kind. A relayed report is an ordinary report whose observer is
 * someone other than the operator who typed it, so every kind can be relayed and nothing in the
 * fold or the merge special-cases it.
 */
import type { Position } from '../log/types.js';
import type { AuthorContext } from './author.js';

export interface RelayDetails {
  /** Whose observation it is. **Need not be a participant** — a voice-only operator with a radio
   *  and no phone appears on the map, having never joined and holding no device in the hunt. */
  observerCallsign: string;
  /** The observer's position, set by hand: net control is not standing where they are. */
  observerPosition: Position;
  /** When the observer made the observation, not when net control typed it. */
  observedAt: number;
}

/**
 * Rewrites an authoring context so the report is attributed to the observer.
 *
 * `position_source` is always `placed`: net control's GPS is irrelevant to where the observer
 * stood, and a `measured` flag here would claim a device fix that does not exist.
 */
export function relayContext(context: AuthorContext, details: RelayDetails): AuthorContext {
  // The observer's device — if they even have one — never measured this position, so net
  // control's accuracy is dropped rather than carried: keeping it would attribute their GPS
  // quality to someone standing somewhere else entirely.
  const { position_accuracy_m: _netControlsAccuracy, ...rest } = context;

  return {
    ...rest,
    observerCallsign: details.observerCallsign.trim().toUpperCase(),
    position: details.observerPosition,
    position_source: 'placed',
    observed_at: details.observedAt,
  };
}

// Whether a report is relayed is answered by `isRelayed` in log/types.ts, which is what every call
// site uses. A second implementation lived here, byte-identical and called by nothing: two
// definitions of one predicate is how the map and the log start disagreeing about who said what.
