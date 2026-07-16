/**
 * The APRS mapping and its inverse.
 *
 * Principle V: report semantics MUST map losslessly to the APRS DF and DFS formats, and protocol
 * vocabulary MUST NOT appear on any participant-facing surface. The two rules conflict on
 * purpose; the interface wins and this module absorbs the ugliness.
 *
 * **Nothing in this file may reach a participant.** It is imported by nothing that renders.
 *
 * P1 ships no gateway — nothing here transmits. This exists because "losslessly" is a claim that
 * is only true if tested, and because settling the mapping while the log format is still cheap to
 * change is what stops us discovering later that an immutable log cannot express it.
 */
import type {
  BearingPayload,
  ConfidenceQ,
  MaxRangeR,
  OmniPayload,
  StrengthS,
  WireDigit,
  WireFields,
} from '../log/types.js';

export interface DfWire {
  format: 'DF';
  raw: string;
  /** Bearing in whole degrees, 001–360 on the wire. */
  brg: number;
  n: WireDigit;
  r: WireDigit;
  q: WireDigit;
}

export interface DfsWire {
  format: 'DFS';
  raw: string;
  s: WireDigit;
  h: WireDigit;
  g: WireDigit;
  d: WireDigit;
}

export interface ThirdPartyWire {
  format: 'third-party';
  raw: string;
}

export type Wire = DfWire | DfsWire | ThirdPartyWire;

const DF_EXTENSION = /^(\d{3})\/(\d{3})\/(\d{3})\/(\d)(\d)(\d)$/;
const DFS_FIELD = /^DFS(\d)(\d)(\d)(\d)$/;

function digit(char: string): WireDigit {
  return Number(char) as WireDigit;
}

/**
 * Three digits, 001–360. North encodes as 360, never 000 — 000 in the CSE field means "the DF
 * station is fixed", and the format keeps the two unambiguous.
 */
export function degreesToBrg(headingTrue: number): string {
  const whole = Math.round(headingTrue) % 360;
  return String(whole === 0 ? 360 : whole).padStart(3, '0');
}

export function brgToDegrees(brg: string): number {
  return Number(brg) % 360;
}

/**
 * N is always 9: APRS101 defines 9 as "report is manual", and 1–8 encode a hit rate from an
 * automatic Doppler unit. Every FoxMapper report is hand-entered by a human, so 9 is not a fudge
 * — it is simply correct.
 *
 * CSE/SPD is 000/000: we report no course or speed, and 000 also carries the documented meaning
 * "the DF station is fixed", true at the moment of observation.
 */
export function encodeBearing(payload: BearingPayload): DfWire {
  const brg = degreesToBrg(payload.heading_true);
  // The authored unions are subsets of WireDigit by construction, so these need no cast — which
  // is the type system carrying the honesty cap rather than a comment asking for it.
  const n = 9 as const;
  const r: WireDigit = payload.max_range_r;
  const q: WireDigit = payload.confidence_q;
  return { format: 'DF', raw: `000/000/${brg}/${n}${r}${q}`, brg: Number(brg), n, r, q };
}

/** `h`, `g` and `d` are emitted as documented defaults — P1 collects none of them. */
export function encodeOmni(payload: OmniPayload): DfsWire {
  const s: WireDigit = payload.strength_s;
  return { format: 'DFS', raw: `DFS${s}000`, s, h: 0, g: 0, d: 0 };
}

/**
 * "I heard nothing here" is `DFS` with `s = 0` — an existing format whose documented purpose is
 * exactly this. APRS101 p.30: 0-strength reports draw the circles where the jammer is *not*
 * heard, and there are far more of them than of stations that do hear it.
 */
export function encodeNull(): DfsWire {
  return { format: 'DFS', raw: 'DFS0000', s: 0, h: 0, g: 0, d: 0 };
}

/**
 * Third-party traffic. The original station's callsign survives unchanged at the head of the
 * header; the relay is named separately — structurally our `observer` vs `entered_by`.
 */
export function encodeThirdParty(
  observerCallsign: string,
  enteredByCallsign: string,
  payload: string,
): string {
  return `}${observerCallsign}>APRS,TCPIP,${enteredByCallsign}*:${payload}`;
}

export function decodeWire(raw: string): Wire {
  const df = DF_EXTENSION.exec(raw);
  if (df) {
    return {
      format: 'DF',
      raw,
      brg: Number(df[3]),
      n: digit(df[4]!),
      r: digit(df[5]!),
      q: digit(df[6]!),
    };
  }

  const dfs = DFS_FIELD.exec(raw);
  if (dfs) {
    return {
      format: 'DFS',
      raw,
      s: digit(dfs[1]!),
      h: digit(dfs[2]!),
      g: digit(dfs[3]!),
      d: digit(dfs[4]!),
    };
  }

  return { format: 'third-party', raw };
}

/**
 * Reconstruct the wire string from the parsed digits alone, ignoring `raw`.
 *
 * This is the losslessness claim made checkable: if our parse dropped something,
 * `emitFromDigits(decode(w)) !== w`. Use `emit` for actual re-emission.
 */
export function emitFromDigits(wire: Wire): string {
  switch (wire.format) {
    case 'DF':
      return `000/000/${String(wire.brg).padStart(3, '0')}/${wire.n}${wire.r}${wire.q}`;
    case 'DFS':
      return `DFS${wire.s}${wire.h}${wire.g}${wire.d}`;
    case 'third-party':
      return wire.raw;
  }
}

/** On re-emit, `raw` wins over the parsed digits if they ever disagree. */
export function emit(wire: Wire): string {
  return wire.raw;
}

/**
 * The Q and R digits as our payload sees them, plus the heading the wire could carry.
 *
 * Returns raw digits, undecoded. The Q→degrees table is contested — APRS101 and PROTOCOL.TXT
 * disagree, and PROTOCOL.TXT omits the digit 6 — so decoding on write would freeze our reading of
 * a disputed spec into an immutable log. APRS101 is normative for display, because Xastir (the
 * reference implementation) implements its table exactly.
 */
export function bearingFieldsFromWire(wire: Wire): {
  heading_true: number;
  confidence_q: WireDigit;
  max_range_r: WireDigit;
} {
  if (wire.format !== 'DF') throw new TypeError(`not a DF report: ${wire.format}`);
  return {
    heading_true: brgToDegrees(String(wire.brg).padStart(3, '0')),
    confidence_q: wire.q,
    max_range_r: wire.r,
  };
}

export function strengthFromWire(wire: Wire): WireDigit {
  if (wire.format !== 'DFS') throw new TypeError(`not a DFS report: ${wire.format}`);
  return wire.s;
}

/** APRS101's Q table, for display only. Never written to the log. */
const Q_DEGREES: Readonly<Record<number, string>> = {
  0: 'useless',
  1: '<240°',
  2: '<120°',
  3: '<64°',
  4: '<32°',
  5: '<16°',
  6: '<8°',
  7: '<4°',
  8: '<2°',
  9: '<1°',
};

/**
 * Half-width of the wedge in degrees, for rendering. Q=0 is overloaded between the two specs
 * ("useless" vs "OMNI") and we never emit it; on ingest we retain the digit and render nothing
 * directional, which is why this returns null rather than guessing.
 */
export function wedgeHalfWidthDegrees(q: WireDigit | ConfidenceQ): number | null {
  const widths: Readonly<Record<number, number>> = { 1: 240, 2: 120, 3: 64, 4: 32, 5: 16, 6: 8, 7: 4, 8: 2, 9: 1 };
  const full = widths[q];
  return full === undefined ? null : full / 2;
}

/** Range in miles: 2^R. Ours is always 1, 3 or 5 → 2, 8 or 32 miles. */
export function rangeMiles(r: WireDigit | MaxRangeR): number {
  return 2 ** r;
}

export function qDescription(q: WireDigit): string {
  return Q_DEGREES[q] ?? 'unknown';
}

/** Compile-time proof the authored ranges are subsets of the wire digit range. */
const _authoredQ: readonly ConfidenceQ[] = [3, 4, 5];
const _authoredR: readonly MaxRangeR[] = [1, 3, 5];
const _authoredS: readonly StrengthS[] = [2, 5, 8];
export const AUTHORED = { q: _authoredQ, r: _authoredR, s: _authoredS } as const;

/** Build the `wire` object stored on an ingested report. */
export function toWireFields(wire: Wire): WireFields {
  switch (wire.format) {
    case 'DF':
      return { format: 'DF', raw: wire.raw, n: wire.n, r: wire.r, q: wire.q };
    case 'DFS':
      return { format: 'DFS', raw: wire.raw, s: wire.s, h: wire.h, g: wire.g, d: wire.d };
    case 'third-party':
      return { format: 'third-party', raw: wire.raw };
  }
}
