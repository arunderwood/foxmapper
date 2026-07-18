# Implementation Plan: Visual Compass Dial for Bearing Entry

**Branch**: `004-compass-dial` | **Date**: 2026-07-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-compass-dial/spec.md`

## Summary

Replace the bearing sheet's bare, jittering degrees number with a **compass dial**: a rotating rose
(N/E/S/W, degree ticks) read under a fixed top index ("toward the fox"). On a device with a compass
the rose tracks the device — auto-live where the platform needs no permission (Android), behind an
explicit tap where a gesture is required (iOS) — damped so it reads like a settling card, and the
hunter **freezes** it with one tap. A frozen rose can be **twisted** to correct or set a bearing;
devices with no compass (and the relay path) get the same rose set by twist alone, no live mode. The
dial opens **unset** — Send stays disabled until a freeze or a twist commits a value, so no due-north
default is ever filed (feature 001's no-default-heading rule).

One log simplification rides along: a bearing is a bearing, so the write-only `heading_source` and
`compass_accuracy_deg` fields — never read by any renderer and never carried on the wire — are
dropped from the bearing payload (full rationale in [research.md](research.md)).

Technical approach: a new `compass-dial.ts` UI component (hand-rolled DOM + one inline SVG rose,
rotated by a CSS `transform`), driven by the existing `sensors/heading.ts` stream through an
angle-domain low-pass filter for damping; a pointer-events twist handler; and the existing editable
numeric field kept as the accessible, keyboard path. No new runtime dependency. No server change.

## Technical Context

**Language/Version**: TypeScript 5.7, ES2022 modules, no UI framework (hand-rolled DOM via the
`el()` helper in `web/src/ui/dom.ts`)

**Primary Dependencies**: Vite 8 (build), maplibre-gl 5 (map), `geomagnetism` (declination →
true-north conversion, unchanged), `@turf/sector` (wedge, unchanged). **No new dependency**: the
dial is inline SVG + CSS transform + Pointer Events; damping is a few lines of `sin`/`cos` math.

**Storage**: N/A. IndexedDB queue untouched. The only stored-shape change is the removal of two
fields from the `bearing` payload (see data-model.md); no migration runs — old reports keep the
fields and readers ignore them.

**Testing**: Vitest 4 (unit — dial angle math, damping/circular-mean, updated bearing-payload
fixtures) and Playwright (e2e — live/freeze/twist story, no-compass + relay by-hand, reduced-motion,
touch-target and scroll-vs-twist audits)

**Target Platform**: Mobile-first web; iOS Safari ≥ 16 (compass behind `requestPermission()` gesture),
Android Chrome current (`deviceorientationabsolute`, no permission). Dark scheme only.

**Project Type**: Web SPA, existing single-project layout under `web/`

**Performance Goals**: Dial rotation at 60 fps (transform-only, compositor-friendly); damping time
constant tuned so the rose settles visibly (~150–250 ms) without lagging a freeze; the whole
start→point→freeze→send path stays inside the ≤ 10 s one-handed budget feature 001 set (SC-001a).

**Constraints**: Fully offline (no network in any part of the interaction — SC-009); 56 px touch
floor on all controls including the freeze/live and any dial affordance; the numeric field stays the
keyboard/assistive-tech path (dial itself need not be operable by AT — clarified); `prefers-reduced-
motion` still yields a working live dial with the flourishes dropped; magnetic-only on screen, the
true-north conversion stays invisible (feature 001 FR-009).

**Scale/Scope**: ~1 new UI source file (the dial) + edits to `report-entry.ts`, `relay-entry.ts`,
`bearing.ts`, `log/types.ts`, `app.css`/`tokens.css`, and `docs/log-format.md`; ~4 existing unit
fixtures updated; ~1 new e2e spec + additions to reduced-motion/targets. No server-side changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Honest Uncertainty**: This feature computes no estimate and renders none. It touches an
      *input* to future fusion (the bearing), and it makes that input more honest, not less: the dial
      opens unset with Send disabled, so no due-north bearing is filed by default (FR-003a), and the
      reporter always sees and vouches for the value before it is sent (feature 001's FR-008b, SC-007). Confidence
      and range stay required and unchanged (FR-015), so wedges remain bounded — no uncertainty signal
      is weakened, moved, or hidden. Dropping `heading_source`/`compass_accuracy_deg` removes no
      honesty signal because nothing ever read them.
- [x] **II. Every Radio Contributes**: Bearing entry is not made the only contribution path — `omni`,
      `null`, and `fix` are untouched and keep equal placement in the report bar. The dial in fact
      *widens* access: every phone, compass or not, and the relay/by-voice path get the same
      recognizable instrument rather than a bare number (FR-011, FR-012).
- [x] **III. Offline Is the Normal Case**: The compass, dial, damping, freeze, and twist are entirely
      client-side and involve no server round-trip (FR-017). With no network for the whole hunt a
      hunter still takes and sends bearings; nothing here can be lost or blocked by connectivity.
- [x] **IV. Append-Only Log, Derived State**: Reports stay immutable append-only facts; the bearing
      stays derived-nowhere-but-the-client. The change removes two fields from new bearing payloads —
      a forward, back-compatible edit: old and foreign reports may still carry them, readers already
      ignore them, and the union merge is unaffected because presence/absence changes no key. Documented
      in `docs/log-format.md` (the living format); feature 001's closed spec is left as historical record.
- [x] **V. Interop Over Invention, Plain Language**: No new report kind and **no wire change** — the
      APRS DF mapping reads only `heading_true`, Q, and R; it never carried the dropped fields, so the
      lossless on-air round-trip is untouched. On screen the dial speaks plain language (cardinal
      marks, "toward the fox"); no protocol vocabulary appears, and declination is never shown (FR-016).
- [x] **Operating Constraints**: Joining still needs no account, install, or payment. No position
      tracking beyond the per-report position this already records; no RF-leg content; no
      search-and-rescue or certification claim is introduced.
- [x] **Fusion discipline**: No location-estimate mathematics is touched. This plan changes only how a
      single bearing is entered and shortens the payload; the posterior is not in scope.

**Post-Phase-1 re-check (2026-07-17)**: The design artifacts introduce no new violation. The
interaction contract fixes the unset/commit rule and the magnetic-only display that keep Principles I
and V intact; the log-format delta contract pins the change to a back-compatible field removal that
leaves the wire mapping and merge untouched (Principle IV/V). All gates still pass.

## Project Structure

### Documentation (this feature)

```text
specs/004-compass-dial/
├── plan.md              # This file
├── research.md          # Phase 0: dial rendering, damping, twist gesture, freeze/commit, auto-start, a11y, field removal
├── data-model.md        # Phase 1: bearing payload delta, ephemeral dial state machine, heading-draft lifecycle
├── quickstart.md        # Phase 1: build + audit walkthrough proving the SCs
├── contracts/
│   ├── bearing-entry.md # UI interaction contract: states, transitions, commit rule, metaphor, a11y, reduced motion
│   └── log-format-delta.md # The bearing-payload field removal, back-compat, and wire-invariance
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
web/
├── src/
│   ├── ui/
│   │   ├── compass-dial.ts     # NEW: the dial component — SVG rose, live rotation, freeze,
│   │   │                       #      twist (Pointer Events), numeric field; emits {heading, committed}
│   │   ├── report-entry.ts     # UPDATED: bearingSheet() hosts the dial in place of the number-only readout
│   │   ├── relay-entry.ts      # UPDATED: relayed bearing uses the dial in by-hand mode (no live compass)
│   │   ├── app.css             # UPDATED: dial styles, frozen/live states, touch-action, reduced-motion
│   │   └── tokens.css          # UPDATED (if needed): any new surface/needle roles from existing tokens
│   ├── sensors/
│   │   └── heading.ts          # REUSED: watchHeading()/needsPermission(); damping consumes its stream
│   ├── report/
│   │   └── bearing.ts          # UPDATED: drop heading_source & compass_accuracy_deg from draft/entry/composer
│   └── log/
│       └── types.ts            # UPDATED: remove the two fields from BearingPayload; drop HeadingSource type
├── tests/
│   ├── unit/
│   │   ├── compass-dial.test.ts# NEW: angle math (pointer→bearing), circular-mean damping, wrap at 360
│   │   ├── arbitraries.ts      # UPDATED: bearing arbitrary no longer generates the two fields
│   │   ├── report.test.ts      # UPDATED: bearing-payload assertions drop the fields
│   │   ├── layers.test.ts      # UPDATED: bearing fixtures drop the fields
│   │   └── wedge.test.ts       # UPDATED: bearing fixtures drop the fields
│   └── e2e/
│       ├── compass-dial.spec.ts# NEW: US1/US2/US3 — auto-live/explicit start, freeze, twist-correct,
│       │                       #      no-compass by-hand, relay by-hand, unset/Send-disabled
│       ├── reduced-motion.spec.ts # UPDATED: live dial works, flourishes dropped (FR-020)
│       └── targets.spec.ts     # UPDATED: freeze/live control and dial affordance ≥ 56 px
└── docs/
    └── log-format.md           # UPDATED: remove the two rows + example fields from the `bearing` payload
```

**Structure Decision**: Existing single-project layout under `web/` is kept. The feature adds one UI
component and one e2e spec, updates the bearing composer/type and four unit fixtures, and edits the
living log-format doc. No new packages, no directory restructuring, no server work.

## Complexity Tracking

No constitution violations to justify. The feature adds no runtime dependency (inline SVG + CSS
transform + Pointer Events), and the one stored-shape change is a *subtraction* — removing two fields
nothing consumed — which reduces the log surface rather than growing it.
