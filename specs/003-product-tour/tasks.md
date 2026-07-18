---

description: "Task list for First-Visit Product Tour"
---

# Tasks: First-Visit Product Tour

**Input**: Design documents from `/specs/003-product-tour/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The spec makes tests part of the deliverable — US3 *is* a drift test, and SC-004
(offline) and SC-008 (drift detection) are verified by automated tests.

**Organization**: Grouped by user story. US1 is the MVP. US3 (the drift safeguard) touches only tests,
a hook, and docs — it is independent of the US1/US2 overlay code and can be built in parallel once the
foundation exists.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3

## Path Conventions

Single web client under `web/`. Source in `web/src/`, tests in `web/tests/`. Repo-root paths for
`.claude/settings.json` and `docs/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the tour module skeleton so later tasks edit existing files.

- [ ] T001 Scaffold `web/src/ui/tour/` with stub files `tour.ts`, `steps.ts`, `manifest.ts`, `state.ts`, `sample.ts`, each exporting typed placeholders per [data-model.md](data-model.md)
- [ ] T002 [P] Create `web/src/ui/tour.css` and import it from `web/src/ui/app.css`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Anchors and declarations that every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Add `data-testid="map"` to the MapLibre container element in `web/src/ui/map-view.ts` (the estimate-step anchor)
- [ ] T004 [P] Add a "Take the tour" relaunch button with `data-testid="replay-tour"` to the settings sheet in `web/src/ui/settings.ts`, exposed via an `onReplayTour` callback (wired in `main.ts` later)
- [ ] T005 Define `Tour`/`TourStep` types and the ordered step skeleton (7 steps: `target`, `estimate`, `report-bar`, `bearing`, `omni`, `null`, `finish`) with their `anchor` testids in `web/src/ui/tour/steps.ts` (copy filled in US1; `share` inserted in US2)
- [ ] T006 Define `anchors[]` (from the step anchors) and `coveredKinds` (derived from `KIND_BUTTONS` in `web/src/ui/report-entry.ts`: `bearing`, `omni`, `null`) in `web/src/ui/tour/manifest.ts`

**Checkpoint**: Anchors resolve and declarations exist — US1, US2, and US3 can now proceed (US3 in parallel with US1/US2).

---

## Phase 3: User Story 1 - A first-timer is walked through the hunt loop (Priority: P1) 🎯 MVP

**Goal**: An optional, skippable overlay offered on first hunt view walks the ordered core loop
(target → estimate → report bar → bearing → omni → null → finish), works offline and by keyboard, and
lands the participant on a live hunt view. Relaunchable from settings.

**Independent Test**: On a fresh device, open a hunt → the tour is offered → accept → step through in
order, each spotlighting its control → the three report kinds and the credible-region estimate are
shown → finish lands on a usable hunt view; declining leaves the app usable with no extra steps.

### Tests for User Story 1 ⚠️ (write first, ensure they fail)

- [ ] T007 [P] [US1] Unit test for tour-state transitions (unseen→completed / unseen→declined; relaunch leaves status intact; missing record reads as unseen) over `fake-indexeddb` in `web/tests/unit/tour-state.test.ts`
- [ ] T008 [P] [US1] E2e spec in `web/tests/e2e/tour.spec.ts` covering: offer on first hunt view → accept → ordered spotlights → progress "N of M" → finish → no re-offer; decline and mid-tour exit leave joining/reporting with zero extra steps (SC-005); keyboard (→/Enter/←/Esc), scrim-click exit, focus trapped in callout, and reduced-motion instant (FR-020); and full start→finish with `context.setOffline(true)` making no network request (FR-012, SC-004)

### Implementation for User Story 1

- [ ] T009 [US1] Implement `web/src/ui/tour/state.ts`: `readTourState`/`markCompleted`/`markDeclined` over the `meta` store (`getMeta`/`setMeta`) plus the `TOUR_VERSION` constant, per [contracts/tour-state.md](contracts/tour-state.md)
- [ ] T010 [P] [US1] Implement `web/src/ui/tour/sample.ts`: a fixed illustrative credible-region sample for the estimate step that renders a *region* (not a point), visibly marked as an example, never written to the log (FR-014, Principle I)
- [ ] T011 [US1] Implement the overlay engine in `web/src/ui/tour/tour.ts`: scrim + spotlight cutout (measure anchor rect, re-measure on resize/scroll, centered fallback if anchor absent), callout with title/body/`tour-progress`/`tour-next`/`tour-back`/`tour-exit`, keyboard handling, focus trap, `aria-live` announcements, `role="dialog"`/`aria-modal`, and reduced-motion behavior, per [contracts/tour-overlay.md](contracts/tour-overlay.md) (depends on T005, T009, T010)
- [ ] T012 [US1] Fill plain-language copy for the 7 non-share steps in `web/src/ui/tour/steps.ts` — hunter vocabulary only; the `omni` step carries the explicit stock-handheld message (FR-008); the `estimate` step describes the estimate as a region that grows less certain, never a point (FR-009) and sets `sample: true`
- [ ] T013 [P] [US1] Style the overlay in `web/src/ui/tour.css`: scrim, spotlight cutout, callout positioning, phone-viewport rules that keep the anchor visible (FR-006), and a `prefers-reduced-motion` block
- [ ] T014 [US1] Wire the tour into `web/src/main.ts`: render the `tour-offer` on first hunt view when `status === 'unseen'` (accept → run, decline → `markDeclined`); run on `onReplayTour` from settings; on finish → `markCompleted` and leave a live hunt view (FR-015); mount offer/overlay into `#app` (depends on T003, T004, T009, T011, T012)

### Field Validation for User Story 1 (deferred milestone — does not gate US2)

- [ ] T015 [US1] When a real hunt with real participants is available, hand a first-timer a phone, have them take the tour once, and record whether they file a correct report unaided and what confused them

**Checkpoint**: US1 closes on T007–T014; T015 stays open as tracked milestone work.

---

## Phase 4: User Story 2 - A completer knows how to bring a team into the hunt (Priority: P2)

**Goal**: Add a share/invite step to the tour that points at the share affordance and frames the
"no account, no install, no payment" pitch, so a completer knows how to recruit a team.

**Independent Test**: Run the tour to the team step → it spotlights the share affordance, explains how
a teammate joins, and states joining needs no account or install.

### Tests for User Story 2 ⚠️

- [ ] T016 [US2] Extend `web/tests/e2e/tour.spec.ts` to assert the `share` step appears before `finish`, spotlights `share-hunt`, and its copy states no account/install/payment (FR-010)

### Implementation for User Story 2

- [ ] T017 [US2] Insert the `share` step (anchor `share-hunt`) immediately before `finish` in `web/src/ui/tour/steps.ts` and add `share-hunt` to `anchors[]` in `web/src/ui/tour/manifest.ts`
- [ ] T018 [US2] Write the share-step copy in `web/src/ui/tour/steps.ts`: how a teammate joins the same hunt and that joining needs no account, install, or payment (plain language, FR-010/FR-011)

### Field Validation for User Story 2 (deferred milestone — does not gate US3)

- [ ] T019 [US2] When a real hunt is available, have a tour-completer share the hunt link and record whether teammates join and report without being walked through anything

**Checkpoint**: US2 closes on T016–T018; T019 stays open as tracked milestone work.

---

## Phase 5: User Story 3 - The tour cannot silently rot (Priority: P2)

**Goal**: A drift safeguard — a deterministic test (authoritative), a Claude Code hook that surfaces
it in-session, and a scope doc — so a change that invalidates the tour is flagged before it is done.

**Independent Test**: Rename a tour anchor or add a report kind the tour omits → the drift test fails
and names the problem; make an unrelated edit → it stays green.

**Note**: This story is independent of the US1/US2 overlay code (it touches only tests, `.claude/`, and
`docs/`), so it may be built in parallel with US1/US2 once Phase 2 is done. T021 and T024 need the step
copy from US1/US2 to exist.

### Tests / Implementation for User Story 3

- [ ] T020 [US3] Implement the drift test in `web/tests/unit/tour-manifest.test.ts`: assert every string in `manifest.anchors` occurs as a `data-testid` in `web/src`; assert `manifest.coveredKinds` equals the `KIND_BUTTONS` kinds in `web/src/ui/report-entry.ts`; assert every non-`finish` step's `anchor` is present in `manifest.anchors` — per [contracts/tour-drift-check.md](contracts/tour-drift-check.md) (depends on T005, T006)
- [ ] T021 [P] [US3] Extend `web/tests/unit/vocabulary.test.ts` to scan the tour step copy in `web/src/ui/tour/steps.ts` for banned protocol vocabulary (NRQ/DFS/PHG) (FR-011) (depends on step copy: T012, T018)
- [ ] T022 [US3] Add a `PostToolUse` hook to `.claude/settings.json` that runs the drift test after Edit/Write to watched paths (`web/src/ui/report-entry.ts`, `share.ts`, `join.ts`, `target.ts`, `map-view.ts`, `settings.ts`, `web/src/ui/tour/**`) and prints the result and the required action on failure (FR-017, FR-018)
- [ ] T023 [P] [US3] Write `docs/product-tour.md` defining what counts as a "significant change that may invalidate the tour" (anchors, first-class report kinds, primary hunt-loop controls, the ordered walkthrough) (FR-019)
- [ ] T024 [US3] Verify SC-008: temporarily rename a watched anchor and separately add a `ReportKind` → confirm `tour-manifest` fails naming each; make an unrelated edit → confirm it stays green; revert all temporary changes (depends on T020)

**Field Validation for User Story 3**: N/A — a maintainer-facing safeguard, validated by its own test
suite (T020, T024). Its payoff shows up in US1/US2 field validation staying true across releases.

**Checkpoint**: US3 closes on T020–T024.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T025 [P] Run `npm run typecheck`, `npm run lint`, and `npm run format` and resolve anything the new files introduce
- [ ] T026 Run the full [quickstart.md](quickstart.md) validation: `test:unit`, `test:e2e -- tour`, `tour-manifest`, and the three SC-008 drift cases
- [ ] T027 [P] Add a pointer to the tour and its relaunch location (settings) in the `web/` README/docs

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **US1 (Phase 3)**: after Foundational.
- **US2 (Phase 4)**: after US1 closes (extends the same tour/overlay).
- **US3 (Phase 5)**: after Foundational; independent of the US1/US2 overlay and may run in parallel
  with them, except T021/T024 which need step copy to exist.
- **Polish (Phase 6)**: after the desired stories are complete.

### Within Each Story

- Tests written first and failing before implementation.
- US1: `state.ts`/`sample.ts` → overlay engine `tour.ts` → step copy → `main.ts` wiring.
- US2: insert step + manifest anchor → copy.
- US3: drift test + hook + doc → verify.

### Parallel Opportunities

- T007 (unit) and T008 (e2e) are different files — run in parallel.
- T010 (`sample.ts`) and T013 (`tour.css`) are [P] against the engine work.
- US3's T020/T022/T023 can proceed alongside US1/US2 once Phase 2 lands (different files).
- Polish T025 and T027 are [P].

---

## Parallel Example: User Story 1

```bash
# Tests together (different files):
Task: "Unit test tour-state transitions in web/tests/unit/tour-state.test.ts"
Task: "E2e tour spec in web/tests/e2e/tour.spec.ts"

# Independent implementation pieces together:
Task: "Implement sample.ts credible-region sample in web/src/ui/tour/sample.ts"
Task: "Style the overlay in web/src/ui/tour.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1.
2. **STOP and VALIDATE**: the tour is offered, runs the core loop offline and by keyboard, and lands
   on a live hunt view; declining costs nothing. Field-validate when a hunt is available.
3. Ship the MVP.

### Incremental Delivery

1. Foundation → US1 (MVP: the walkthrough).
2. US2 → adds the team-invite step.
3. US3 → locks the tour against silent rot (buildable in parallel with US1/US2).
4. Polish.

### Notes

- [P] = different files, no incomplete-task dependencies.
- Commit after each task or logical group; keep testids stable (they are the tour's anchors and the
  drift test's contract).
- A story closes on its tests and independent test; field-validation tasks stay open as tracked
  milestones until a real hunt happens.
