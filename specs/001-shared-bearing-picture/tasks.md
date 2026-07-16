---

description: "Task list for Shared Bearing Picture (001)"
---

# Tasks: Shared Bearing Picture

**Input**: Design documents from `/specs/001-shared-bearing-picture/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Included. Not a default — the artifacts demand them by name. FR-020 says the APRS mapping
is lossless *"to and from"*, which is a property and is only true if tested. Principle IV requires the
fold be *"computed identically from the same log on every client"*, which is a property. SC-004 asserts
0% unbounded wedges. [quickstart.md](quickstart.md) defines six validation levels. Test tasks below
exist because a document says so; each names which one.

**Organization**: The spec has **exactly one user story** (US1, P1). Phase 3 is therefore the whole
product, and there is no cross-story parallelism to find — the [P] markers are all within-story. This
is not a defect in the task list; it is what "the smallest useful form" produced.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (the only story)
- Every task names its file path and the contract section that specifies it

**Field-gate (constitution, Development Workflow)**: T070 closes the story. Green tests do not.

## Path Conventions

Two deployables per [plan.md § Project Structure](plan.md): `server/` (Rust relay, no domain logic) and
`web/` (TypeScript PWA, all domain logic).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Toolchains and skeletons. Nothing here knows what a bearing is.

- [X] T001 Create `server/` and `web/` directory skeletons per [plan.md § Source Code](plan.md)
- [X] T002 [P] Initialize Rust project in `server/Cargo.toml` with `axum`, `tokio`, `sqlx` (postgres, runtime-tokio), `serde`, `uuid`
- [X] T003 [P] Initialize TypeScript project in `web/package.json` with `vite`, `maplibre-gl` 5.x, `@turf/sector`, `geomagnetism`, `idb`
- [X] T004 [P] Configure `rustfmt.toml` and clippy lints in `server/`
- [X] T005 [P] Configure `web/tsconfig.json` (strict), eslint, prettier
- [X] T006 [P] Add `proptest` to `server/Cargo.toml` dev-dependencies
- [X] T007 [P] Add `vitest` and `@playwright/test` to `web/package.json`
- [X] T008 CI workflow in `.github/workflows/ci.yml`: `cargo test`, `cargo clippy`, `vitest run`, `tsc --noEmit`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The log, the relay, and the client spine. This is the constitution in code — Principles
III and IV live entirely in this phase, and it is testable with no browser, no map, and no hardware.

**⚠️ CRITICAL**: No US1 work begins until this phase is complete and its properties pass.

### The log domain (pure functions, no I/O)

- [X] T009 [P] Report types for all five kinds plus the `wire` object in `web/src/log/types.ts` per [contracts/log-format.md](contracts/log-format.md) — `confidence_q` restricted to 3|4|5, `max_range_r` to 1|3|5, `strength_s` to 2|5|8, `clock_offset_ms` nullable
- [X] T010 [P] Property tests for G-Set union laws (associative, commutative, idempotent) in `web/tests/unit/gset.test.ts` per [contracts/log-format.md § Merge](contracts/log-format.md#merge)
- [X] T011 Implement union merge keyed by `id` in `web/src/log/gset.ts` (depends on T009, T010)
- [X] T012 [P] Property tests for the fold in `web/tests/unit/fold.test.ts` per [contracts/log-format.md § The fold](contracts/log-format.md#the-fold): order-independence under shuffle, idempotence, commutativity, **retraction arriving before its target**, retraction of an absent ID is inert, two identical relayed reports both survive, age-neutrality
- [X] T013 Implement the fold in `web/src/log/fold.ts` — compute `retracted` first then filter; never walk-and-mark (depends on T009, T012)
- [X] T014 [P] Tests for colour derivation in `web/tests/unit/colour.test.ts`: same callsign → same swatch across devices; suffix appears only on a real collision; a merely-relayed callsign does **not** trigger the suffix
- [X] T015 Implement callsign→swatch and duplicate detection in `web/src/log/colour.ts` per [contracts/log-format.md § Observer colour](contracts/log-format.md#observer-colour-is-derived-not-stored) (depends on T014)
- [X] T016 [P] Round-trip property tests in `web/tests/unit/aprs.test.ts` per [contracts/aprs-mapping.md § Testing](contracts/aprs-mapping.md): `decode(encode(r)) == r` for authored reports; `encode(decode(w)) == w` for all wire strings including Q=0–9, s=0–9, non-default h/g/d; **`Q ∈ {3,4,5}` for every authored report**; ingested raw digits survive unchanged; `null` always encodes s=0
- [X] T017 Implement the APRS mapping and its inverse in `web/src/aprs/mapping.ts` per [contracts/aprs-mapping.md](contracts/aprs-mapping.md) — N always 9, raw digits stored never decoded degrees (depends on T009, T016)

### The relay

- [X] T018 sqlx migrations for `hunts` and `reports` in `server/migrations/` per [data-model.md § Server-side model](data-model.md#server-side-model) — `body` is jsonb, `seq` bigserial, `received_at` on the envelope
- [X] T019 [P] Opaque report envelope in `server/src/model.rs` — the server MUST NOT parse `body`
- [X] T020 [P] Test append idempotency in `server/tests/append_idempotent.rs`: same `id` twice → one row, `202` both times
- [X] T021 Single-writer append in `server/src/store/mod.rs` per [contracts/http-api.md § The sequence gap](contracts/http-api.md#the-sequence-gap) — serialize appends so no `seq` is visible before commit (depends on T018)
- [X] T022 [P] Test cursor integrity in `server/tests/sync_cursor.rs`: concurrent appends produce no gap a reader can skip past
- [X] T023 Hunt code generation in `server/src/routes/hunts.rs` per [contracts/http-api.md § Hunt codes](contracts/http-api.md#hunt-codes) — **≥40 bits from a CSPRNG**, speakable format, case-insensitive lookup, generate-insert-retry on collision
- [X] T024 [P] Test code entropy and collision retry in `server/tests/hunt_codes.rs` — assert the entropy floor mechanically; the naive `word-word-NNNN` is ~29 bits and must fail this test
- [X] T025 `POST /api/hunts` and `GET /api/hunts/{code}` in `server/src/routes/hunts.rs` — target immutable after creation, `frequency` an opaque string (depends on T023)
- [X] T026 `POST /api/hunts/{code}/reports` (idempotent by id) and `GET …/reports?since=` in `server/src/routes/reports.rs` (depends on T021)
- [X] T027 SSE stream in `server/src/routes/stream.rs` — `id:` = seq, honour `Last-Event-ID`, `retry:`, `: ping` heartbeats, **`204` on purged/unknown hunt** (depends on T021)
- [X] T028 `id_digest` on `GET /api/hunts/{code}` and `GET …/ids` in `server/src/routes/hunts.rs` per [contracts/http-api.md § id_digest](contracts/http-api.md) — sort ascending bytewise over lowercase UUIDs, join `\n`, no trailing newline, lowercase hex
- [X] T029 Per-IP rate limit on append in `server/src/routes/reports.rs` per [contracts/http-api.md § Rate limiting](contracts/http-api.md#rate-limiting) — loose enough never to fire during a real hunt; anti-script, not anti-abuse
- [X] T030 30-day idle purge job in `server/src/store/purge.rs` — clock restarts on every append (depends on T018)
- [X] T031 [P] Test purge in `server/tests/purge.rs`: idle clock restarts on append; purged hunt `404`s and its stream `204`s

### The client spine

- [X] T032 IndexedDB persistence keyed by report id in `web/src/log/store.ts` — load-all-on-open; survives force-quit (depends on T009)
- [X] T033 Local participant identity in `web/src/log/identity.ts` per [contracts/http-api.md § Joining is local](contracts/http-api.md#joining-is-a-purely-local-act) — mint `participant_id` on first use, **works with the network already gone**
- [X] T034 Outbound queue and sync in `web/src/log/sync.ts` — queue drains only on `2xx`; `429` is retryable and never drops a report; SSE with `Last-Event-ID`; re-create `EventSource` on `readyState === CLOSED` with backoff; polling fallback on the same cursor (depends on T032)
- [X] T035 Clock offset measurement in `web/src/log/clock.ts` per FR-009a/b — measure against the server on load, retain for offline use, write `clock_offset_ms` on every authored report, **`null` when never measured (not 0)**
- [X] T036 Divergence audit in `web/src/log/audit.ts` — compare `id_digest`; **only when the outbound queue is empty**; full `ids` diff only on mismatch (depends on T034)

**Checkpoint**: The domain and the spine are done and provable without a browser. Principles III and
IV are satisfied or they are not, and you can tell from `npm run test:unit` and `cargo test`.

---

## Phase 3: User Story 1 - Shared bearing picture (Priority: P1) 🎯 MVP

**Goal**: Hunters join from a link, submit four kinds of report, and see every participant's reports
on a shared map drawn from each observer's position. No estimate is computed.

**Independent Test**: Four people in different locations join one hunt, each submits one bearing, and
each sees the other three on their own device within seconds.

### Sensors (US1) — hardware only; a green CI run here proves nothing

- [X] T037 [P] [US1] Heading capture in `web/src/sensors/heading.ts` per [research.md § 5](research.md) — iOS `webkitCompassHeading` behind a gesture-triggered `requestPermission()`; Android `deviceorientationabsolute` with `360 - alpha` plus screen-orientation correction; **feature-detect, because Safari does not implement `deviceorientationabsolute` at all**; record `compass_accuracy_deg` where available (iOS only)
- [X] T038 [P] [US1] Declination in `web/src/sensors/declination.ts` — `geomagnetism` WMM2025; both platforms give **magnetic**, so this always runs; **wrap the 2029 hard-throw in try/catch** and degrade to a stale model rather than crashing
- [X] T039 [P] [US1] Position in `web/src/sensors/position.ts` — `watchPosition` with `enableHighAccuracy`, discard early km-scale fixes, honest "acquiring" state, never use `coords.accuracy` in math

### Map (US1)

- [X] T040 [P] [US1] Bearing wedge geometry in `web/src/map/wedge.ts` — `@turf/sector` → GeoJSON polygon; verify the 350°→10° north wraparound
- [X] T041 [US1] Basemap in `web/src/map/basemap.ts` — MapLibre against the hosted OpenFreeMap style; **an unreachable tile host is the normal field case and must not read as an error**; attribution `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`; **never pre-fetch tiles — every provider prohibits it**
- [X] T042 [US1] Report layers in `web/src/map/layers.ts` per [data-model.md § Rendering](data-model.md#rendering-rules) — bearings as bounded sectors; `omni`/`null`/`fix` as markers that **imply no direction**; observer callsign + derived colour + duplicate suffix; relayed reports visibly marked with the entering operator; `placed` vs `measured` position distinguished; stale position marked; time shown with its `clock_offset_ms` caveat (depends on T013, T015, T040)

### Report entry (US1)

- [X] T043 [US1] Bearing entry in `web/src/report/bearing.ts` — compass drafts the heading, **reporter sees and can adjust it before submitting**, manual entry when no compass; three confidence buttons → Q ∈ {3,4,5}; three range buttons → R ∈ {1,3,5}; both required (depends on T037, T038, T039)
- [X] T044 [P] [US1] Signal-strength entry in `web/src/report/omni.ts` — three buttons → s ∈ {2,5,8}
- [X] T045 [P] [US1] Heard-nothing entry in `web/src/report/heard_nothing.ts` — kind is `"null"` on the wire; **do not "fix" the wire value, it is a string**
- [X] T046 [P] [US1] Find entry in `web/src/report/fix.ts` — marks the target found by fold; does not close the hunt
- [X] T047 [US1] Relayed entry in `web/src/report/relay.ts` per FR-007a–d — observer callsign distinct from `entered_by`; observer need not be a participant; observer position set by hand (depends on T043)
- [X] T048 [US1] Retraction in `web/src/report/retract.ts` — appends a retraction fact; retractable by whoever **entered** it, including relayed reports

### Interface (US1)

> Unspecified by decision — no UI contract exists ([plan.md § Open Decisions](plan.md)). These tasks
> are deliberately coarse. SC-001a/b and SC-008 are unverifiable until they exist, which is why T070
> is the real gate.

- [X] T049 [US1] Join flow in `web/src/ui/join.ts` — open link, pick callsign, report. No account, no round-trip, **works offline once loaded**
- [X] T050 [US1] Map view in `web/src/ui/map-view.ts` — primary view; shows whether you are seeing everyone's reports or only what your device holds (FR-018) and the unsynced queue depth
- [X] T051 [US1] Report entry surface in `web/src/ui/report-entry.ts` — all four kinds reachable from one place, none presented as lesser (FR-005d); targets large enough for a gloved thumb; **under 10 seconds is the requirement, not an aspiration**
- [X] T052 [P] [US1] Target display in `web/src/ui/target.ts` — frequency, label, found-state in the primary view (FR-004b)
- [X] T053 [P] [US1] Limits notice in `web/src/ui/limits.ts` — not certified for life-safety search; the picture is only as good as the reports entered (FR-022); anyone with the code can join and report (FR-027)
- [X] T054 [P] [US1] Clock warning in `web/src/ui/clock-warning.ts` — warn above 2 minutes, **never silently correct** (FR-009c)
- [X] T055 [US1] Last-hunt memory in `web/src/ui/last-hunt.ts` — reopen the last hunt on return; **no hunt list, no switcher, no multi-hunt view** (FR-004c/d)
- [X] T056 [US1] Service worker app-shell precache in `web/public/sw.ts` — **app shell only; tiles are not pre-fetched**
- [X] T057 [P] [US1] Storage durability in `web/src/ui/storage.ts` — call `navigator.storage.persist()`, offer Add to Home Screen as an **offer never a gate**, surface unsynced count

### Tests for User Story 1 (per [quickstart.md](quickstart.md))

- [X] T058 [P] [US1] E2E join in `web/tests/e2e/join.spec.ts` — link to map in **under 15 s** (SC-001)
- [X] T059 [P] [US1] E2E two-device propagation in `web/tests/e2e/shared-picture.spec.ts` — report visible on the other device in **under 5 s** (SC-002); omni and null render without implying direction; retraction propagates
- [X] T060 [P] [US1] E2E relayed attribution in `web/tests/e2e/relay.spec.ts` — **0 relayed reports attributed to the operator who typed them** (SC-011); relay marking visible
- [X] T061 [P] [US1] E2E offline in `web/tests/e2e/offline.spec.ts` — **real airplane mode, HTTP cache cleared**; three reports accepted and rendered locally; survives force-quit; 100% present after reconnect (SC-005); blank basemap is expected, a lost report is not
- [X] T062 [US1] Manual SSE check per [quickstart.md](quickstart.md) Level 2 — `curl -N` shows events arriving one at a time; **a burst means a proxy is buffering and SC-002 is failing invisibly**
- [ ] T063 [US1] Manual sensor checks per [quickstart.md](quickstart.md) Level 4 on real iOS and Android — declination applied (Bellingham ~15.2°); **stand next to a car and confirm the 10–30° swing**; clock set to 2030 does not crash
- [ ] T064 [US1] Manual iOS storage checks per [quickstart.md](quickstart.md) Level 4 — the two things research could **not** verify from primary sources: does `persist()` beat the ITP 7-day rule, and does Add to Home Screen discard the tab's cache
- [ ] T065 [US1] Jargon review of every reachable screen against [contracts/aprs-mapping.md § Vocabulary firewall](contracts/aprs-mapping.md) — **0 occurrences** of NRQ, DFS, PHG, Q, R, N, S or any raw digit (SC-008)
- [ ] T066 [US1] Four-device test per [quickstart.md](quickstart.md) Level 5 — four phones, four locations, one hunt, no report missing (SC-003)

### Deploy (US1) — required before the field test

- [ ] T067 [US1] Render web service + Postgres; migrations on deploy
- [ ] T068 [US1] **Disable proxy buffering** (`X-Accel-Buffering: no`, `proxy_buffering off`) and **serve over HTTP/2**; long read timeouts. Not tuning — buffered SSE fails SC-002 silently and only in production
- [ ] T069 [US1] Verify T062's `curl -N` check **against the deployed URL**, not localhost

### Shakedown (US1) — before anyone else is invited

> Level 4 proves the hardware works; Level 6 asks whether the product survives people. This is the
> rung in between: the first use **as a product**, outdoors, by someone who does not need
> convincing. It costs a Saturday morning and no goodwill, and it is what makes the invitation in
> T070 worth spending.

- [ ] T069a [US1] Solo hunt per [quickstart.md](quickstart.md) Level 4a — hide a transmitter, hunt it yourself with two phones, invite nobody. Against the **deployed URL on real cell**, not localhost on wifi. Record: whether the blank basemap is usable **while walking**; whether a bearing takes under 10 s one-handed **holding a radio** (SC-001a/b); whether the wedge points at a transmitter **whose location you actually know** — the only rung where ground truth exists, because you hid it; the cold join on real cell (SC-001); whether the palette survives direct sunlight (T071). **This is not the gate**: SC-006, SC-007, SC-009 and SC-012 all need someone who is not you, and **you cannot fairly test the join flow you built**

### Field Validation for User Story 1 (REQUIRED — this closes the story)

- [ ] T070 [US1] Take it to a real hunt per [spec.md § Field Validation](spec.md) and [quickstart.md](quickstart.md) Level 6. Record: whether three untrained participants joined and reported **without being talked through it**; whether the stock-antenna hunter contributed rather than spectated (SC-009); whether **net control kept up with voice traffic** (SC-012 — the plan's explicit bet); whether anyone acted on someone else's report and could say whose they trusted and why (SC-006); whether anyone **fell back to voice because the interface was slower than talking** (SC-007 — the status quo winning); and whether the blank offline basemap was usable or useless

**Checkpoint**: US1 is done when T070 is written up. Not when the tests are green.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T071 [P] Colour palette review in `web/src/log/colour.ts` — the twelve swatches are provisional and have had **no colour-vision-deficiency check and no direct-sunlight check**. Changing the list repaints every hunt, so settle it before real use
- [X] T072 [P] Publish the log format at `docs/log-format.md` so a third party can reimplement it (FR-021) — the constitution's actual test
- [X] T073 [P] Bundle size check against SC-001's 15-second cold join on real cell, not wifi
- [ ] T074 Write up T070's findings against the spec; feed them into the next story

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup. **Blocks US1 entirely**
- **User Story 1 (Phase 3)**: depends on Foundational
- **Polish (Phase 4)**: depends on T070

### Within Phase 2

- T009 (types) blocks almost everything in the phase
- Property tests (T010, T012, T014, T016) are written **before** their implementations (T011, T013, T015, T017) and must fail first
- T018 (migrations) blocks T021; T021 blocks T026, T027
- T032 blocks T034; T034 blocks T036

### Within Phase 3

- Sensors (T037–T039) block bearing entry (T043)
- Fold + colour + wedge (T013, T015, T040) block layers (T042)
- T043 blocks T047 (relay reuses bearing entry)
- Deploy (T067, T068) blocks T069, which blocks T070
- **Everything blocks T070**

### The order the field work actually runs in

Task numbers do not give it, so it is written out. **Ascending order of what a mistake costs**:
each rung is cheap, and each makes the next one worth doing.

```
T067, T068  deploy              ─┐
T069        curl -N in prod      │  nobody else involved
T063, T064  phone realities      │  (T064 starts a 7-day clock — see below)
T069a       the solo hunt       ─┘
T066        four devices           four people, fifteen minutes, one tap each
T070        the field gate         three people who did not build it. One first impression.
```

- **Deploy blocks the lot of it**, including T066 — four phones in four places need a URL, and the
  numbering hides that. Nothing outdoors runs against localhost.
- **T069 blocks everything after it**: buffered SSE fails SC-002 *silently and only in production*,
  so an unverified stream makes every later observation untrustworthy rather than wrong.
- **T063 before T069a**: a compass reading stale zeros makes the solo hunt measure nothing.
- **T069a before T066, and both before T070.** Not comfort — Level 6 gets one first impression, and
  the questions it asks are unanswerable if the basics are broken.
- **T064 has a seven-day clock** and no dependants. It is the longest-lead item in the feature:
  start it the day the deploy lands (install to Home Screen, then leave it alone for a week) rather
  than discovering it is a week from an answer when everything else is ready.
- **T065 is a desk task** and blocks nothing. Do it while waiting on anything above.

### Parallel Opportunities

- Setup: T002–T007 all [P]
- Phase 2: all four property-test tasks [P] together; server tests T020/T022/T024/T031 [P]
- Phase 3: sensors T037–T039 [P]; report kinds T044–T046 [P]; E2E specs T058–T061 [P]
- **No cross-story parallelism exists** — there is one story

---

## Parallel Example: Phase 2 property tests

```bash
# Write all four property suites together, before any implementation:
Task: "G-Set union laws in web/tests/unit/gset.test.ts"
Task: "Fold properties in web/tests/unit/fold.test.ts"
Task: "Colour derivation in web/tests/unit/colour.test.ts"
Task: "APRS round-trip in web/tests/unit/aprs.test.ts"
```

## Parallel Example: Phase 3 sensors

```bash
Task: "Heading capture in web/src/sensors/heading.ts"
Task: "Declination in web/src/sensors/declination.ts"
Task: "Position in web/src/sensors/position.ts"
```

---

## Implementation Strategy

### MVP

US1 **is** the MVP. There is no smaller slice — that was the point of the story, and the four report
kinds are what make it satisfy Principle II rather than being bearings-only.

1. Phase 1: Setup
2. Phase 2: Foundational — **stop here and confirm the properties pass.** The constitution is either
   satisfied in this phase or it is not, and it is far cheaper to find out here than on a hilltop
3. Phase 3: US1
4. **T070: a real hunt.** This is the gate
5. Phase 4: Polish, informed by what T070 found

### Order that matters

Build the log before the server, and the server before the client. Each is testable without the next,
and the expensive mistakes are all in the first one.

Sensors and the map cannot be validated in CI at any point. Budget real device time; do not let a
green pipeline stand in for it.

### Notes

- [P] = different files, no dependencies
- Property tests must fail before their implementation exists
- Commit after each task or logical group
- A story closes on T070, not on green tests

---

## Phase 5: Convergence

**Purpose**: Close the gap between what the artifacts call for and what the code does. Found by
assessing the present state of the code against [spec.md](spec.md), [plan.md](plan.md), the
[contracts/](contracts/), and the constitution — not by reading the checkmarks above.

**What the assessment found**: the log domain and the relay are solid and match their contracts
closely. **The gaps are almost all in Stage 6 — the UI the plan deliberately left unspecified — and
in wiring.** Three modules (`retract.ts`, `audit.ts`, `evict_idle`) are written, correct in
isolation, and imported by nothing. That is the shape of the failure: a task whose unit tests pass
over `web/src/report/` reads as green while the participant-facing requirement it exists for is
unmet. Several tasks above are checked on exactly that basis.

**Not re-listed here**: T063–T070, T071 and T074 remain open and are unchanged. They are hardware,
field, and desk work that no code change closes.

### Constitution violations (CRITICAL — these come first)

- [X] T075 **CRITICAL** — Stop authoring reports from a fabricated position per FR-008 and Constitution I (contradicts). `web/src/main.ts:267-272` falls back to the hardcoded `DEFAULT_CENTER` (`main.ts:40`) when no fix is available and labels it `position_source: 'placed'` — which `web/src/ui/map-view.ts:159` renders as "Position set by hand". **Nobody placed it.** The map draws a wedge from a place the observer has never been and tells every other participant a human put it there. This is precisely the confident-looking wrongness Principle I exists to reject, and it is worse than blocking the report. Require an explicit placement (T076) before a positionless report can be submitted; `'placed'` must mean a person placed it
- [X] T076 **CRITICAL** — Mark relayed and hand-placed **markers** in the primary view per FR-012b and Constitution I (partial). `web/src/ui/map-view.ts:99` dashes relayed *wedges*, but `marker-circle` (`:105-122`) styles on `kind` alone — a relayed or hand-placed `omni`/`null`/`fix` is pixel-identical to a measured first-hand one unless tapped, and `#showDetail` (`:148`) is a popup. The plan's own Constitution Check I says the voice hop is marked "in the primary view, not a tooltip". `web/tests/e2e/relay.spec.ts:50` asserts the GeoJSON property rather than any visible distinction, so it passes regardless — fix the test with the layer
- [X] T077 **CRITICAL** — Build the retraction affordance per FR-010 and US1/AC6 (missing). `web/src/report/retract.ts` is complete and correct (`canRetract` gates on `entered_by.participant_id`; the fold handles retraction-before-target) and is **imported by nothing outside `web/tests/unit/report.test.ts`**. `LABEL = 'Take that back'` has no caller. A hunter who knows their bearing is wrong cannot withdraw it, and the map keeps drawing it — which is also the only remedy the spec offers for a misheard relay. T048 is checked and the feature does not exist; T059 claims "retraction propagates" and `grep -rn retract web/tests/e2e` returns nothing

### Requirements (HIGH)

- [X] T078 Build the point-at-map entry method in `web/src/ui/` per FR-008a and US1/AC7 (missing). The spec requires **two** entry methods reachable without leaving the map; only the device default exists. The sole `map.on('click')` (`web/src/ui/map-view.ts:142`) opens a detail popup — there is no placement path, so a participant whose device cannot supply a position (denied, under canopy, or simply wrong) has no honest way to report at all. This is what makes T075 fixable rather than merely blocking
- [X] T079 Draw the observer's callsign on bearing wedges per FR-012 and FR-002b (partial). `web/src/ui/map-view.ts:84-101` adds `wedge-fill` and `wedge-line` and **no text layer**; the `label` is computed for every wedge at `web/src/map/layers.ts:104` and dropped on the floor. Bearings — the feature's headline report kind — are attributed by colour alone until tapped, which is what FR-002b forbids by name. The comment at `layers.ts:101-103` states the requirement it fails to meet, and notes twelve swatches make a collision routine in a hunt of eight
- [X] T080 Allow every report kind to be relayed per FR-007a/b (partial). `relayFields()` is wired into `bearingSheet` only (`web/src/ui/report-entry.ts:259`); `omniSheet` (`:309`) and `simpleSheet` (`:331`) have no relay path. Net control cannot enter a voice-reported signal strength or "heard nothing" — the contributions of exactly the stock-antenna hunter FR-005d and the spec's unequipped-hunter persona exist for. FR-007a/b are not kind-scoped, and `web/src/report/relay.ts:7` already claims every kind can be relayed
- [X] T081 Show and share the hunt code and link per FR-001 (partial). Creation works, but the creator never **obtains** anything: `web/src/main.ts:139` redirects to `/h/{code}` and no screen renders the code or a copyable link. `huntLink()` (`web/src/ui/last-hunt.ts:44`) has **zero call sites**. The code surfaces only at `web/src/ui/join.ts:71`, on the fallback branch when the target fetch fails. A hunt is a code read aloud over a repeater; the creator's only access to it is the address bar
- [X] T082 Never suffix a relayed report's callsign per [contracts/log-format.md § Observer colour](contracts/log-format.md#observer-colour-is-derived-not-stored) and FR-002c (contradicts). `ambiguousCallsigns` correctly excludes relayed reports from *detection* (`web/src/log/colour.ts:64`), but `web/src/map/layers.ts:104` calls `displayName(..., report.entered_by.participant_id, ...)` for **every** report — so once a callsign is ambiguous, a relayed report of it renders `KI7XYZ ·<the relayer's suffix>`. That marker identifies who typed it, not who observed it. The contract says a relayed report cannot be disambiguated at all, because the voice call did not disambiguate either. `web/tests/unit/colour.test.ts` never calls `displayName` on a relayed report
- [X] T083 Let a relayed report carry the time the observation was taken per FR-007 (partial). `web/src/ui/report-entry.ts:100` stamps `observed_at` with `Date.now()` on the relay path — **the time net control typed it**, which is the one thing FR-007 says not to record. There is no field to enter the observed time. The code calls now "the honest floor", and for a report read over the air minutes after it was taken, the floor is not the fact

### Requirements (MEDIUM)

- [X] T084 Cache the target locally per FR-004b and FR-004c (partial). `#fetchTarget` (`web/src/main.ts:104-118`) writes only to an in-memory field and no `target` key exists in `web/src/log/store.ts` — though the `meta` store (`store.ts:42`) already holds the clock offset and is the obvious home. On an offline reopen the primary view falls back to the constructor default (`main.ts:46`), showing **the fabricated label `'Fox hunt'` and no frequency**, indistinguishable from a real target. FR-004b says every participant sees the frequency from the primary view; FR-004c promises the remembered hunt reopens offline
- [X] T085 Make each report kind legible on the map per FR-011a (partial). `omni` and `fix` are the same filled circle in the same colour, separated only by radius 8 vs 11 (`web/src/ui/map-view.ts:110`); the label layer prints the callsign only (`:129`). "Legible as the kind of claim it is" currently requires a tap. `strength_s` is computed into the feature at `web/src/map/layers.ts:113` and rendered nowhere — an `omni` cannot be told from another `omni`. (The no-direction and hollow-`null` halves of FR-011a are correct and should stay that way)
- [X] T086 Wire the divergence audit per [plan.md § Stage 3.4](plan.md) (partial). The guard is right — `web/src/log/audit.ts:47` returns `skipped` while the outbox is non-empty — but **`audit()` has no callers**, so the server's `GET …/ids` slow path is unreachable too. The audit is the plan's answer to the cursor protocol's one silent-loss failure mode, and it never runs
- [X] T087 Re-measure the clock offset when connectivity returns per FR-009a (partial). `measureOffset` is called once, at join (`web/src/main.ts:96`); the `online` listener (`:238-240`) only flushes sync. FR-009a says measure **whenever** there is a network connection. A device that joined offline writes `clock_offset_ms: null` on every report until the page is reloaded — honest, but it never takes the measurement it could
- [X] T088 Land a participant out of a purged hunt per FR-004c and [spec.md § Edge Cases](spec.md) ("The remembered hunt has expired") (partial). `onHuntGone` (`web/src/main.ts:227-231`) calls `huntIsGone()` and `#refresh()`, which only updates the map view — the participant stays sitting in a dead hunt. Worse, nothing stops sync: `#stopped` is never set, so the poll and the `EventSource` reconnect loop (`web/src/log/sync.ts:148`) retry a 204'd hunt forever. The spec says they land where a first-time visitor lands
- [X] T089 Widen the vocabulary firewall per FR-019 and SC-008 (partial). `web/tests/unit/vocabulary.test.ts:47` scans only `src/ui` and `src/report`, but **`web/src/main.ts` renders the entire start screen** — headings, placeholders, and an error notice (`main.ts:123-160`). The suite's claim to cover "every module that can reach a screen" (`:49`) is false as written, and the `surfaces.length > 8` guard (`:51`) cannot catch a screen living outside the scanned directories. The strings are clean today; the guard is not. Scan `src/map` too, where `layers.ts:113` emits `strength_s`
- [X] T090 Require a heading rather than defaulting it per FR-008b (partial). `bearingSheet` initialises `magnetic = 0` with `source: 'manual'` (`web/src/ui/report-entry.ts:185-186`). A reporter who picks confidence and range without touching the compass or the input submits a **due-north bearing recorded as their own hand-typed claim**. FR-008b is technically met — the zero is visible and adjustable — but this is the "default wearing the reporter's name" that FR-006c forbids for range, and range is guarded at `:251` while heading is not
- [X] T091 Test declination in `web/tests/unit/declination.test.ts` per [plan.md § Stage 4.2](plan.md) (partial). No such file exists. The 2029 hard-throw catch (`web/src/sensors/declination.ts:39`), the `stale` flag, and the `"WMM-2025"` → `"WMM2025"` normalization (`:51`) that the log format depends on are asserted by comment only. The plan's done-when names Bellingham's ~15.2° — a value a unit test can pin without a phone, unlike T063
- [X] T092 Wire or delete `evict_idle` in `server/src/rate_limit.rs:89` (unrequested). It is defined, never called, and its own comment says it exists "so the map cannot grow without bound" — so the per-IP `HashMap` grows unbounded for the process lifetime. No task asked for eviction; either it is needed and should run, or it is not and should go

### Polish (LOW)

- [X] T093 Register the map click handler once per FR-012 (partial). `#addLayers` guards on `map.getSource(WEDGE_SOURCE)` (`web/src/ui/map-view.ts:76`), but a basemap style swap drops custom sources — as the comment at `:59-62` says — so the blank→streets upgrade re-enters and registers a **second** `map.on('click')` (`:142`), stacking two popups per tap
- [X] T094 Keep one Q table per [contracts/aprs-mapping.md](contracts/aprs-mapping.md) (unrequested). `web/src/aprs/mapping.ts:191-223` (`Q_DEGREES`, `qDescription`, `wedgeHalfWidthDegrees`, `rangeMiles`) has no callers, while `web/src/map/wedge.ts:24` keeps its own duplicate `HALF_WIDTH_DEGREES`. The values agree today. Two normative copies of the table that caps what a wedge may claim is a divergence waiting to happen, and Principle I is what it would cost

**Checkpoint**: Phase 5 does not close the story either. **T070 still does.** These are the things
that would have made the field gate measure the interface instead of its holes — a hunter cannot
currently withdraw a wrong bearing (T077), place themselves when GPS fails (T075/T078), or tell whose
wedge is whose without tapping it (T079). Fix these, then go outdoors.

---

## Phase 6: Convergence

**Purpose**: Close what a second assessment of the code against [spec.md](spec.md), [plan.md](plan.md),
the [contracts/](contracts/) and the constitution found still open.

**What this round found**: no regressions — every requirement satisfied before Phase 5 still is, and
the Q and range tables survived being collapsed into `log/confidence.ts` with identical values. The
findings divide in two, and the split is the lesson:

1. **The same bug, on the path the fix did not cover.** T075 removed a fabricated position from the
   self-report path. The relay path still has one, for a different reason (`Number('') === 0`), and
   it is worse: a half-filled relay form does not just misplace a report, it silently files it under
   the wrong callsign — which SC-011 says must never happen at all.
2. **Five items below were introduced by Phase 5 itself** (T095's sibling F-numbers: the join-path
   teardown, the unclearable placed position, the racing cursor rewind, the wiped share status, and a
   docstring asserting something false about wedge width). A fix that lands without its own audit is
   a fix that has not landed.

**Not re-listed**: T063–T070, T071 and T074 remain open and unchanged — hardware, field and desk work
no code change closes.

### Constitution violations (CRITICAL — these come first)

- [X] T095 **CRITICAL** — Reject a relayed report with no stated position per FR-008 and Constitution I (contradicts). `web/src/ui/report-entry.ts:114-116` guards with `Number.isNaN`, but **`Number('')` is `0`, not `NaN`**, and an empty `<input type="number">` reads `''`. Net control who toggles relay, types a callsign and leaves the position blank files a report at **lat 0, lon 0** — Null Island, in the Gulf of Guinea — carrying `position_source: 'placed'` (`web/src/report/relay.ts:39`), which every other map draws as "set by hand" under the observer's callsign. This is exactly the fabricated position T075 removed from the self-report path, surviving on the one path T075 did not touch, and the observer cannot correct it because they are not in the app. `web/tests/e2e/relay.spec.ts` always fills lat/lon, so nothing catches it
- [X] T096 **CRITICAL** — Never silently downgrade a relayed report to a first-hand one per FR-007b, SC-011 and Constitution I (contradicts). `web/src/ui/report-entry.ts:131-133`: `withRelay` returns the **entering operator's own context** whenever `details()` yields `undefined` — which happens on a blank callsign, or any field the guard rejects. The relay toggle is visibly on, Send is enabled (it only checks heading, confidence and range), and the report is filed as net control's own observation from net control's position. FR-007b says the system "MUST NOT record a relayed report as though the entering operator observed it"; SC-011 sets the target at **0** such reports. A silent fallback is how you get all of them. Refuse to send, and say which field is missing

### Requirements (HIGH)

- [X] T097 ~~Make the observer's callsign survive offline~~ — **NOT A DEFECT. The finding's premise was false, and testing it is what this task became.** The reasoning was sound and the conclusion wrong: labels *are* drawn from glyphs the tile host serves (`web/src/map/basemap.ts`), and the service worker *does* pass cross-origin straight through (`web/public/sw.js:81`) — but **MapLibre shapes the codepoints locally when a glyph range fails to load**, so the callsign renders with the host gone. Verified rather than argued, on both engines: with the font host blocked outright, `queryRenderedFeatures({layers:['marker-label']})` still returns the laid-out label, and it is legible in a screenshot. Pinned by a guard in `web/tests/e2e/basemap.spec.ts`, because FR-002b rests on it and it is a behaviour of a dependency rather than of our code. **No font was vendored** — that would have been real complexity bought against a bug that does not exist. The two comments that asserted the failure (`basemap.ts`, `map-view.ts`) were the source of the wrong finding and now state what was measured
- [X] T098 Do not render a join screen for a hunt that is gone per FR-004c and [spec.md § Edge Cases](spec.md) (contradicts). `web/src/main.ts:107-112`: on the not-yet-joined path a 404 makes `#fetchTarget` call `#huntGone()` — which stops sync, clears `#huntCode` and renders the start screen — and then the next line calls `#renderJoin(target)`, which clears the root and renders a join screen anyway, for hunt `''`. Joining there authors reports with `hunt_code: ''` and queues them to `POST /api/hunts//reports`. **Introduced by T088**, which fixed this on the identity path and left the join path re-rendering over its own teardown
- [X] T099 Let a hunter go back to the device's position per FR-008a (partial). `web/src/main.ts:441` sets `#placed` and **nothing ever clears it**; `#authorContext` (`:392`) prefers it forever after. FR-008a requires a participant reach *either* method — after one tap on the map, the Device default is gone for the session and only a reload brings it back. The hunter who placed themselves under canopy and then walked into the open has no way to say so. **Introduced by T078**
- [X] T100 Stop the join screen waiting on the network per FR-002 and Constitution III (partial). `web/src/main.ts:110` **awaits** `#fetchTarget()` before rendering the join screen, under a comment (`:108-109`) claiming "this never blocks". Offline the fetch rejects fast and the claim holds by luck; a captive portal or a weak link hangs it for the life of the request, and the participant sees nothing — no join, no map, no report. [contracts/http-api.md § Joining is a purely local act](contracts/http-api.md) says what this should be. Render the join screen first and fill the target in when it arrives, exactly as the identity path already does (`main.ts:116-121`)

### Requirements (MEDIUM)

- [X] T101 ~~Name the relaying operator without glyphs~~ — **moot with T097: nothing was missing.** This task existed only because T097 believed labels vanish offline. They do not, so `via {callsign}` (`web/src/map/layers.ts`) reaches the primary view in the field exactly as it does in coverage, and FR-012b's second half — "MUST identify the operator who entered it" — was already met. The `marker-relay-ring` and the dashed wedge outline stay as what they always were: a mark that reads at a glance, which 12px text does not. Their comment claimed they were carrying the requirement alone; it now says they are belt and braces
- [X] T102 Fall back to the cached target on a bad response, not only on no response, per FR-004b (partial). `web/src/main.ts:197`: `if (!response.ok) return undefined;` returns before the cache is consulted, so a 5xx, a captive portal, or any reachable-but-wrong answer leaves the primary view saying "Target not loaded yet" while a good cached target sits in IndexedDB. Only the `catch` (`:203-205`) reads the cache. **Bad network is the more common field failure than no network**, and it is the one case the cache does not cover. **Introduced by T084**
- [X] T103 Make the divergence repair's rewind actually rewind per [plan.md § Stage 3.4](plan.md) and FR-017 (partial). `web/src/log/sync.ts:180-182` sets the cursor to 0 and then awaits `flush()`; if any SSE event lands in that window, `#absorb` raises the cursor to its `seq` (`:216-217`), and the `#poll()` that follows reads the *raised* cursor and fetches `since=N`. The rewind silently does not happen and `missingLocally` is never pulled — defeated by the stream the repair runs alongside. Poll `since=0` explicitly rather than through `getMeta`. **Introduced by T086**
- [X] T104 Fix the Q=0 wedge width, or the claim made for it, per Constitution I and [contracts/aprs-mapping.md](contracts/aprs-mapping.md) (contradicts). `web/src/map/wedge.ts:44-46` falls back to a half-width of `32` — a **64° wedge** — for a confidence digit with no defined width, under a docstring asserting "the widest wedge is the honest answer... because it claims the least". It is not the widest: Q=1 is 240° and Q=2 is 120° ([confidence.ts](../../web/src/log/confidence.ts)). 64° is the width of a "rough guess", so an unreadable confidence from the air is drawn **exactly as confidently as a claim someone actually made**. Unreachable in P1 (no gateway ingests anything), which is why this is not CRITICAL — but the comment is shipped and false today, and the whole point of the cap is that a wedge never claims more than its input supports
- [X] T105 Keep one copy of the clock-skew threshold per FR-009c/d (partial). `web/src/map/layers.ts:60` redeclares `SKEW_WARNING_MS = 2 * 60 * 1_000`, which `web/src/log/clock.ts:14` already exports — alongside `isSkewed()`, which does precisely what `layers.ts:128` open-codes. The values agree today. This is the same divergence T094 collapsed for the Q table: two normative copies of the two minutes FR-009c names, and if they drift the warning chip and the map caveat disagree about the same report
- [X] T106 Keep the share result on screen per FR-001 (partial). `web/src/ui/share.ts` writes "Link copied" — and, on the last-resort branch, the bare link itself — into a node that `#updateStatus` destroys: `web/src/ui/map-view.ts` calls `clear(this.#statusBar)` and rebuilds `shareChip` from scratch on **every** `#refresh()`, which fires on every `watchPosition` callback. On a phone with a live fix that is about once a second. The branch that exists so a hunter "leaves with something they can say out loud" is the one most reliably wiped, and `web/tests/e2e/report-entry.spec.ts` passes only because the harness fix never moves. **Introduced by T081**
- [X] T107 Say why a report was not sent per FR-006 and FR-008 (partial). If the position is lost after a sheet is open (`#placed` unset and the fix gone), `options.context()` returns undefined and every sheet's guard returns silently — `web/src/ui/report-entry.ts:319`, `:352`, `:392`. In `omniSheet` the tapped choice has already flipped `aria-checked="true"`, so the one-tap-sends contract **looks** honoured while nothing was filed. No FR mandates the message, but this is the one path where the interface says it did something it did not

### Polish (LOW)

- [X] T108 Tell a cancelled share from a failed one per FR-001 (partial). `web/src/ui/share.ts:44-51`: dismissing the platform share sheet rejects with `AbortError`, which falls through to `navigator.clipboard.writeText` and reports "Link copied" — so cancelling copies anyway and says so. Re-throw or ignore `AbortError`; fall through only on a real failure
- [X] T109 Drop the dead re-export and the stale comment per [plan.md § Stage 1.4](plan.md) (unrequested). `web/src/aprs/mapping.ts:204` re-exports `rangeMiles` and `wedgeHalfWidthDegrees` "for callers already holding this module" — **there are none**; `wedge.ts:16` imports them from `log/confidence.js` directly and no test imports them from here. T094 asked for one table, and this ships one table with two access paths, the second unused. `web/src/map/wedge.ts:24-25` still says the table "lives in the mapping module", which stopped being true eight lines above it
- [X] T110 Remove or justify the unused exports per [plan.md § Structure Decision](plan.md) (unrequested). No caller anywhere, tests included: `isRelayedReport` (`web/src/report/relay.ts:50` — a second implementation of `isRelayed`, `web/src/log/types.ts:156`, which is what every call site actually uses), `mergeAll` (`web/src/log/gset.ts:30`), `isCompassAvailable` (`web/src/sensors/heading.ts:38`), `isRetraction` (`web/src/log/types.ts:160`), `toWireFields` (`web/src/aprs/mapping.ts:213`), `AUTHORED` (`web/src/aprs/mapping.ts:210` — the `_authoredQ/R/S` compile-time proof it is built from **is** load-bearing and must stay). Two implementations of one predicate is the one worth acting on
- [X] T111 Show the attribution once per [plan.md § Stage 5.3](plan.md) (partial). `web/src/map/basemap.ts:68` adds `customAttribution` so the licence is honoured before any tile loads; once the Liberty style arrives its sources carry the same string, and both render — "OpenFreeMap © OpenMapTiles Data from OpenStreetMap | OpenFreeMap © OpenMapTiles Data from OpenStreetMap". The obligation is met twice over, which is not a violation, but it doubles the width of the one piece of furniture competing with the map on a phone

### Found while fixing the above

- [X] T112 Stop the target fetch re-rendering the join screen under the participant, per FR-002 (contradicts). T100's first fix rendered the join screen immediately and then called `#renderJoin(target)` again when the fetch landed — which **destroyed the map if the hunter had already joined**, and wiped a half-typed callsign if they had not. It reproduced as a hang in about one run in twenty-four of `shared-picture.spec.ts` and would have been a rare, unexplainable "the app went blank as I joined" in the field. The target line is now updated in place (`web/src/ui/join.ts` `targetLine`), never re-rendered, and `onJoined` no longer closes over a stale target. **Introduced and caught inside this phase**, by the stress run rather than by review — the pattern the phase's own preamble names

**Checkpoint**: still not the gate. **T070 is.** T095 and T096 are the two that would matter outdoors:
net control is the persona most likely to fumble a field while keeping up with voice traffic
(SC-012), and both bugs turn that fumble into a report on the map that nobody can trace back to a
mistake — one at Null Island, one wearing the wrong callsign.

**What this phase should teach the next one**: T097 was a careful, well-argued finding that was
simply **false**, and only a test settled it. Two of the seventeen (T097, T101) dissolved on contact
with a browser, and one new defect (T112) was created by a fix and caught by a stress run rather
than by reading. Reason about the code to find candidates; run it to decide.
