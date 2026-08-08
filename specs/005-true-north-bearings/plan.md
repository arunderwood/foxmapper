# Implementation Plan: True North Bearings Without Declination Math

**Branch**: `005-true-north-bearings` | **Date**: 2026-08-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-true-north-bearings/spec.md`

## Summary

Close the seam between bearing entry and the map. Today the dial shows a **magnetic** heading, the
wedge renders the **true** one, and neither number is labeled — a correct ~15° conversion that users
experience as a wrong wedge. After this feature: every displayed heading is in true north with a
visible plain-language reference label; the device compass is normalized to true silently (the
conversion moves from submit time to display time); and hand-entered bearings carry a one-tap
reference switch that defaults to magnetic and shows the converted number it would switch to.
Report detail (the map popup) shows both values; the settings sheet gains a plain-language
declination line. The log format does not change — both headings and the conversion facts are
already recorded.

This **supersedes feature 004's "magnetic-only on screen" display decision** (004 plan, Technical
Context "Constraints"; compass-dial.ts header). That decision implemented feature 001's FR-009 as
"conversion stays invisible"; field feedback showed invisibility is the bug, not the feature. The
wire, the log, and the wedge math are untouched.

Technical approach: give the dial a **north-reference state**. Sensor samples are converted
magnetic→true at the point they enter the dial (declination computed once per sheet-open from the
report's origin position, offline via the existing on-device WMM); twist and freeze operate in the
displayed reference; the numeric field carries a reference chip whose switch shows the converted
value. `composeBearing` accepts a draft in either reference and stores the entered value verbatim
in its own field, deriving the counterpart — so the displayed number and the logged number are
identical by construction, never by rounding luck. New display strings on the popup and settings
sheet. No new dependency, no server change, no log-format change.

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022 modules, no UI framework (hand-rolled DOM via `el()`
in `web/src/ui/dom.ts`)

**Primary Dependencies**: Vite (build), maplibre-gl 6 (map), `geomagnetism` (WMM declination —
already a dependency, already offline), `@turf/sector` (wedge, unchanged). **No new dependency.**

**Storage**: N/A — no schema or payload change. `BearingPayload` keeps
`heading_true`/`heading_magnetic`/`declination`/`wmm_epoch` exactly as is; only which one is
"entered verbatim" vs "derived" changes per report, which the format never distinguished.

**Testing**: Vitest (unit — reference conversion round-trips, dial reference-state rules,
compose-from-either-reference exactness, label strings) and Playwright (e2e — true-display dial
with a mocked sensor at a known-declination location, relay magnetic entry with switch preview,
popup both-values line, settings declination line, offline)

**Target Platform**: Mobile-first web; iOS Safari ≥ 16, Android Chrome current. Both platforms'
compasses report **magnetic** (heading.ts); FR-004's true-reporting-device case is handled by
contract at the sensor boundary (research R6), not by speculative runtime detection.

**Project Type**: Web SPA, existing single-project layout under `web/`

**Performance Goals**: No new rendering work — the conversion is one addition per sensor sample
before the existing smoother; dial stays transform-only at 60 fps. Entry flows stay inside the
≤10 s one-handed budget from feature 001; the reference switch adds zero required taps to the
compass path and at most one to the relay path.

**Constraints**: Fully offline (WMM is on-device; FR-007). Reference labels on every displayed
heading (FR-002) in hunter language only (FR-012). Entered value stored verbatim in its reference
(FR-003 exactness, research R3). 56 px touch floor applies to the new reference switch. The
numeric field remains the keyboard/assistive-tech path; the reference chip must be reachable and
announced there too.

**Scale/Scope**: Edits to `compass-dial.ts` (reference state, converted sensor input, chip/switch),
`report/bearing.ts` (compose from either reference), `report-entry.ts` + `relay-entry.ts` wiring
(declination at sheet-open, relay default magnetic), `map-view.ts` popup (both-values line),
`settings.ts` (declination line), `sensors/declination.ts` (one new `toMagneticHeading` inverse +
plain-language formatter), CSS for the chip. ~3 unit test files touched + 1 new, ~2 e2e specs
touched + 1 new. No server-side changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Honest Uncertainty**: No estimate or credible region is touched — wedge geometry,
      confidence, and range are unchanged. The feature makes an input *more* honest: the reference
      label states the frame a number is in, the switch shows the conversion before it is taken,
      and a stale magnetic model is declared in the open (FR-009) rather than silently applied.
      Labels add no false precision: displayed values keep today's rounding, and nothing renders
      more precisely than before.
- [x] **II. Every Radio Contributes**: Signal-strength, "nothing here", and found-it reports are
      untouched and remain equal-prominence paths. The relay flow — the stock-handheld hunter's
      voice path — is the primary beneficiary: their dictated magnetic bearing is now enterable
      accurately with zero training and zero arithmetic.
- [x] **III. Offline Is the Normal Case**: Declination comes from the bundled WMM model on-device
      (existing `geomagnetism` dependency); conversion, labels, switch preview, popup line, and
      settings line all work with no network for the whole hunt. No server round-trip exists
      anywhere in this feature.
- [x] **IV. Append-Only Log, Derived State**: No payload or format change. Reports remain immutable;
      a wrong-reference entry is corrected by the existing retraction flow (spec Story 2 scenario
      4). Merge stays a conflict-free union — every report still carries its own conversion facts,
      so two clients render one report identically.
- [x] **V. Interop Over Invention, Plain Language**: No new report kind, no wire change — the APRS
      DF mapping reads `heading_true` and never sees the reference chip. On screen: "true north" /
      "magnetic" are the words hunters use on the repeater; "declination" appears only in the
      settings detail line with its meaning stated in plain words; WMM epoch surfaces only as
      "the 2025 magnetic model" (FR-012). No NRQ/DFS/PHG vocabulary is introduced anywhere.
- [x] **Operating Constraints**: No account/install/payment change, no RF-leg content, no tracking
      change, no certification claim. Nothing here touches privacy or regulatory surface.
- [x] **Fusion discipline**: No location-estimate mathematics is touched. The posterior, fold, and
      wedge fusion are out of scope; this plan changes entry and display of a single bearing only.

**Post-Phase-1 re-check (2026-08-07)**: The design artifacts introduce no new violation. The
reference-entry contract fixes the sticky-reference rule so no number is ever reinterpreted behind
the user's back (Principle I in miniature); the display contract confines "declination" to the
settings detail (Principle V); data-model.md confirms zero log-format delta (Principle IV). The
supersession of 004's magnetic-only display is a display-layer decision reversal recorded in
research R7 — it changes no principle outcome. All gates still pass.

## Project Structure

### Documentation (this feature)

```text
specs/005-true-north-bearings/
├── plan.md              # This file
├── research.md          # Phase 0: reference model, conversion point, exactness, switch UI, detail placement, sensor boundary, 004 supersession
├── data-model.md        # Phase 1: draft shape, dial reference state, zero log-format delta
├── quickstart.md        # Phase 1: build + walkthrough proving the SCs
├── contracts/
│   ├── reference-entry.md   # Entry-surface contract: reference state, defaults, sticky rule, switch preview, a11y
│   └── display-surfaces.md  # Display contract: labels everywhere, popup both-values, settings declination line, staleness wording
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
web/
├── src/
│   ├── sensors/
│   │   ├── declination.ts   # EDIT: add toMagneticHeading (inverse), plain-language describeDeclination
│   │   └── heading.ts       # UNCHANGED code; header contract reaffirmed (magnetic-only boundary, R6)
│   ├── report/
│   │   └── bearing.ts       # EDIT: BearingDraft gains reference; compose stores entered value verbatim
│   ├── ui/
│   │   ├── compass-dial.ts  # EDIT: reference state + chip/switch; sensor samples converted to true on arrival
│   │   ├── report-entry.ts  # EDIT: pass origin declination into dial; own-sheet defaults (true / typed→magnetic)
│   │   ├── relay-entry.ts   # EDIT (wiring only): relay bearing sheet opens in magnetic
│   │   ├── map-view.ts      # EDIT: popup heading line with both values, labeled
│   │   ├── settings.ts      # EDIT: declination detail line (value, direction, model vintage, staleness)
│   │   ├── main.ts          # EDIT (wiring only): relay-armed by-hand mode already routed here; pass position into settings
│   │   └── app.css / tokens.css  # EDIT: reference chip styling, 56px switch target
│   └── aprs/mapping.ts      # UNCHANGED (reads heading_true only)
└── tests/
    ├── unit/
    │   ├── declination.test.ts   # EDIT: inverse round-trip, describe strings
    │   ├── compass-dial.test.ts  # EDIT: reference-state rules, converted live samples
    │   ├── report.test.ts        # EDIT: compose from either reference, verbatim-storage exactness
    │   └── reference.test.ts     # NEW: sticky-reference rule table, switch-preview values
    └── e2e/
        ├── compass-dial.spec.ts  # EDIT: mocked sensor now asserts true-labeled display
        ├── relay.spec.ts         # EDIT: magnetic default + switch preview in relay bearing entry
        └── true-north.spec.ts    # NEW: entry↔wedge agreement, popup both-values, settings line, offline
```

**Structure Decision**: Existing single-project `web/` layout; this feature adds one unit test file
and one e2e spec, edits ~8 source files, and touches no server code.

## Complexity Tracking

No constitution violations to justify. (The 004 display-decision reversal is recorded in research
R7 as a supersession with rationale, not a violation: feature 001's FR-009 required true north in
the *log*, which is preserved; 004 additionally chose invisibility of the conversion, which field
feedback overturned.)
