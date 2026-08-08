# Tasks: True North Bearings Without Declination Math

**Input**: Design documents from `/specs/005-true-north-bearings/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/reference-entry.md, contracts/display-surfaces.md, quickstart.md

**Tests**: Included — the spec's success criteria and quickstart define explicit unit and e2e
coverage, and the project's convention (001–004) is tests with every story.

**Organization**: Tasks are grouped by user story. Phase 2 (Foundational) is deliberately
behavior-preserving: after it, the app builds and behaves exactly as today, with the new draft
shape plumbed through — so US1 is a pure display/interaction change.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Single web project under `web/` — sources in `web/src/`, unit tests in `web/tests/unit/`, e2e in
`web/tests/e2e/` (plan.md, Project Structure).

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline so every later diff is attributable to this feature

- [X] T001 Baseline: kill any stale preview server on :4173, then run `npm run typecheck && npm run lint && npm run test:unit && npm run test:e2e` in `web/` and confirm green before any edit

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The conversion helpers and the new draft shape, plumbed through with today's
behavior unchanged. Blocks all three stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add `NorthReference` type, `toMagneticHeading` (inverse of `toTrueHeading`, kept beside it), and `describeDeclination` (east/west/near-zero/stale plain-language strings per contracts/display-surfaces.md §3) in `web/src/sensors/declination.ts`
- [X] T003 [P] Rework `composeBearing` in `web/src/report/bearing.ts`: `BearingDraft` becomes `{ heading, reference }`, `BearingEntry` gains the sheet's `Declination`, entered value stored verbatim in its own field with the counterpart derived (data-model.md §3, research R3); update the file's header comments to the two-reference model
- [X] T004 Unit tests for T002 in `web/tests/unit/declination.test.ts`: `toMagneticHeading`/`toTrueHeading` round-trip law within epsilon; `describeDeclination` east (+15°), west (−10°), near-zero (|d|<0.5°), and stale-model strings
- [X] T005 Unit tests for T003 in `web/tests/unit/report.test.ts`: compose from `reference:'true'` stores `heading_true` verbatim and derives magnetic; from `'magnetic'` the reverse; invariant `heading_true = normalize(heading_magnetic + declination)` holds on both paths; existing fixtures updated to the new draft shape
- [X] T006 Behavior-preserving caller update in `web/src/ui/report-entry.ts`: compute `declinationAt(origin position)` once at bearing-sheet open, pass it into `composeBearing`, and submit the dial's value as `{ heading, reference: 'magnetic' }` — display untouched, app behaves exactly as before (green checkpoint)

**Checkpoint**: Build green, all tests green, zero user-visible change

---

## Phase 3: User Story 1 - The Number You See Is the Direction You Get (Priority: P1) 🎯 MVP

**Goal**: Every heading shown during entry is true north, labeled, and identical to the direction
the wedge renders. The device compass is normalized silently; the screenshot's "0° that isn't
north" becomes unrepresentable.

**Independent Test**: With a mocked compass reading magnetic 344.5° at a position where
declination is +15.5°E, drafting and freezing shows `0.0 ° true`, and the submitted wedge
centerline points at map north (spec Story 1; quickstart flow 1).

### Implementation for User Story 1

- [X] T007 [US1] Add reference state to the dial in `web/src/ui/compass-dial.ts`: `DialOptions` gains required `declination` and `defaultReference`; new `activeReference` state; `committedHeading()` returns `CommittedHeading { heading, reference } | undefined` (data-model.md §5)
- [X] T008 [US1] Convert sensor samples at the dial boundary in `web/src/ui/compass-dial.ts`: live samples pass `toTrueHeading(sample, declination)` into the smoother; going live forces `activeReference = 'true'`; twist follows the active reference; typing follows the active reference when a value is committed and switches to magnetic first when nothing is committed (empty-state rule, contracts/reference-entry.md §2–3); update the file's header comment to record the 004 magnetic-only display supersession (research R7)
- [X] T009 [US1] Build the reference chip/switch in `web/src/ui/compass-dial.ts`: unit label on the field (`° true` / `° magnetic`), switch face showing the converted number it would switch to (`= 235.5° true`), empty-field behavior, tap converts displayed+committed values via the sheet's declination; accessible names per contracts/reference-entry.md §4 and §7
- [X] T010 [P] [US1] Style the chip/switch in `web/src/ui/app.css` (and tokens if needed): adjacent to the numeric field, 56 px touch target, active-reference unit visually part of the field
- [X] T011 [US1] Wire the own bearing sheet in `web/src/ui/report-entry.ts`: pass `declination` and `defaultReference` (`'auto'` dial → `'true'`); send path forwards the dial's `CommittedHeading` into the draft unchanged (replaces T006's fixed-magnetic stopgap)
- [X] T012 [P] [US1] New unit test `web/tests/unit/reference.test.ts`: the full transition table from contracts/reference-entry.md §3 (live forces true; freeze commits true; twist follows active reference; empty-state typing switches to magnetic while committed-value edits keep the reference; chip converts number, preserves direction; defaults per surface §2; switch-preview values)
- [X] T013 [P] [US1] Update `web/tests/unit/compass-dial.test.ts`: converted samples reach the smoother; committed shape is `CommittedHeading`; existing angle/damping tests adjusted to the new options; single-conversion invariant pinned — the displayed value differs from the raw magnetic sample by exactly the declination, never 2× (spec Story 1 scenario 4's no-double-correction, otherwise satisfied by contract per research R6)
- [X] T014 [US1] Update e2e `web/tests/e2e/compass-dial.spec.ts`: mocked-sensor drafting asserts the field shows the converted true value with the `true` label; freeze/twist/retake flows still pass
- [X] T015 [US1] New e2e `web/tests/e2e/true-north.spec.ts` (flow 1 + 6 of quickstart.md): mocked sensor magnetic 344.5° at fixed Bellingham position → field `0.0 ° true`; send; wedge centerline `heading_true === 0 ± 0.1`; chip round-trip (true→magnetic→true) restores the exact number

### Field Validation for User Story 1 (deferred milestone — does not gate User Story 2)

- [ ] T016 [US1] When a real hunt is available: point the phone down a road visible on the map, send, and confirm the wedge lies along it; record whether anyone still asks why a bearing looks rotated

**Checkpoint**: US1 closes on T007–T015 green; the app now displays true everywhere in the
compass path

---

## Phase 4: User Story 2 - Net Control Enters a Relayed Magnetic Bearing (Priority: P2)

**Goal**: A dictated magnetic-compass bearing is enterable exactly, with zero arithmetic: the
relay sheet opens in magnetic, the switch previews the true equivalent, and conversion uses the
declination at the hunter's position.

**Independent Test**: Arm a relay target at a hand-set position, type `220` with the default
magnetic reference, and verify the stored `heading_magnetic` is exactly 220 with `heading_true`
offset by exactly the local declination (spec Story 2; quickstart flow 2).

### Implementation for User Story 2

- [X] T017 [US2] Wire the relay path in `web/src/ui/report-entry.ts` (and `web/src/ui/main.ts`/`relay-entry.ts` touch points as needed): `by-hand` dial mode opens with `defaultReference: 'magnetic'`, and the sheet's declination is computed from the report's origin position — the armed target's position, not the operator's (FR-006, research R2)
- [X] T018 [US2] Update e2e `web/tests/e2e/relay.spec.ts`: relay bearing entry shows `° magnetic` by default; switch face shows the converted true number before any tap; armed-target flow still passes end-to-end
- [X] T019 [US2] Extend e2e `web/tests/e2e/true-north.spec.ts` (flow 2 + 3 of quickstart.md): type `220` magnetic at a known-declination target → switch reads `= 235.5° true`; send; payload `heading_magnetic === 220` exactly, `heading_true === 235.5 ± 0.1`, wedge matches; assert zero required reference decisions in the compass path and at most one optional tap here; wrong-reference recovery reachable via the existing retract button on the report's popup

### Field Validation for User Story 2 (deferred milestone — does not gate User Story 3)

- [ ] T020 [US2] When a real hunt is available: net control logs a bearing dictated from a baseplate compass; confirm the wedge agrees with the hunter's own device-drafted bearings from the same spot

**Checkpoint**: US2 closes on T017–T019 green; both entry paths honor the reference contract

---

## Phase 5: User Story 3 - See the Difference When You Want To (Priority: P3)

**Goal**: The on-demand detail: local declination in plain words in Settings, and both
representations of any bearing in its popup — in nobody's way otherwise.

**Independent Test**: From the hunt screen, reach the declination line in Settings within two
taps and verify it matches the published value; open a bearing popup and see both labeled values
(spec Story 3; quickstart flow 4).

### Implementation for User Story 3

- [X] T021 [P] [US3] Popup heading line in `web/src/ui/map-view.ts` (plus `web/src/map/layers.ts` if the payload headings are not yet in feature properties): `Bearing 235° true (220° on a magnetic compass)` from stored values only, whole degrees, positioned after the time line (contracts/display-surfaces.md §2)
- [X] T022 [P] [US3] Settings declination section in `web/src/ui/settings.ts` (wiring current-or-placed position from `web/src/main.ts`): `describeDeclination` copy, model vintage sentence, stale sentence (FR-009), and the no-position fallback line (contracts/display-surfaces.md §3) — computed at sheet-open, offline
- [X] T023 [P] [US3] Unit tests in `web/tests/unit/declination.test.ts` (or alongside existing string tests): popup line formatting incl. 359.6→0 rounding fold; settings copy for east/west/aligned/stale/no-position cases
- [X] T024 [US3] Extend e2e `web/tests/e2e/true-north.spec.ts` (flow 4 of quickstart.md): bearing popup shows both labeled values; Settings shows the declination line with east/west wording and vintage; with a mocked out-of-window date the out-of-date sentence appears

### Field Validation for User Story 3 (deferred milestone)

- [ ] T025 [US3] When a real hunt is available: have an experienced ham cross-check the Settings line against their compass's set declination or a topo map margin; record whether the wedges earn their trust

**Checkpoint**: All three stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T026 [P] Extend the deny-list in `web/tests/unit/vocabulary.test.ts`: "declination" on any participant surface outside the Settings detail copy, "WMM", raw epoch identifiers, "geomagnetic" (contracts/display-surfaces.md §4)
- [X] T027 [P] Add the clarifying sentence to `docs/log-format.md`: either heading field may be the verbatim-entered one; the invariant and shape are unchanged (data-model.md §1)
- [X] T028 Offline coverage (FR-007): run the US1 and US2 e2e flows with the network stubbed offline — extend `web/tests/e2e/true-north.spec.ts` or `web/tests/e2e/offline.spec.ts`, whichever harness fits
- [X] T029 Sweep for stale claims: any remaining comment or copy asserting magnetic-only display or "the conversion stays invisible" (e.g. `web/src/ui/compass-dial.ts`, `web/src/report/bearing.ts`, `web/src/sensors/declination.ts` headers) updated to reference the 005 model; status copy keeps its verbs
- [X] T030 Run the full quickstart.md validation (`web/`: typecheck, lint, unit, e2e — stale :4173 killed first) and confirm every success criterion's mapped flow passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: after Setup — **blocks all stories**. Within it: T002 ∥ T003; T004
  after T002; T005 after T003; T006 after T003.
- **US1 (Phase 3)**: after Phase 2. T007 → T008 → T009 (same file, sequential); T010 ∥ anytime;
  T011 after T009; T012/T013 after T009 (∥ with each other); T014/T015 after T011.
- **US2 (Phase 4)**: after US1 closes (the chip built in T009 is US2's control). T017 → T018/T019.
- **US3 (Phase 5)**: after Phase 2 only — T021/T022/T023 touch none of US1/US2's files and MAY run
  concurrently with US1/US2 by a second pair of hands; T024 needs US1's spec file (T015) to exist.
- **Polish (Phase 6)**: after desired stories; T026/T027 anytime after Phase 2.

### Parallel Opportunities

- Phase 2: T002 ∥ T003 (different files), then T004 ∥ T005 ∥ T006
- US1: T010 ∥ implementation; T012 ∥ T013
- US3: T021 ∥ T022 ∥ T023 (three different files) — and US3 as a whole ∥ US1/US2 for a second
  developer
- Polish: T026 ∥ T027

### Parallel Example: User Story 1

```bash
# After T009 lands, launch together:
Task: "Style the chip/switch in web/src/ui/app.css"                      # T010
Task: "New unit test web/tests/unit/reference.test.ts"                   # T012
Task: "Update web/tests/unit/compass-dial.test.ts"                       # T013
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 → Phase 2 (behavior-preserving checkpoint: ship-safe at any moment)
2. Phase 3 (US1) → the reported confusion is fixed: display is true, labeled, and wedge-exact
3. **STOP and VALIDATE**: quickstart flows 1 + 6; deploy/demo — this alone answers the feedback

### Incremental Delivery

1. US1 (MVP) → US2 (relay magnetic entry — the chip gets its second, highest-stakes user) →
   US3 (detail surfaces) → Polish
2. Each story leaves the app releasable; field-validation tasks (T016/T020/T025) stay open as
   tracked milestone work until a real hunt happens, and gate nothing

---

## Notes

- The log format never changes; any task that seems to need a payload edit is off-plan
  (data-model.md §1)
- Wedge geometry, confidence, and range copy are out of contract — a diff touching them is a bug
  (contracts/display-surfaces.md §5)
- Commit after each task or logical group; e2e runs need the stale-:4173 and service-worker
  cautions from quickstart.md
