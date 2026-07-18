# Implementation Plan: First-Visit Product Tour

**Branch**: `003-product-tour` | **Date**: 2026-07-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-product-tour/spec.md`

## Summary

Add an optional, skippable overlay that walks a first-time visitor through FoxMapper's core
contribute-and-share loop — what you're hunting, the map and its credible-region estimate, the three
ways any radio can report (bearing, signal-strength, "I hear nothing here"), and how to bring a team
in — then leaves them on a live hunt view ready to file a real report. The overlay is a thin,
client-only layer over surfaces that already exist: it anchors each step to an existing
`data-testid`, remembers "seen/completed/declined" in the device-scoped IndexedDB `meta` store, and
never touches the report log or the network. A separate maintainer-facing safeguard — a drift test
(the source of truth) plus a Claude Code hook that runs it after edits to tour-relevant files and a
short scope doc — fails the build when a step's anchor disappears or a new report kind appears that
the tour doesn't cover, so the tour cannot silently rot.

## Technical Context

**Language/Version**: TypeScript 5.7, ES modules (native DOM, no UI framework — `el()` in
`web/src/ui/dom.ts`)

**Primary Dependencies**: MapLibre GL 5 (map/estimate rendering, reused), `idb` 8 (IndexedDB
wrapper). No new runtime dependency is added.

**Storage**: IndexedDB `meta` object store (device-scoped, key/value) via `getMeta`/`setMeta` in
`web/src/log/store.ts`. New key `tour_state`. The report log is untouched.

**Testing**: Vitest (unit, with `fake-indexeddb` and `fast-check`) and Playwright (e2e, incl. an
existing reduced-motion spec). New: a unit drift test and an e2e tour spec.

**Target Platform**: Modern evergreen browsers, mobile + desktop, installable PWA. Must work fully
offline.

**Project Type**: Single web client (`web/`). No backend changes; `server/` is not involved.

**Performance Goals**: A first-timer completes the tour in under 3 minutes (SC-001). The overlay must
not jank on a phone and must honor `prefers-reduced-motion`.

**Constraints**: Offline for the whole tour (no server round-trip); state device-local, no account;
overlay must keep the highlighted control visible on phone viewports without fully obscuring it; copy
uses hunter vocabulary only (no NRQ/DFS/PHG).

**Scale/Scope**: One tour of roughly 7–8 ordered steps over a handful of anchors; a single new
`web/src/ui/tour/` module, tour styles, two test files, and the drift safeguard.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Honest Uncertainty**: The tour introduces **no new derived estimate**. It points at the
      existing credible-region display and, per FR-009, describes the estimate as a region that grows
      less certain with poor reports — never a point. **Design obligation carried into Phase 1**: the
      scripted sample used on an empty map (FR-014) MUST itself render a credible region, not a bare
      marker, so the tour never teaches false precision. The overlay is temporary and additive; it
      MUST NOT relocate the real uncertainty signal into a footer/tooltip/modal, and its highlight
      keeps that signal visible (FR-006). **PASS.**
- [x] **II. Every Radio Contributes**: FR-008 requires the tour to show bearing, signal-strength, and
      "I hear nothing here" as equals and to state explicitly that a stock handheld contributes. The
      tour reinforces this principle. **PASS.**
- [x] **III. Offline Is the Normal Case**: Tour logic, copy, and state are entirely client-side;
      state lives in the local `meta` store; starting/advancing/finishing needs no network (FR-012,
      SC-004). The estimate step's scripted sample means the step works even with no reports and no
      tiles. No report is lost or blocked by the tour. **PASS.**
- [x] **IV. Append-Only Log, Derived State**: The tour appends **nothing** to the report log. Its
      only persisted state is a device-scoped `meta` record (`tour_state`), which is not part of the
      shared log and therefore leaves log merge a conflict-free union. Any real report a user files
      after the tour goes through the existing append path unchanged. **PASS.**
- [x] **V. Interop Over Invention, Plain Language**: The tour adds **no new report kind**, so no APRS
      DF/DFS mapping is required — it teaches the existing kinds. FR-011 forbids protocol vocabulary
      in tour copy; the existing `tests/unit/vocabulary.test.ts` guard is extended to cover tour copy.
      **PASS.**
- [x] **Operating Constraints**: No RF-leg content and no new position tracking are introduced. The
      tour makes no search-and-rescue or certification claim (copy discipline, checked in review), and
      it actively teaches that joining needs no account, install, or payment (FR-010). **PASS.**
- [x] **Fusion discipline**: This plan does **not** touch location-estimate mathematics. The scripted
      sample reuses existing rendering with fixed inputs; it adds no fusion code. **PASS.**

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-product-tour/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── tour-overlay.md      # DOM + a11y contract for the overlay
│   ├── tour-state.md        # meta key `tour_state` schema + transitions
│   └── tour-drift-check.md  # anchor manifest + what counts as tour-invalidating
└── tasks.md             # Created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

```text
web/
├── src/
│   ├── ui/
│   │   ├── tour/
│   │   │   ├── tour.ts          # controller + overlay render (open/advance/back/exit/finish)
│   │   │   ├── steps.ts         # ordered step list: anchor testid + plain-language copy
│   │   │   ├── manifest.ts      # anchors the tour depends on + report kinds it covers
│   │   │   ├── state.ts         # tour_state read/write over the meta store; version constant
│   │   │   └── sample.ts        # scripted credible-region sample for the estimate step (FR-014)
│   │   ├── tour.css             # overlay/scrim/spotlight styles (imported by app.css)
│   │   ├── settings.ts          # + "Take the tour" relaunch entry (data-testid="replay-tour")
│   │   ├── map-view.ts          # data-testid="map" on the map container (already present) — estimate-step anchor
│   │   └── report-entry.ts      # unchanged; KIND_BUTTONS/ReportKind are read by manifest.ts
│   └── main.ts                  # wire first-run offer + relaunch; owns app state (existing pattern)
└── tests/
    ├── unit/
    │   ├── tour-manifest.test.ts  # DRIFT GATE: every anchor exists in src; covered kinds == code
    │   ├── tour-state.test.ts     # state transitions over fake-indexeddb
    │   └── vocabulary.test.ts     # extended to scan tour copy for banned jargon
    └── e2e/
        └── tour.spec.ts           # offer/accept, skip, replay, keyboard, reduced-motion, offline

.claude/
└── settings.json          # + PostToolUse hook: run the drift test after edits to tour-relevant files

docs/
└── product-tour.md        # FR-019: what counts as a "significant change that may invalidate the tour"
```

**Structure Decision**: Single web client, matching the existing `web/src/ui/*` module layout. The
tour is isolated in `web/src/ui/tour/` so its surface is small and its anchor dependencies are
declared in one file (`manifest.ts`) that both the runtime and the drift test read. `main.ts` remains
the owner of app state and wiring, consistent with how `settings`/`relay` are already integrated.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| —         | —          | —                                    |
