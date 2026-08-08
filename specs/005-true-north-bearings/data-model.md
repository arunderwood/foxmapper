# Data Model: True North Bearings Without Declination Math

**Feature**: 005-true-north-bearings | **Date**: 2026-08-07

## 1. The log format: zero delta

`BearingPayload` is unchanged, byte for byte:

```ts
interface BearingPayload {
  heading_true: number;      // [0, 360)
  heading_magnetic: number;  // [0, 360)
  declination: number;       // signed degrees, magnetic + declination = true
  wmm_epoch: string;         // e.g. "WMM2025"
  confidence_q: ConfidenceQ;
  max_range_r: MaxRangeR;
}
```

What changes is only **which field is verbatim**: a bearing entered in the true reference stores
the entered value (normalized) as `heading_true` and derives `heading_magnetic`; entered in
magnetic, the reverse (research R3). The format has never distinguished entered from derived, so
new reports are indistinguishable in shape from old ones, old reports render correctly under the
new display rules, foreign reports merge as before, and the APRS mapping (reads `heading_true`
only) is untouched. No migration, no version bump, no `docs/log-format.md` semantic change — at
most a clarifying sentence there that either field may be the verbatim one.

**Invariant (unchanged)**: `heading_true = normalize(heading_magnetic + declination)` holds on
every authored report, now enforced from whichever side was entered.

## 2. New domain type: `NorthReference`

```ts
type NorthReference = 'true' | 'magnetic';
```

A property of a *displayed or entered number*, never of the physical direction and never of a
logged report (spec, Key Entities). It lives in the entry/display layer only; it does not appear
in any payload (research R3 — the same reasoning that dropped `heading_source` in 004).

## 3. `BearingDraft`: heading + reference

```ts
// report/bearing.ts — replaces { heading_magnetic: number }
interface BearingDraft {
  heading: number;            // as displayed/entered, in `reference`
  reference: NorthReference;
}

interface BearingEntry extends AuthorContext {
  draft: BearingDraft;
  /** The declination the sheet displayed with — the same value the switch preview used. */
  declination: Declination;
  confidence_q: ConfidenceQ;
  max_range_r: MaxRangeR;
}
```

`composeBearing` no longer computes declination internally: the sheet passes the `Declination` it
computed at open (research R2), so the preview the user saw and the stored conversion are one
value by construction. `declinationAt` is still called exactly once per sheet — just by the sheet
instead of the composer.

## 4. Declination helpers (sensors/declination.ts)

Existing: `declinationAt`, `toTrueHeading`, `normalizeHeading` — unchanged.

Added:

```ts
/** True → magnetic. Inverse of toTrueHeading; the only other conversion, kept beside it. */
function toMagneticHeading(headingTrue: number, declinationDegrees: number): number;

/** "Magnetic north is about 15° east of true north here" (+ stale suffix). Whole degrees (R9).
 *  East when declination > 0, west when < 0; near-zero (|d| < 0.5°) says they "line up here". */
function describeDeclination(d: Declination): string;
```

Round-trip law (unit-tested): for any heading `h` and declination `d`,
`toMagneticHeading(toTrueHeading(h, d), d) === h` within float epsilon after normalization — but
note R3 means the composed payload never relies on this round trip.

## 5. Ephemeral dial state (compass-dial.ts)

Feature 004's state machine (`idle | live | frozen | by-hand`) is unchanged. One axis is added:

```ts
// New DialOptions fields
interface DialOptions {
  mode?: DialMode;                     // unchanged: 'auto' | 'by-hand'
  declination: Declination;            // NEW, required: from the sheet's origin position at open
  defaultReference?: NorthReference;   // NEW: 'true' (auto sheets) | 'magnetic' (by-hand/relay)
  onChange?: (committed: CommittedHeading | undefined) => void;
}

/** What the dial now commits: the number and the frame it was entered in. */
interface CommittedHeading {
  heading: number;
  reference: NorthReference;
}
```

State additions and rules (full transition table in
[contracts/reference-entry.md](contracts/reference-entry.md)):

- `activeReference: NorthReference` — starts at `defaultReference`; the rose, field, twist, and
  committed value are all expressed in it.
- Live sensor samples are converted magnetic→true on ingest (`toTrueHeading(sample, decl)`), and
  going live **forces** `activeReference = 'true'` — a sensor-drafted number is never displayed
  or committed as magnetic (FR-004, FR-002).
- Typing while nothing is committed switches `activeReference` to `'magnetic'` first (the
  empty-state rule, contract §2): a fresh typed number is hand entry even in the `auto` sheet.
  Typing that edits a committed value follows the active reference.
- The reference switch converts `displayed`/`committed` between frames using the dial's
  `declination`; it changes the number, never the direction.
- `committedHeading()` returns `CommittedHeading | undefined` (was `number | undefined`); both
  sheets pass it through to the draft unchanged.

## 6. Display-only derived strings

No stored state. Pure functions over `BearingPayload` / `Declination`, contract in
[contracts/display-surfaces.md](contracts/display-surfaces.md):

- Popup heading line: both values, whole degrees, each labeled — from `heading_true`,
  `heading_magnetic` as stored (no recomputation from `declination`).
- Settings declination line: `describeDeclination(declinationAt(current position))`, computed at
  sheet-open, offline, stale-suffixed per FR-009.
