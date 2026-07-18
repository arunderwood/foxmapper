# Contract: Bearing Entry Dial

**Producer**: `web/src/ui/compass-dial.ts` — a hand-rolled component (inline SVG rose + fixed HTML
index + numeric field) that owns the ephemeral dial state machine and reports one committed magnetic
heading. **Consumers**: `report-entry.ts` (`bearingSheet`) and `relay-entry.ts` (by-hand only). The
dial is entirely client-side; no part of it fetches or waits on the network (FR-017, SC-009).

## What the dial displays

- A **rotating rose**: N/E/S/W, 5°/30° ticks, degree numerals, rotated as one SVG group by CSS
  `transform` (research R1). The rose shows **magnetic** heading only; the true-north conversion is
  invisible and unchanged (FR-002, feature 001 FR-009). No declination bezel or adjustment (FR-016).
- A **fixed top index** ("toward the fox") at 12 o'clock that does not move. **The committed bearing
  is the value under this index.**
- A **numeric heading field**, always visible, that reads and sets the exact bearing (FR-003). This
  is the accessible/keyboard path (FR-018); the SVG rose is `aria-hidden`.

## States and the commit rule

| State | Entered when | Rose tracks device? | Committed heading | Send enabled |
|---|---|---|---|---|
| `idle` | No-compass device or relay path; iOS before the start tap | no | `undefined` | no |
| `live` | Auto on open where `needsPermission()===false`; else on the start tap | yes (damped) | `undefined` | no |
| `frozen` | Freeze tapped from `live` | no (holds) | the captured smoothed heading | yes* |
| `by-hand` | Any twist, or a numeric edit, from any state | no (sensor detached) | the twisted/typed heading | yes* |

\* Send additionally requires confidence and range, unchanged (FR-015).

**Commit rule (FR-003a)**: the committed heading is `undefined` until the **first freeze or twist**.
A `live` stream under the index is *not* a commit — the dial never offers north, or the moving live
value, as a submittable default. Send stays disabled while committed is `undefined`.

## Transitions

| From | Event | To | Notes |
|---|---|---|---|
| `idle` | start tap (iOS) / permission granted | `live` | `requestPermission()` must be called inside the tap (FR-004) |
| `idle`/`live`/`frozen` | twist, or numeric edit | `by-hand` | detaches the sensor: no live update may overwrite the set value (FR-009) |
| `live` | freeze | `frozen` | captures the **displayed, damped** heading (research R2, SC-007) |
| `frozen` | go live again | `live` | **clears the commit** to `undefined` until the next freeze (Story 1 sc. 4) |
| any | submit | — | sheet reads `committed` into `composeBearing`; never sends `undefined` |

## Live behavior

- **Auto-start where allowed**: on open, if `needsPermission()` is false, begin `watchHeading()`
  immediately (`live`); otherwise stay `idle` and show the start control (FR-004, research R5).
- **Damping**: the heading is low-passed in the angle domain (sin/cos, τ ≈ 150–250 ms) so the rose
  reads like a settling card, legible in motion (FR-005). The value captured on freeze is the
  smoothed value on screen, not the latest raw sample.
- **Frozen is visibly distinct** from live at a glance (FR-006): e.g. a state class the styles key
  off; the specific treatment is an implementation choice, the distinguishability is the contract.

## Twist behavior

- Pointer Events on the rose; center-relative angle tracking so the grabbed point stays under the
  finger (research R3). No snapping — the numeric field carries the exact value.
- The dial sets `touch-action: none`; sheet scroll starts only outside the dial. Twist and scroll
  never capture each other (FR-019).

## Accessibility & reduced motion

- The numeric field is the non-gesture path; the dial need not be keyboard/AT operable (FR-018,
  clarified). All controls (start/freeze, dial) meet the 56 px touch floor (targets audit).
- Under `prefers-reduced-motion`: the rose still tracks and reads (rotation is content), but settle/
  freeze flourishes are not played (FR-020).

## Invariants a test can assert

1. On open, `committed === undefined` and Send is disabled (FR-003a) — every device.
2. After freeze, `committed` equals the value shown under the index, and it does not change on its
   own (SC-002).
3. After any twist, `committed` reflects the twist and no later sensor sample overwrites it (FR-009).
4. A submitted bearing carries only `heading_magnetic` (+ confidence/range) into the composer — no
   source or accuracy field exists to send (data-model §4, log-format-delta).
5. No-compass and relay paths never enter `live`; no dead start control is shown there (FR-011/012).
