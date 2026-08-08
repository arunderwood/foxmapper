# Contract: Bearing Entry Reference Handling

**Feature**: 005-true-north-bearings | Governs: `compass-dial.ts`, `report-entry.ts`,
`relay-entry.ts`

The rules that make FR-002/003/004/005 structural. Any implementation change that keeps these
observable behaviors is conformant.

## 1. One active reference per surface

A bearing-entry surface (dial + numeric field + chip, as one unit) has exactly one active
reference at any moment. The rose orientation, the numeric field's value, the unit label, the
twist gesture, and the committed value are all expressed in it. There is no state in which two
elements of the surface speak different references.

## 2. Defaults

| Surface | Opens in | Why |
|---|---|---|
| Own bearing sheet (`auto` dial — the only own-sheet mode; a no-compass phone gets this dial and simply never sees Freeze) | **true** | Default flows display true only (FR-002); compass drafting and twist-to-aim land here |
| Relay bearing sheet (`by-hand` dial — armed relay target is the only `by-hand` case) | **magnetic** | A dictated bearing is almost always a magnetic compass reading (FR-005) |

The default is fixed per surface — never remembered across sheet opens, never a setting
(clarification 2026-08-07 Q2).

**Empty-state typing rule (FR-005)**: typing into the numeric field while **no value is
committed** switches the active reference to magnetic first, regardless of surface — a fresh
typed number is hand entry (a physical-compass reading), not compass drafting. Typing that edits
an already-committed value follows the active reference (a frozen compass value stays true
through edits). Clearing the field un-commits, so retyping from empty is fresh entry again.

## 3. Transitions

| Event | Effect on reference | Effect on number |
|---|---|---|
| Sensor goes live (auto-start, "Use the compass", "Take again") | **Forced to true** | Live display shows converted samples: `toTrueHeading(magnetic sample, declination)` through the smoother |
| Freeze | stays true | Committed value = displayed true heading |
| Twist | unchanged | Adjusts the displayed number in the active reference |
| Typing in the field (a value is committed) | unchanged | Edits the number in the active reference |
| Typing in the field (nothing committed) | **Switches to magnetic** first (empty-state rule, §2) | Commits the typed number as magnetic unless the chip is switched |
| Chip tap (the switch) | Flips | Displayed/committed number converts via the sheet's declination; the physical direction claimed is identical before and after |

Consequences worth stating: a frozen compass value can be *viewed* in magnetic by tapping the
chip (the number converts; it is still the same direction); going live again converts the surface
back to true. No event reinterprets an existing number in a new frame — the switch converts,
everything else preserves.

## 4. The chip and switch (one control)

- Sits adjacent to the numeric field; minimum 56 px touch target.
- Shows the active reference as the field's unit: `220.0 ° magnetic` / `235.0 ° true`.
- The switch face shows **the converted number it would switch to**, not a bare reference name,
  and **leads with a verb** so it reads as a control rather than an annotation: active magnetic
  220.0 → switch reads `use 235.0° true` (clarification 2026-08-07 Q3; a bare `= 235.0° true`
  reads as math and invites no tap — labels keep their verb, per the standing status-copy rule).
  Empty field (nothing committed) → switch shows just the other reference name, verb-led
  (`enter as true north`), enabled-but-only-flipping-the-frame; it must not invent a number.
- Precision: same as the field (0.1°), both values rounded independently from exact values (R9).
- Wording: exactly "true" and "magnetic" (lowercase in running text, per current UI voice). The
  word "declination" does not appear on this surface (FR-012).

## 5. Exactness (FR-003 / SC-001)

The committed `{ heading, reference }` is handed to `composeBearing` verbatim; the payload stores
it unrounded in its own field (`heading_true` if reference true, `heading_magnetic` if magnetic)
and derives the counterpart with the same `Declination` instance the surface displayed with.
Test oracle: for any entry, `payload[entered field] === normalize(entered value)` exactly, and
the wedge centerline equals `payload.heading_true`.

## 6. Sensor boundary (FR-004)

`sensors/heading.ts` emits magnetic headings, always — that is its documented contract, and this
feature reaffirms rather than changes it. The magnetic→true conversion is applied exactly once,
on ingest into the dial. No other code path converts sensor samples. A future platform reporting
true headings is heading.ts's problem to normalize behind the same interface (research R6); the
dial's contract ("samples arrive magnetic, display is true") is unchanged by that eventuality.

## 7. Accessibility

- The numeric field remains the keyboard/AT path (004's decision, unchanged). Its accessible name
  must include the active reference ("Bearing in degrees, true north" / "…, magnetic").
- The chip is a real button in the tab order; its accessible name states the action and the
  result: "Switch to 235.0 degrees true".
- Reference changes are announced (the field's label change or a polite live region — one of
  them, not both).
- The SVG rose stays `aria-hidden` (004, unchanged).

## 8. Status copy

Status lines keep their verbs (maintainer's standing rule: cut qualifiers, never the verb).
Existing lines ("Point the phone at the fox and freeze — or twist the dial to set it", "Set by
hand", …) are unchanged except where they name a number's frame, which they currently never do.
No new status line may name "declination".
