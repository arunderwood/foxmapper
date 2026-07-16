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

### Field Validation for User Story 1 (REQUIRED — this closes the story)

- [ ] T070 [US1] Take it to a real hunt per [spec.md § Field Validation](spec.md) and [quickstart.md](quickstart.md) Level 6. Record: whether three untrained participants joined and reported **without being talked through it**; whether the stock-antenna hunter contributed rather than spectated (SC-009); whether **net control kept up with voice traffic** (SC-012 — the plan's explicit bet); whether anyone acted on someone else's report and could say whose they trusted and why (SC-006); whether anyone **fell back to voice because the interface was slower than talking** (SC-007 — the status quo winning); and whether the blank offline basemap was usable or useless

**Checkpoint**: US1 is done when T070 is written up. Not when the tests are green.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T071 [P] Colour palette review in `web/src/log/colour.ts` — the twelve swatches are provisional and have had **no colour-vision-deficiency check and no direct-sunlight check**. Changing the list repaints every hunt, so settle it before real use
- [ ] T072 [P] Publish the log format at `docs/log-format.md` so a third party can reimplement it (FR-021) — the constitution's actual test
- [ ] T073 [P] Bundle size check against SC-001's 15-second cold join on real cell, not wifi
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
