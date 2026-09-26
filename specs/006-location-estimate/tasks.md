# Tasks: Location Estimate

**Input**: Design documents from `/specs/006-location-estimate/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/estimate-module.md,
contracts/display-surfaces.md, quickstart.md

**Tests**: Included. The spec's success criteria and the module contract (§4) name explicit unit
and e2e coverage, and the project's convention (001–005) is tests with every story.

**Organization**: The spec has one user story, deliberately (spec, "Why this priority"). Phase 2
builds the parts every later task stands on, without changing anything a participant sees. Phase 3
is the story: the estimate engine, then the worker, then the surfaces.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1)

## Path Conventions

Single web project under `web/`: sources in `web/src/`, unit tests in `web/tests/unit/`, reference
hunts in `web/tests/reference/`, e2e in `web/tests/e2e/` (plan.md, Project Structure).

---

## Phase 1: Setup

**Purpose**: A clean baseline, the one new dependency, and the lint rule that guards FR-035

- [X] T001 Baseline: stop any stale preview server on :4173, then run `npm run typecheck && npm run lint && npm run test:unit && npm run test:e2e` in `web/` and confirm everything passes before any edit
- [X] T002 Add `d3-contour` as a runtime dependency and `@types/d3-contour` as a dev dependency in `web/package.json` (`npm install d3-contour` and `npm install -D @types/d3-contour` in `web/`), and confirm `npm run build` still succeeds (research R7)
- [X] T003 [P] Add a scoped ESLint block in `web/eslint.config.js`: for `src/estimate/**/*.ts`, enable `no-magic-numbers` with `ignore: [0, 1, 2, 0.5, -1]`, `ignoreArrayIndexes: true`, `ignoreDefaultValues: true`; exempt `src/estimate/values.ts` and `src/estimate/detmath.ts` (research R8, contracts/estimate-module.md §3)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The named values, the exact-arithmetic math, and the input boundary. After this phase
the app builds and behaves exactly as today.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Create `web/src/estimate/values.ts` exporting `ESTIMATE_VALUES` as a frozen object and an `EstimateValues` type, with every field, initial value and unit from data-model.md §2. Give each field a doc comment stating its unit and the reason for its value, taken from research R2, R3, R4 and R6. Export nothing else
- [X] T005 [P] Create `web/src/estimate/detmath.ts` exporting `exp`, `ln`, `sin`, `cos`, `atan2`. Build each from `+ − × ÷`, comparisons, and `Math.sqrt`/`Math.floor`/`Math.abs`/`Math.min`/`Math.max` only: range reduction plus fixed-degree polynomial or rational approximations (for example Cody–Waite reduction for `exp`, argument splitting at √2 for `ln`, and reduction to [0, π/4] for `sin`/`cos`/`atan`). The header comment states why (research R5, citing ECMA-262 §21.3.2 and §21.3.2.33)
- [X] T006 [P] Create `web/src/estimate/types.ts` with `EstimateReport` (discriminated union by `kind`, fields exactly as data-model.md §1), `EstimateInput`, `Region`, `EstimateMetrics`, `WarningKind` and `EstimateResult` (data-model.md §3–§4)
- [X] T007 Create `web/src/estimate/input.ts` exporting `toEstimateInput(active: readonly ObservationReport[], generation: number): EstimateInput`. It maps each active report to `EstimateReport` (bearing: `heading_true`, `confidence_q`, `max_range_r`; omni: `strength_s`), drops every other field, and sorts by `id` ascending (depends on T006)
- [X] T008 [P] Unit tests in `web/tests/unit/detmath.test.ts`: each of `exp`, `ln`, `sin`, `cos`, `atan2` agrees with `Math` within 1e-12 relative error over the ranges the estimate uses (exp on [−745, 0]; ln on (0, 1e6]; sin/cos on [−4π, 4π]; atan2 on all four quadrants and both axes), and returns identical bits across two calls
- [X] T009 [P] Source-scan unit test in `web/tests/unit/estimate-purity.test.ts`: read every `.ts` file under `web/src/estimate/` and fail if any calls a `Math.` member other than `sqrt`, `floor`, `abs`, `min`, `max`, or references `Math.random`, `Date`, `performance`, `localStorage` or `indexedDB` (research R5, contracts/estimate-module.md §1 and §3)
- [X] T010 [P] Unit tests in `web/tests/unit/estimate-input.test.ts`: the output of `toEstimateInput` has no `observed_at`, `clock_offset_ms`, `position_accuracy_m`, `position_source`, `observer` or `entered_by` key on any report (FR-006, FR-008, FR-009); input order does not change the output; a relayed report and a direct report with the same content map to equal `EstimateReport`s apart from `id`
- [X] T011 [P] Unit test in `web/tests/unit/estimate-values.test.ts`: every floor lies in (0, 1); `NULL_CLEAR_INNER_KM < NULL_CLEAR_OUTER_KM`; the omni medians strictly fall from weak to medium to strong; `REGION_LEVEL === 0.9`; the object is frozen (data-model.md §2, Validation)

**Checkpoint**: `npm run typecheck && npm run lint && npm run test:unit` pass. There is no
user-visible change.

---

## Phase 3: User Story 1 - Where the fox probably is (Priority: P1) 🎯 MVP

**Goal**: With the estimate switched on, the map shades where the fox probably is, as one or more
hatched regions holding 90%, fed by every report kind, with plain-language warnings in the status
bar. It works offline and is identical on every device. With it off, nothing changes.

**Independent Test**: Load a hunt log with a known fox position and all four report kinds onto four
devices, two offline, with the estimate on. Every device draws the same region, the region contains
the fox, the weakness warning appears exactly when geometry is poor, and removing the
signal-strength and "heard nothing" reports changes the region (spec, Independent Test).

### Tests for User Story 1 ⚠️

> Write these first and confirm they fail before the matching implementation.

- [X] T012 [P] [US1] Create the seeded reference-hunt generator in `web/tests/reference/simulate.ts`: a mulberry32 PRNG; `bearingAt`, `omniAt`, `nullAt`, `fixAt` helpers that draw each report's error from the distribution its stated confidence claims (research R2, R9); `calibrationBatch(seed, count)` generating random hunts of 2–8 positive reports and 0–6 "heard nothing" reports around a fox; every hunt labelled `source: 'simulated'` with its `fox` position (data-model.md §6)
- [X] T013 [P] [US1] Create the FR-038 scenarios in `web/tests/reference/scenarios.ts`, each with `expect`: one bearing (`too_few`, fox inside); two crossing (fox inside, no `narrow_spread`); two nearly parallel (`narrow_spread`); three bearings from one spot (`narrow_spread`); two groups pointing at two places (two regions, `disagree`); only "heard nothing" (`status: 'none'`); only signal strength and "heard nothing" (status `estimate`, fox inside); two conflicting finds (two regions, `disagree`); one confidently wrong bearing among three correct (fox inside, `disagree`); a "heard nothing" at the fox among correct bearings (`disagree`); a 500-report hunt (fox inside)
- [X] T014 [P] [US1] Create `web/tests/reference/recorded/README.md` saying how to add a recorded hunt: export the hunt log, add the confirmed fox position and how it was confirmed, label it `recorded` (FR-039)
- [X] T015 [P] [US1] Unit tests in `web/tests/unit/estimate-kernels.test.ts` against `web/src/estimate/kernels.ts`: FR-004a (a bearing's kernel equals its floor beyond range × (1 + taper), and is highest along its heading); FR-004b (for a fixed distance, a stronger report never gives a lower value at small distances than a weaker one, and each omni kernel peaks at its bucket median); FR-004c (a null kernel is ≤ 1 everywhere and equal to 1 beyond the outer radius); FR-005 (a fix kernel is highest at its position and ≥ its floor everywhere); FR-040 (every kernel ≥ its floor everywhere); a Q=0 bearing uses the widest half-width
- [X] T016 [P] [US1] Unit tests in `web/tests/unit/estimate-warnings.test.ts` against `web/src/estimate/warnings.ts`: for each metric in data-model.md §3, a value just on each side of its threshold produces and withholds the matching `WarningKind`; `observer_span_deg: null` never produces `narrow_spread`; warnings come out in the stable order `too_few`, `narrow_spread`, `disagree`
- [X] T017 [P] [US1] Unit tests in `web/tests/unit/estimate-determinism.test.ts` using fast-check and `web/tests/unit/arbitraries.ts`: a shuffled `EstimateInput` gives a byte-identical `EstimateResult` apart from `generation`; retracting a report (fold with a retraction) gives the same result as a log that never had it (FR-007); region probabilities sum to ≥ 0.9; no `EstimateResult` contains per-report agreement (FR-026)
- [X] T018 [US1] Reference-hunt suite in `web/tests/unit/reference-hunts.test.ts`: run `estimate()` on a 1,000-hunt calibration batch (fixed seed) and assert fox coverage ≥ 0.90 (SC-001); print one line `coverage X on N simulated, M recorded — …` stating the source split (FR-039); run every scenario from T013 and assert its `expect` (SC-003, SC-004, SC-012); for each scenario with omni or null reports, assert that removing them changes the result digest (SC-006); load any files in `web/tests/reference/recorded/` into the same checks (depends on T012, T013)
- [X] T019 [P] [US1] E2E spec `web/tests/e2e/estimate.spec.ts` covering every row of the quickstart §4 table: default off (FR-029, SC-011); switch on in Settings; crossing bearings → one region; one bearing → `too_few` chip; two groups → two regions and `disagree`; nulls only → `none` chip; retraction recomputes on a second device; switch off clears at once and leaves a second device unchanged; offline reload keeps it on; first switch-on while offline after one online load draws a region; same reference hunts give the same digest in `chromium` and `mobile-safari` (SC-005); 500 reports under Chromium CPU throttling 4× update within 2 s (SC-002); `estimate_toggled` captured with only `enabled` (FR-041). Use `data-testid="estimate-region-count"`, `estimate-warning` and `estimate-toggle` from contracts/display-surfaces.md

### Implementation for User Story 1

**Engine** (pure; `web/src/estimate/`)

- [X] T020 [US1] Implement `web/src/estimate/kernels.ts`: `logKernel(report, x, y, values)` returning the natural log of the kernel for one report at one point in the local plane (km), for all four kinds as research R2 specifies, using `detmath` for exp/ln/sin/cos and the existing `wedgeHalfWidthDegrees`, `WIDEST_HALF_WIDTH_DEGREES` and `rangeMiles` from `web/src/log/confidence.ts`; plus `supportBox(report, values)` (the square the report's positive support fits in, `null` for nulls) and `isSupported(report, x, y, values)` (kernel > `SUPPORT_FLOOR_MULTIPLE` × floor). Pre-compute per-report constants (heading unit vector, κ, range in km) once per report, not per cell. Makes T015 pass
- [X] T021 [US1] Implement `web/src/estimate/grid.ts`: the local equirectangular projection centred on the midpoint of the positive observers' bounding box (own `cos` from `detmath`) and its inverse; `buildGrid(reports, box, values)` over a `GRID_CELLS_PER_SIDE`² square, giving each cell a log posterior only where some positive report supports it (−∞ elsewhere), summing kernels in `id` order and evaluating each report only inside its `supportBox` (adding its constant outside); `highestDensityCells(grid, level)` sorting cells by log posterior descending with ties broken by cell index, normalizing with `detmath.exp` relative to the maximum, and admitting cells until the running share reaches `level`; and the two-pass refine of research R4 (`REFINE_LEVEL`, `REFINE_PAD_FRACTION`) (depends on T020)
- [X] T022 [US1] Implement `web/src/estimate/regions.ts`: label the admitted cells into 8-connected components in scan order; for each component, contour the pass-2 probability grid masked to that component at the probability of the last admitted cell with `d3-contour`; map contour coordinates from grid space through the inverse projection to longitude/latitude rounded to 1e-6; return `Region[]` sorted by probability descending, then first cell index (research R7) (depends on T021)
- [X] T023 [US1] Implement `web/src/estimate/warnings.ts`: compute `EstimateMetrics` from the reports, the grid and the regions exactly as research R6 defines (`positive_reports`; `observer_span_deg` from the probability-weighted centre of the largest region using `detmath.atan2`, `null` when an observer is within `SPREAD_NEAR_KM`, forced below threshold when fewer than two observers lie more than `SAME_PLACE_KM` apart; `second_place_share`; `min_agreement` as the minimum over reports of (E[kernel] − floor)/(1 − floor)), and derive `WarningKind[]` from the thresholds. Makes T016 pass (depends on T021, T022)
- [X] T024 [US1] Implement `web/src/estimate/estimate.ts` exporting `estimate(input, values = ESTIMATE_VALUES): EstimateResult`: re-sort by `id`; return `status: 'none'` with no regions when no bearing, omni or fix is present (FR-015); otherwise run grid → regions → warnings; attach `level` and `values_digest` (SHA-256 of the canonical JSON of `values`, via `web/src/log/sha256.ts`). Makes T017 and T018 pass, and tune nothing in this task: if SC-001 or a scenario fails, stop and report the numbers before changing `values.ts` (depends on T022, T023)

**Worker and client**

- [X] T025 [US1] Create `web/src/estimate/worker.ts`: a module worker that receives `{type: 'estimate', input}`, calls `estimate()`, and posts `{type: 'result', result}` or `{type: 'error', generation, message}` (contracts/estimate-module.md §2) (depends on T024)
- [X] T026 [US1] Create `web/src/estimate/client.ts`: import the worker with `?worker&url` as `web/src/map/basemap.ts` does; `EstimateClient` with `request(active)` (builds input with `toEstimateInput`, keeps at most one request in flight and one pending, drops results older than the newest answered generation), an `onResult` callback, `dispose()` (terminates the worker), and a standalone `warmUp()` that fetches the worker URL once in the background and swallows errors (research R10) (depends on T025, T007)
- [X] T027 [US1] Create `web/src/estimate/copy.ts` holding every participant-facing string from contracts/display-surfaces.md §1–§4 (switch label and note, region label, the four chip texts, the tour's Settings line), and extend `web/tests/unit/vocabulary.test.ts` with the banned estimate word list from research R13 applied to `copy.ts`, `web/src/ui/tour/steps.ts` and the settings sheet strings (SC-007)

**Setting and app wiring**

- [X] T028 [US1] In `web/src/ui/settings.ts`: add `loadEstimateEnabled(db)` reading meta key `estimate_enabled` (absent ⇒ `false`); add `estimateEnabled` and `onEstimateEnabled` to `SettingsOptions`; add the toggle (`data-testid="estimate-toggle"`, `aria-pressed`) with its note directly after the relay switch, persisting with `setMeta` and calling `onEstimateEnabled(enabled)` on change, exactly as the relay switch does (FR-028 to FR-030; contracts/display-surfaces.md §1)
- [X] T029 [US1] In `web/src/main.ts`: call `warmUp()` once at startup regardless of the setting; load `estimate_enabled` beside `relay_mode`; while enabled, own one `EstimateClient` and call `request(fold.active)` wherever the fold is recomputed (report arrival, submission, retraction, merge); on switch-off, `dispose()` it and pass an empty estimate to the map view; pass `estimateEnabled`/`onEstimateEnabled` into `openSettings`, with `onEstimateEnabled` calling `track('estimate_toggled', { enabled })` beside the existing `track('relay_mode_toggled', { enabled })` (FR-041); send estimate errors to `captureError` and keep the previous region (FR-019, FR-020, FR-031) (depends on T026, T028)

**Map and status bar**

- [X] T030 [P] [US1] Add an `--estimate` colour token for light and dark themes in `web/src/ui/tokens.css` (and its generator input under `web/scripts/generate-tokens.mjs` if tokens are generated), chosen outside the twelve observer swatches in `web/src/log/colour.ts`; extend `web/tests/unit/contrast.test.ts` to check it against the map surface in both themes (FR-024)
- [X] T031 [US1] In `web/src/ui/map-view.ts`: add an `estimate` GeoJSON source and the four layers from contracts/display-surfaces.md §2 (`estimate-fill` with a runtime-generated diagonal hatch added via `map.addImage` from an `ImageData`, `estimate-halo`, `estimate-line`, `estimate-label` with `symbol-placement: line` and the region label from `copy.ts`), inserted below the wedge layers and re-added after a style swap as the other sources are; add an `estimate` field to `MapViewState` (`EstimateResult | undefined`) and set the source from it in `update()` (FR-001, FR-002, FR-023, FR-024) (depends on T027, T030)
- [X] T032 [US1] In `web/src/ui/map-view.ts` `#updateStatus`: while `state.estimate` is defined, prepend one chip per warning (`warn` family) or the `none` chip (`dim` family) with `data-testid="estimate-warning"` and `data-kind`, using `copy.ts` text, and set `data-testid="estimate-region-count"` on the status bar to the region count (0 when off). No chip is dismissible (FR-010 to FR-016, FR-032; contracts/display-surfaces.md §3) (depends on T031)

**Tour**

- [X] T033 [US1] In `web/src/ui/tour/steps.ts` and `web/src/ui/tour/tour.ts`: make the `estimate` step state-dependent as contracts/display-surfaces.md §4 specifies (sample plus the Settings line while off; sample without it while on with status `none`; no sample while a region exists), keeping `anchor: 'map'` so `web/tests/unit/tour-manifest.test.ts` stays green; update `web/tests/e2e/tour.spec.ts` for the off-by-default copy (depends on T027)

**Analytics**

- [X] T034 [US1] In `web/tests/e2e/estimate.spec.ts`, stub the analytics client as the existing e2e suite does and assert that switching the estimate on and off captures `estimate_toggled` twice, each with exactly the property set `{enabled}` and no position, hunt code or report content (FR-041). `web/tests/unit/analytics.test.ts` covers only URL redaction and needs no change

### Field Validation for User Story 1 (deferred milestone)

- [ ] T035 [US1] When a real hunt with real participants is available: switch the estimate on for participants who did not build the tool; afterwards ask whether the region helped them choose where to go and whether they trusted it more or less than it deserved (SC-008); ask a handheld-only participant to point to a change their report caused (SC-009); record verbatim any case where the fox was outside the region while no warning showed; export the log and add it to `web/tests/reference/recorded/` with how the fox position was confirmed (FR-039)

**Checkpoint**: User Story 1 closes on T015–T019 passing and the Independent Test. T035 stays open
as tracked milestone work until a hunt happens.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [X] T036 [P] Write `docs/estimate.md`: the model in plain words (the four kernels, the floor and why, the support mask, the 90% region, the four warnings, simulated and recorded reference hunts, and why the arithmetic is owned), linking `web/src/estimate/values.ts` for every number and holding none of them itself (FR-035; contracts/display-surfaces.md §6)
- [X] T037 [P] In `docs/log-format.md`, replace "No location is estimated or computed." with a sentence saying the map can draw a derived estimate, that it is computed on each device from the log and never stored in it, and linking `estimate.md`; add `estimate.md` to `docs/README.md`
- [X] T038 [P] Add the `estimate_toggled` row (`enabled`; "The estimate was switched on or off on this device.") to the table in `docs/analytics.md`
- [X] T039 Run the quickstart end to end (`specs/006-location-estimate/quickstart.md` §1, §2, §4, §5) and record the coverage line from §2 and the SC-002 timing in the PR description; update the spec's Status line only after this passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T002 ∥ T003.
- **Foundational (Phase 2)**: after Setup. **Blocks US1.** T004 ∥ T005 ∥ T006; T007 after T006;
  T008–T011 in parallel once their subjects exist.
- **US1 (Phase 3)**: after Phase 2. Tests T012–T017 and T019 in parallel; T018 after T012 and T013.
  Engine is sequential: T020 → T021 → T022 → T023 → T024. Then T025 → T026. T027, T030 and T034 can
  run any time in the phase (T034 edits the file T019 creates). T028 → T029. T031 → T032. T033 after T027.
- **Polish (Phase 4)**: T036–T038 any time after T024; T039 last.

### Within User Story 1

- Tests are written first and fail before their implementation (T015 before T020, T016 before T023,
  T017/T018 before T024, T019 before T028–T033).
- Engine before worker, worker before wiring, wiring before surfaces.
- No task changes `values.ts` to make a test pass without reporting the before and after numbers
  (FR-037).

### Parallel Opportunities

- Phase 1: T002 ∥ T003
- Phase 2: T004 ∥ T005 ∥ T006, then T008 ∥ T009 ∥ T010 ∥ T011
- Phase 3 tests: T012 ∥ T013 ∥ T014 ∥ T015 ∥ T016 ∥ T017 ∥ T019
- Phase 3 implementation: T027 ∥ T030 alongside the engine chain; T034 with T019
- Phase 4: T036 ∥ T037 ∥ T038

---

## Parallel Example: User Story 1

```bash
# Write the failing tests together:
Task: "Kernel tests in web/tests/unit/estimate-kernels.test.ts"
Task: "Warning tests in web/tests/unit/estimate-warnings.test.ts"
Task: "Determinism tests in web/tests/unit/estimate-determinism.test.ts"
Task: "Reference-hunt generator in web/tests/reference/simulate.ts"
Task: "FR-038 scenarios in web/tests/reference/scenarios.ts"

# While the engine chain (T020 → T024) runs:
Task: "Participant copy and vocabulary test in web/src/estimate/copy.ts"
Task: "--estimate token and contrast test in web/src/ui/tokens.css"
Task: "Analytics assertion for estimate_toggled in web/tests/e2e/estimate.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

The whole spec is one story, so the MVP is the feature:

1. Phase 1 → Phase 2 (green checkpoint, no visible change).
2. Engine (T020–T024) with the reference hunts passing. This is the point to review coverage and
   region sizes before any UI exists.
3. Worker and wiring (T025–T029). The setting works, and the map shows nothing new until T031.
4. Surfaces (T030–T034). Every change is behind the off-by-default switch.
5. Polish (T036–T039), then ship. Field validation (T035) waits for a hunt.

### Incremental Delivery

Because the switch defaults to off, each checkpoint after step 3 can merge on its own without
changing what any participant sees until they switch it on.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- The prototype numbers in research R3 and R10 are simulated evidence only. T018's coverage line is
  the number that counts.
- Commit after each task or logical group, and merge (never rebase) once the branch is pushed
- Avoid: vague tasks, same-file conflicts, and changing `values.ts` silently

---

## Phase 5: Convergence

- [X] T040 CRITICAL: Once the relay stores report numbers bit-exact (the separate relay fix: `serde_json` without `float_roundtrip` turned `-122.57812663477081` into `-122.5781266347708`), add an e2e check in `web/tests/e2e/estimate.spec.ts` that the device that authored a report and a device that received it through the relay draw byte-identical regions, using a report with a 17-significant-digit coordinate per Constitution IV, FR-018 (contradicts)
- [X] T041 Make a bearing's kernel reach its floor at the stated range, not at range × (1 + `BEARING_RANGE_TAPER`): move the taper inside the range in `web/src/estimate/kernels.ts` and `values.ts` (a one-bearing R3 region currently reaches 13.88 km against a 12.87 km range), then rerun the reference hunts and report the coverage before and after per FR-004a, FR-037 (contradicts)
- [X] T042 Keep the single-bearing region inside its wedge near the apex (it spills to 18.8° against a 16° half-width, where second-pass cells are wide relative to the distance from the observer), and assert in `web/tests/unit/reference-hunts.test.ts` that the one-bearing region lies within the wedge and spans its full length per US1/AC2 (partial)
- [X] T043 Extend the cross-engine comparison in `web/tests/e2e/estimate.spec.ts` from 7 to every scenario in `web/tests/reference/scenarios.ts` except `five-hundred` per SC-005 (partial)
- [ ] T044 On a real iPhone and a real Android phone in airplane mode, run quickstart §5 by hand and check that a reload with the estimate on still draws a region, and that a first switch-on after one online visit draws one; Playwright's WebKit offline emulation cannot start a worker, so neither is proven on iOS per Constitution III, T019 (partial)
- [X] T045 Add a reference scenario asserting that a strong signal report from one end of an elongated region shifts the region toward that reporter per US1/AC4 (missing)
- [X] T046 Assert in the `two-nearly-parallel` scenario that the region extends along the bearings toward their stated range, not a small region at a distant crossing per US1/AC5, FR-011 (missing)
- [X] T047 Add a reference scenario asserting that a "heard nothing" filed inside a region moves probability away from the reporter's position (less of the region's probability within the cleared radius) per US1/AC3 (missing)
- [X] T048 Reconcile the region-count hook: the status bar already carries `data-testid="status-bar"`, so the count is published as `data-estimate-region-count`; update `contracts/display-surfaces.md` §2 to match, or publish the count on a child element with its own test id per T032, T019 (contradicts)
- [X] T049 Review the `window.__foxmapperTrack` e2e seam in `web/src/analytics/posthog.ts`: keep it and document it in `docs/analytics.md`, or replace it with a test-only mechanism per T034 (unrequested)
- [X] T050 Register the `radio_button_unchecked` glyph (estimate switch and "nothing yet" chip) and the estimate warning chips' use of `warning` in `specs/002-material3-ui-redesign/contracts/iconography.md`, or reuse an existing glyph per T028, T032 (unrequested)
