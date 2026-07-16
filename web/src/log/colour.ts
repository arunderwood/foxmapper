/**
 * Observer colour, derived from the callsign and never stored.
 *
 * Storing colour would let two reports name one observer in two colours — net control relaying
 * KI7XYZ picks one, KI7XYZ's own device picks another — and would put derived state inside an
 * immutable record. Deriving from `participant_id` has the same failure: one operator, two
 * colours. The callsign is the only key that gives one person one colour everywhere.
 */
import { sha256Utf8 } from './sha256.js';
import { isRelayed, type ObservationReport } from './types.js';

/**
 * Normative and ordered. Changing this list, or its order, repaints every hunt — it is versioned
 * with the format, not tuned casually.
 *
 * These twelve swatches are provisional: no colour-vision-deficiency check and no direct-sunlight
 * check has been done (see tasks T071). The algorithm is settled; the swatches are not.
 */
export const PALETTE = [
  '#e5533d',
  '#f2a03d',
  '#d9c02b',
  '#6bbf3f',
  '#2fae7e',
  '#2eb0c4',
  '#5b8ff9',
  '#7f6bd6',
  '#c264c2',
  '#e0629b',
  '#9c6b45',
  '#8a8f99',
] as const;

export type Swatch = (typeof PALETTE)[number];

export function normalizeCallsign(callsign: string): string {
  return callsign.trim().toUpperCase();
}

/**
 * colour = PALETTE[ be_u32(SHA-256(utf8(upper(trim(cs))))[0..4]) mod len(PALETTE) ]
 *
 * Specified to the byte because Principle IV requires derived state be computed identically on
 * every client, and two devices disagreeing about who is orange is that guarantee failing
 * visibly.
 */
export function colourFor(callsign: string): Swatch {
  const digest = sha256Utf8(normalizeCallsign(callsign));
  const be32 = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
  return PALETTE[be32 % PALETTE.length]!;
}

/**
 * Callsigns entered by two or more distinct participants *as their own observation*.
 *
 * Self-reports only. A relayed report carries net control's participant_id in `entered_by`, so
 * counting it would flag a collision between KI7XYZ and themselves every time somebody relays
 * them.
 */
export function ambiguousCallsigns(active: readonly ObservationReport[]): ReadonlySet<string> {
  const participantsByCallsign = new Map<string, Set<string>>();
  for (const report of active) {
    const callsign = report.observer.callsign;
    if (callsign !== report.entered_by.callsign) continue; // relayed — cannot disambiguate
    let participants = participantsByCallsign.get(callsign);
    if (!participants) participantsByCallsign.set(callsign, (participants = new Set()));
    participants.add(report.entered_by.participant_id);
  }

  const ambiguous = new Set<string>();
  for (const [callsign, participants] of participantsByCallsign) {
    if (participants.size >= 2) ambiguous.add(callsign);
  }
  return ambiguous;
}

/** First 2 hex characters of the entering participant's id. */
export function suffixFor(participantId: string): string {
  return participantId.replace(/-/g, '').slice(0, 2);
}

/**
 * "KI7XYZ" normally; "KI7XYZ ·a3" only when a collision actually exists. A suffix on every
 * report would be noise in exchange for a case that rarely arises.
 *
 * A relayed report cannot be disambiguated at all — the observer is a bare callsign with no
 * participant_id. The voice call did not disambiguate either, and the map should not claim to
 * know more than the radio did.
 */
export function displayName(
  callsign: string,
  enteringParticipantId: string,
  ambiguous: ReadonlySet<string>,
): string {
  if (!ambiguous.has(callsign)) return callsign;
  return `${callsign} ·${suffixFor(enteringParticipantId)}`;
}

/**
 * The name to put on a report, which is `displayName` for a self-report and **the bare callsign for
 * a relayed one**.
 *
 * A relayed report carries the *relayer's* `participant_id`, so passing it to `displayName` would
 * suffix the observer with a marker identifying who typed it — a distinction the observer never
 * made and the voice call never carried. `ambiguousCallsigns` already excludes relayed reports from
 * detection; this is the other half of that rule, and it belongs here rather than at the call site
 * where it was missed once already.
 */
export function labelFor(report: ObservationReport, ambiguous: ReadonlySet<string>): string {
  if (isRelayed(report)) return report.observer.callsign;
  return displayName(report.observer.callsign, report.entered_by.participant_id, ambiguous);
}
