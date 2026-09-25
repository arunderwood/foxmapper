# Implementation Plan: Location Estimate

**Branch**: `docs/location-estimate-spec` | **Date**: 2026-09-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-location-estimate/spec.md`

## Summary

Draw where the fox probably is, as one or more hatched regions that together hold 90% of the
probability. Every active report feeds it: bearings, signal strength, "heard nothing", and finds.
The estimate is off by default and switched on per device in Settings. It is computed on the
device, in a Web Worker, from the reports the device holds. It is never stored, never sent to the
hunt server, and the log format does not change.

Technical approach (research R1–R7): a posterior on a two-pass 128² grid in a local flat
projection. Each report kind contributes one kernel with a floor, so no single report can rule out
ground the others support. The region is the smallest set of cells holding 90%, split into
connected components and contoured into GeoJSON. Four measured values drive three plain-language
warnings. Every tuning number lives in one file, `values.ts`, enforced by lint. Arithmetic uses only
operations ECMAScript defines exactly, plus owned `exp`/`ln`/`sin`/`cos`/`atan2`, so an iPhone and
an Android phone draw byte-identical regions from the same reports.

A prototype confirmed the numbers are workable. Bearing-only simulated hunts give 92.8% coverage
with a near-zero floor, so the model is calibrated. With the chosen floor of 0.02, coverage is 98.2%
with honest reports and 97.7% with one confidently wrong bearing. 500 reports took 233 ms on a
laptop, about 1–1.4 s on a mid-range phone (research R3, R10).

This **supersedes 001 FR-013** (no estimate), as the spec states. It also changes one sentence in
`docs/log-format.md`.

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022 modules, no UI framework (hand-rolled DOM via `el()`
in `web/src/ui/dom.ts`)

**Primary Dependencies**: Vite (build, `?worker&url` for the estimate worker), maplibre-gl 6 (map
layers, `addImage` for the hatch). **One new dependency: `d3-contour`** (ISC, ~4 kB, brings
`d3-array`) for marching squares (research R7).

**Storage**: IndexedDB meta store, one new device-scoped key `estimate_enabled` (as `relay_mode`).
No log, payload, or server change.

**Testing**: Vitest (kernels, owned math, warnings, determinism with fast-check, reference hunts)
and Playwright (`chromium` and `mobile-safari`: switch, regions, chips, offline, cross-engine
digest, throttled timing).

**Target Platform**: Mobile-first web. iOS Safari ≥ 16 and current Android Chrome. Module Web
Workers are supported on both.

**Project Type**: Web SPA, the existing single-project layout under `web/`

**Performance Goals**: 500 active reports → region updated within 2 s on a mid-range phone, offline
(SC-002). Report entry is never blocked (FR-021): the estimate runs off the main thread.

**Constraints**: Fully offline (Principle III), including a first switch-on with no signal (research
R10). Byte-identical results across engines (FR-018, research R5). No numeric literal outside
`values.ts` (FR-035). No statistical vocabulary on any surface (FR-016, SC-007). Region drawn below
every report (FR-023). CSP unchanged: the worker is same-origin (`worker-src 'self'`), and the hatch
is an `ImageData`, not a data URL.

**Scale/Scope**: New module `web/src/estimate/` (~8 files). Edits to `main.ts` (setting, client
lifecycle, warm-up), `map-view.ts` (source, layers, chips), `settings.ts` (switch), `tour/steps.ts`
and `tour/tour.ts` (state-dependent estimate step), `tokens.css` (`--estimate`). Six new unit test
files, one new e2e spec, and extensions to `vocabulary.test.ts`, `contrast.test.ts` and
`analytics.test.ts`. New `docs/estimate.md`, and edits to `docs/log-format.md`, `docs/analytics.md`
and `docs/README.md`. No server change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Honest Uncertainty**: The estimate is always a region, never a point (FR-002). The
      region is the smallest area holding 90%, stated in words on the region itself. Poor geometry
      raises chips in the status bar, which is the primary view: too few reports (<3 positive),
      narrow spread (<30° observer span), and more than one place (second region ≥15%). None is in
      a footer, tooltip, or dismissible dialog. The floor keeps one wrong report from shrinking the
      region onto the wrong place (FR-040, SC-012).
- [x] **II. Every Radio Contributes**: Signal strength and "heard nothing" are kernels of the same
      standing as bearings (research R2), so the estimate is never bearings-only. SC-006 proves they
      change the result. A handheld-only hunt produces a region.
- [x] **III. Offline Is the Normal Case**: Computed on the device from the reports it holds. The
      worker script is warmed into the service worker cache at startup, so even a first switch-on
      offline works. No server round-trip exists anywhere in the path.
- [x] **IV. Append-Only Log, Derived State**: The log is untouched. The estimate is recomputed from
      the fold on every change, is identical across devices on the same release (research R5), and
      is never stored or merged.
- [x] **V. Interop Over Invention, Plain Language**: No new report kind, so no on-air mapping is
      needed. Participant copy uses "probably", "about 9 in 10", and "reports". The vocabulary test
      gains a banned list for statistical words (research R13).
- [x] **Operating Constraints**: No RF-leg change. No position tracking added: the only new data
      leaving the device is the anonymous `estimate_toggled {enabled}` event, under the existing
      opt-out. The existing limits statement stays, and the estimate copy makes no life-safety claim
      (FR-027). Joining is unchanged.
- [x] **Fusion discipline**: Motivated by User Story 1 of this spec, whose motivation cites 001's
      Field Validation text (hunters doing this arithmetic in their heads). No field observation
      exists yet. The constitution makes one preferred, not required.

**Post-design re-check (after Phase 1)**: all gates still pass. The design added a Web Worker, a
warm-up fetch, owned math functions, and one small dependency. None of them crosses a principle.
The server still has no opinion about direction finding.

## Project Structure

### Documentation (this feature)

```text
specs/006-location-estimate/
├── plan.md              # This file
├── research.md          # Phase 0: model, floors, determinism, worker, surfaces
├── data-model.md        # Phase 1: input, values, result, setting, reference hunts
├── quickstart.md        # Phase 1: validation guide
├── contracts/
│   ├── estimate-module.md    # Pure function, worker protocol, values, test obligations
│   └── display-surfaces.md   # Settings, map layers, chips, tour, analytics, docs
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
web/src/estimate/
├── values.ts        # ESTIMATE_VALUES: every named number, with its reason (FR-033–FR-035)
├── detmath.ts       # Owned exp, ln, sin, cos, atan2 from exact operations only (R5)
├── input.ts         # FoldResult.active → EstimateInput (drops time/clock/accuracy/relay fields)
├── kernels.ts       # One kernel per report kind, with floors (R2, R3)
├── grid.ts          # Projection, support mask, two-pass grid, 90% cell set (R1, R4)
├── regions.ts       # Connected components, d3-contour, inverse projection (R7)
├── warnings.ts      # Metrics and thresholds → WarningKind[] (R6)
├── estimate.ts      # estimate(input, values?): EstimateResult, the pure entry point
├── worker.ts        # Web Worker wrapping estimate()
├── client.ts        # Main-thread client: coalescing, generations, dispose, warmUp (R10)
└── copy.ts          # Participant-facing strings for the region and warnings

web/src/ui/
├── map-view.ts      # + estimate source, four layers, hatch image, warning chips
├── settings.ts      # + "Show where the fox probably is" switch, estimate_toggled
└── tour/            # steps.ts, tour.ts: state-dependent estimate step

web/src/main.ts      # + load estimate_enabled, own the client, warm up at start
web/src/ui/tokens.css  # + --estimate token (both themes)

web/tests/
├── unit/
│   ├── detmath.test.ts
│   ├── estimate-input.test.ts
│   ├── estimate-kernels.test.ts
│   ├── estimate-warnings.test.ts
│   ├── estimate-determinism.test.ts
│   ├── reference-hunts.test.ts
│   └── (extended) vocabulary.test.ts, contrast.test.ts, analytics.test.ts
├── reference/
│   ├── simulate.ts          # Seeded scenario and calibration-batch generator
│   ├── scenarios.ts         # The FR-038 scenarios with their expectations
│   └── recorded/README.md   # How to add a real hunt (empty today)
└── e2e/estimate.spec.ts

docs/estimate.md        # New: the model in plain words, links values.ts
docs/log-format.md      # "No location is estimated or computed" → pointer to estimate.md
docs/analytics.md       # + estimate_toggled row
docs/README.md          # + link
```

**Structure Decision**: Everything lives in the existing `web/` project. The estimate is a new
directory beside `log/`, `map/` and `report/`, because it is a peer of the fold: a pure function of
the log, owned by no single screen. The server is untouched.

## Complexity Tracking

No constitution violations. Two design choices add weight and are recorded so a reviewer can
challenge them:

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Owned `exp`/`ln`/`sin`/`cos`/`atan2` (~100 lines) | FR-018 requires the same region on every phone. ECMA-262 leaves those `Math` functions implementation-approximated, so engines differ in the last bit, and a boundary cell can flip. | Quantizing or tolerances shrink the risk but never remove it (research R5). |
| Web Worker plus a warm-up fetch | FR-021 at 500 reports, and a first switch-on while offline (Principle III). | Main-thread slicing competes with the 60 fps compass dial. The shell precache cannot see a worker that `index.html` does not reference (research R10). |
