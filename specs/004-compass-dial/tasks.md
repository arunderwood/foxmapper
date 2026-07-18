# Tasks: Visual Compass Dial for Bearing Entry

**Input**: Design documents from `/specs/004-compass-dial/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/bearing-entry.md,
contracts/log-format-delta.md, quickstart.md

**Tests**: Included — the spec's success criteria are mostly mechanical (SC-002 frozen stability,
SC-004 twist, SC-005 zero-keystroke, SC-006/008 payload shape, SC-007 unset, SC-009 offline,
SC-010 accessible path), and the repo is test-driven, so the audits and story specs are first-class
tasks alongside the implementation.

**Organization**: Tasks are grouped by user story. A field-removal + shared-dial foundation blocks
all stories; after that each story is an independently testable increment (P1 → P2 → P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

**Field validation (constitution, Development Workflow)**: each story phase carries a field
validation task — a deferred milestone, not a gate. A story closes on its tests and its independent
test; the next story may begin without an intervening hunt.

## Path Conventions

Web SPA under `web/` per plan.md: source in `web/src/`, tests in `web/tests/`. The living log-format
doc is `docs/log-format.md` at the repo root.

---

## Phase 1: Setup (shared dial shell)

**Purpose**: The component every story extends, with its public shape settled up front.

- [X] T001 Scaffold the dial component in web/src/ui/compass-dial.ts: exported factory returning `{ node, committedHeading(): number | undefined, onChange(cb), destroy() }` and the `idle | live | frozen | by-hand` state per contracts/bearing-entry.md — structure and API only, no behavior yet. Confirm no new runtime dependency is introduced (inline SVG + Pointer Events + CSS only)

---

## Phase 2: Foundational (a bearing is a bearing — blocks all stories)

**Purpose**: Drop the write-only provenance fields so every story submits through the trimmed
composer, and land the pure dial helpers both US1 and US2 build on.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T002 Remove `heading_source` and `compass_accuracy_deg` from `BearingPayload` and delete the `HeadingSource` type in web/src/log/types.ts (data-model.md §1–2)
- [X] T003 Update web/src/report/bearing.ts: drop the two fields from `BearingDraft`, `BearingEntry`, and the object `composeBearing` assembles; the composer takes `{ heading_magnetic, confidence_q, max_range_r }` + author context and still derives `heading_true`/`declination`/`wmm_epoch` (contracts/log-format-delta.md)
- [X] T004 Update docs/log-format.md `bearing` §3: delete the two table rows and the two example lines (`heading_source`, `compass_accuracy_deg`); keep every retained field and the "why magnetic/declination/epoch are recorded" note (contracts/log-format-delta.md)
- [X] T005 [P] Update bearing fixtures to stop generating/asserting the removed fields in web/tests/unit/arbitraries.ts (bearing arbitrary), web/tests/unit/report.test.ts, web/tests/unit/layers.test.ts, and web/tests/unit/wedge.test.ts
- [X] T006 [P] Payload-shape + back-compat tests in web/tests/unit/report.test.ts: an authored `bearing` payload has exactly the retained keys (no `heading_source`, no `compass_accuracy_deg`) and frozen/twisted/typed differ only in `heading_magnetic` (SC-006/SC-008); assert `composeBearing` still derives `heading_true` from `heading_magnetic + declination` (normalized) and records `declination`/`wmm_epoch` after the field removal (FR-002); a legacy payload carrying the removed fields is accepted and the extra keys ignored (back-compat). Confirm web/tests/unit/aprs.test.ts passes unchanged — proof the wire mapping never used the fields (Principle V)
- [X] T007 [P] Pure dial helpers + unit tests: implement the angle-domain low-pass (sin/cos EMA with a time constant) and the pointer→bearing angle (from dial centre) in web/src/ui/compass-dial.ts, tested in web/tests/unit/compass-dial.test.ts — assert correct wrap behaviour across 359°↔0°, step-response settling, and pointer-angle geometry (research R2/R3)

**Checkpoint**: the bearing payload is trimmed and green across unit tests; the shared dial math is proven.

---

## Phase 3: User Story 1 — Start and freeze a live compass (Priority: P1) 🎯 MVP

**Goal**: On a device with a compass, the bearing sheet shows a damped rotating rose that goes live
(auto where allowed, explicit tap on iOS) and freezes with one tap to a stable, vouched value.

**Independent Test**: With emulated orientation, open Bearing entry, confirm the rose tracks the
device and stays legible, freeze it, confirm the held value does not drift and is what the report
carries, and confirm a freshly opened sheet cannot submit until a freeze.

### Implementation for User Story 1

- [X] T008 [US1] Render the rose in web/src/ui/compass-dial.ts: inline SVG group (N/E/S/W, 5°/30° ticks, degree numerals) rotated as one unit via CSS `transform`, plus a fixed top index ("toward the fox") whose underlying value is the shown bearing; SVG is `aria-hidden`. The rose exposes no declination adjustment and no true-north bezel — it is a magnetic instrument only (FR-001, FR-016, contracts/bearing-entry.md)
- [X] T009 [US1] Always-visible numeric heading field in web/src/ui/compass-dial.ts: reflects the current bearing and commits a typed value; standard `input` semantics, 16 px minimum (FR-003)
- [X] T010 [US1] Live tracking + damping in web/src/ui/compass-dial.ts: subscribe to `watchHeading()` from web/src/sensors/heading.ts, feed samples through the T007 low-pass, rotate the rose per frame; the frozen state holds and is visibly distinct from live (FR-004/FR-005/FR-006)
- [X] T011 [US1] Auto-start branch in web/src/ui/compass-dial.ts: when `needsPermission()` is false, begin live on open; otherwise stay idle and show a ≥ 56 px "start the compass" control that calls `requestPermission()` inside the tap, then `watchHeading()` (FR-004, research R5)
- [X] T012 [US1] Freeze + re-take in web/src/ui/compass-dial.ts: freeze captures the displayed, damped value and commits it; going live again clears the commit until the next freeze so no stale value is sent (FR-006/FR-007, SC-002)
- [X] T013 [US1] Unset/commit rule in web/src/ui/compass-dial.ts: `committedHeading()` returns undefined until the first freeze or twist; never default to north or the moving live value (FR-003a)
- [X] T014 [US1] Host the dial in web/src/ui/report-entry.ts `bearingSheet()`: replace the number-only readout with the dial, keep the confidence and range rows unchanged (FR-015), disable Send while `committedHeading()` is undefined, and on submit pass only `{ heading_magnetic, confidence_q, max_range_r }` into `composeBearing`
- [X] T015 [US1] Dial styling in web/src/ui/app.css (and tokens.css only if a new role is needed): rose/index/numeric layout, live-vs-frozen treatment, 56 px controls, tokens only — no ad-hoc colours
- [X] T016 [US1] US1 e2e in web/tests/e2e/compass-dial.spec.ts: Android-style auto-live → freeze → held value stable under further orientation change (SC-002) → confidence + range → send and appear; iOS-style explicit-start path; open-and-do-nothing → Send disabled, no due-north default (SC-007); assert the dial exposes no declination or true-north control (FR-016)
- [X] T017 [US1] US1 checkpoint: `npm run typecheck`, `test:unit`, and `test:e2e` green including the existing web/tests/e2e/report-entry.spec.ts; grep confirms no `heading_source`/`compass_accuracy_deg` reintroduced

### Field Validation for User Story 1 (deferred milestone — does not gate User Story 2)

- [ ] T018 [US1] When a real hunt is available: hand the phone to a hunter who owns a physical compass and ask for a bearing; record whether they find the freeze unprompted and trust the frozen number (SC-003) in specs/004-compass-dial/findings.md

**Checkpoint**: US1 closes on T008–T017 — a readable, capturable live compass replaces the jittering number.

---

## Phase 4: User Story 2 — Twist a frozen dial to correct or customize (Priority: P2)

**Goal**: A frozen (or any) bearing can be twisted onto the right line by rotating the rose; a
twisted value is a hand-set bearing that the sensor can no longer overwrite.

**Independent Test**: Freeze a known heading, drag the rose by a known angle, confirm the committed
value moved by that angle and no later sensor sample overrides it; dial a bearing in from scratch
with no number pad; confirm twist and sheet scroll never capture each other.

### Implementation for User Story 2

- [X] T019 [US2] Twist handler in web/src/ui/compass-dial.ts: Pointer Events on the rose with pointer capture, centre-relative angle tracking via the T007 helper so the grabbed point stays under the finger, rotating the rose in real time; set `touch-action: none` on the dial element (FR-008, research R3)
- [X] T020 [US2] By-hand detach in web/src/ui/compass-dial.ts: any twist (or numeric edit) transitions to `by-hand` and stops applying sensor updates to the committed heading, so a live reading cannot overwrite a value the reporter set (FR-009, contract transitions)
- [X] T021 [US2] Scroll-vs-twist isolation in web/src/ui/app.css and web/src/ui/report-entry.ts: the entry sheet scrolls only from gestures beginning outside the dial; twisting the rose never scrolls the sheet and scrolling never spins the rose (FR-019)
- [X] T022 [US2] US2 e2e in web/tests/e2e/compass-dial.spec.ts: freeze then drag the rose by a known angle → committed moves by that angle within tolerance and a subsequent emulated sensor sample does not change it (SC-004, FR-009); dial in from scratch with zero number-pad input; assert twist-does-not-scroll and scroll-does-not-twist
- [X] T023 [US2] US2 checkpoint: full unit + e2e green; US1 scenarios still pass (twist did not regress freeze)

### Field Validation for User Story 2 (deferred milestone — does not gate User Story 3)

- [ ] T024 [US2] When a real hunt is available: a hunter whose phone reads badly by a vehicle freezes and twists onto the correct line; record whether correcting felt like adjusting a compass rather than fighting a form (SC-004 in the field) in specs/004-compass-dial/findings.md

**Checkpoint**: US2 closes on T019–T023 — correcting a bearing is a two-second twist.

---

## Phase 5: User Story 3 — The dial as the by-hand entry method (Priority: P3)

**Goal**: Phones with no compass, and the relay/by-voice path, get the same dial set entirely by
twisting, with no live mode and no dead start control.

**Independent Test**: With orientation unavailable, open Bearing entry and confirm no start control,
set a bearing by twisting with zero keystrokes, and confirm the payload is identical to a typed
bearing; confirm the relay path shows the by-hand dial and no live compass.

### Implementation for User Story 3

- [X] T025 [US3] No-compass path in web/src/ui/compass-dial.ts: when orientation is unavailable, present the dial with no live mode and no start-the-compass affordance; the bearing is set by twist alone, committed on first twist (FR-011)
- [X] T026 [US3] Relay wiring in web/src/ui/relay-entry.ts: the relayed bearing uses the dial in by-hand mode only, never offering a live compass (FR-012), submitting through the same trimmed `composeBearing`
- [X] T027 [US3] US3 e2e in web/tests/e2e/compass-dial.spec.ts: orientation unavailable → no start control shown, set by twist, submit with 0 keystrokes (SC-005), payload identical to a typed bearing (SC-008); relay entry presents the by-hand dial with no live compass
- [X] T028 [US3] US3 checkpoint: full unit + e2e green including the existing web/tests/e2e/relay.spec.ts

### Field Validation for User Story 3 (deferred milestone)

- [ ] T029 [US3] When a real hunt is available: a participant on a no-compass phone and a net-control operator entering voiced bearings both set headings on the dial without a keyboard; record whether either fell back to typing (SC-005 in the field) in specs/004-compass-dial/findings.md

**Checkpoint**: US3 closes on T025–T028 — every phone and the relay path get the same instrument.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The guardrails that keep the dial honest across motion, targets, offline, and access.

- [X] T030 [P] Extend web/tests/e2e/reduced-motion.spec.ts: under emulated `prefers-reduced-motion: reduce` the live rose still tracks and reads while settle/freeze flourishes are suppressed (FR-020); confirm app.css keeps the reduced-motion kill as the last rule
- [X] T031 [P] Extend web/tests/e2e/targets.spec.ts: the start-the-compass control, the freeze control, and the dial affordance are each ≥ 56×56 px
- [X] T032 [P] Extend web/tests/e2e/network-audit.spec.ts: a full bearing entry (start/live, freeze, twist, send-to-queue) with connectivity disabled issues 0 network requests (SC-009)
- [X] T033 [P] Accessibility e2e in web/tests/e2e/compass-dial.spec.ts: a bearing set via the numeric field alone (keyboard) submits the typed value and the SVG rose is `aria-hidden` / not required (SC-010)
- [X] T034 Final gate: `npm run typecheck`, `test:unit`, `test:e2e`, and `lint` all green; grep `web/src` confirms no `heading_source`/`compass_accuracy_deg` remain; run the quickstart.md manual smoke on a real phone (Android auto-live, iOS start-tap, open-and-cannot-send)

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T007)** → **User Stories (T008+)**.
- **Foundational blocks everything**: the composer signature (T002–T003) and the shared dial math
  (T007) are prerequisites for every story; the field-removal tests (T005–T006) prove the payload
  change before UI builds on it.
- **US1 (T008–T017)** is the MVP and must land before US2/US3 in practice because US2's twist and
  US3's no-compass path extend the same `compass-dial.ts` the US1 tasks build. The stories are
  independently *testable*, but they share one file, so they are worked in priority order rather than
  concurrently.
- **US2 (T019–T023)** depends on US1's dial existing; **US3 (T025–T028)** depends on US2's twist
  (a no-compass dial is a twist-only dial).
- **Polish (T030–T034)** runs after the stories it audits; T030–T033 are mutually parallel.
- **Field validation (T018, T024, T029)** is deferred and gates nothing.

## Parallel Opportunities

- Foundational: **T005, T006, T007** touch different files (fixtures, tests, helpers) and can run in
  parallel once T002–T004 land.
- Polish: **T030, T031, T032, T033** are separate test files and can run in parallel.
- Within a story most tasks touch `compass-dial.ts` and are therefore sequential; the styling task
  (T015) can proceed alongside the e2e authoring (T016).

## Implementation Strategy

**MVP = User Story 1 (T001–T018).** A damped live compass you start and freeze, replacing the
jittering number, with the payload already trimmed. Shippable on its own: the existing editable
numeric field still covers correction, so no way to fix a bad draft is lost (feature 001's FR-008b not regressed).

**Increment 2 = US2**: twist-to-correct as the natural gesture. **Increment 3 = US3**: the same dial
for no-compass phones and the relay path. Each increment is a complete, independently testable slice;
field validation for all three is captured as deferred milestone work in findings.md.
