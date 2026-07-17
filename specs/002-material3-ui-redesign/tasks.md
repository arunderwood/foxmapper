# Tasks: Material 3 Expressive UI Redesign

**Input**: Design documents from `/specs/002-material3-ui-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/design-tokens.md,
contracts/iconography.md, quickstart.md

**Tests**: Included — the spec's success criteria mandate automated audits (SC-001 contrast,
SC-002 targets, SC-006 reduced motion, SC-009 network), so the audit tests are first-class
tasks and land as guardrails *before* restyling begins.

**Organization**: Tasks are grouped by user story. Foundational tokens/icons/audits block all
stories; after that each story is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

**Field validation (constitution, Development Workflow)**: each story phase carries a field
validation task — a deferred milestone, not a gate. A story closes on its tests and its
independent test. Work stories in priority order (P1 → P2 → P3).

## Path Conventions

Web SPA under `web/` per plan.md: source in `web/src/`, tests in `web/tests/`, static assets
in `web/public/`, dev scripts in `web/scripts/`.

---

## Phase 1: Setup (token pipeline)

**Purpose**: The generation pipeline that produces the design system's single source of truth.

- [x] T001 Add `@material/material-color-utilities` as a devDependency in web/package.json (build-time only — verify it lands in devDependencies, not dependencies)
- [x] T002 Write the token generation script in web/scripts/generate-tokens.mjs: seed `#E2633C`, dark scheme only (hard-fail on light), deterministic output, emits reference + system tiers with M3 names plus `--fx-*` extensions per contracts/design-tokens.md, preserves a marked hand-tuned block
- [x] T003 Generate and commit web/src/ui/tokens.css; import it in web/src/main.ts ahead of app.css; verify indicative role values from research.md R2 land within contrast floors

---

## Phase 2: Foundational (guardrails + shared vocabulary — blocks all stories)

**Purpose**: The audits that keep every later task honest, the icon module every story
consumes, and the base component layer (type scale, buttons, inputs, state layers, motion).

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T004 Contrast audit unit test in web/tests/unit/contrast.test.ts: parse tokens.css, assert every glanceable pair ≥ 7:1, body text ≥ 4.5:1, non-text ≥ 3:1 per the pair list in contracts/design-tokens.md — must pass against T003's committed tokens
- [x] T005 [P] Icon module in web/src/ui/icons.ts: the 16-icon Material Symbols subset from contracts/iconography.md as inline SVG path data, Apache 2.0 attribution header, `icon(name, {label})` helper with the aria rules (aria-hidden beside visible labels, aria-label when icon-only), ≥ 24 px glyph rendering
- [x] T006 [P] Touch-target audit e2e in web/tests/e2e/targets.spec.ts: walk join, map view, all four sheets, a popup, banners; assert every interactive element ≥ 56×56 px (green today; stays green through the redesign). Run the walk at two viewports — default phone and narrow 320 px — asserting the four kind buttons stay equal-sized with targets intact at both (labels compress before targets or icons do)
- [x] T007 [P] Reduced-motion audit e2e in web/tests/e2e/reduced-motion.spec.ts: same walk under emulated `prefers-reduced-motion: reduce`; assert no animation/transition over 50 ms runs and every sheet/chip state change still completes
- [x] T008 [P] Network audit e2e in web/tests/e2e/network-audit.spec.ts: join → report → offline → reconnect → drain while recording requests; assert only app-origin bundle files and tiles.openfreemap.org appear — zero font/icon/image requests elsewhere. Also assert the FR-014 invariants survive restyling: computed `overscroll-behavior` on body is `none` (no pull-to-refresh) and the MapLibre attribution control's box does not intersect the report bar's
- [x] T009 Rewrite the base layer of web/src/ui/app.css to consume tokens: root block, M3 Expressive type-scale classes (display/headline/title/body/label), button anatomy with state layers (`::after` overlays at token opacities, `scale(0.97)` press, `:focus-visible` in primary), input styling (16 px floor via `--fx-input-font`), motion custom properties, and keep the `prefers-reduced-motion` kill as the last rule. The rewritten `html,body` block MUST preserve `overscroll-behavior: none` (FR-014, no pull-to-refresh) and `overflow: hidden` with their explanatory comments — legacy variables still present at this point, deleted in T033

**Checkpoint**: tokens committed and contrast-audited; icons available; the three e2e
guardrails green on the unrestyled app; base controls restyled.

---

## Phase 3: User Story 1 — Reporting reads as an instrument (Priority: P1) 🎯 MVP

**Goal**: The report bar and entry sheets become the redesigned instrument: four equal
icon+label kind buttons, live press states, sheets that enter with intent, unmistakable
primary action.

**Independent Test**: On a phone-sized viewport in a hunt session, exercise the report bar
and all four entry sheets: icon + label on every kind button, pressed state visible during
the press, sheet enters/exits directionally, a report of each kind completes — while join
screen and chips still carry old styling.

### Implementation for User Story 1

- [ ] T010 [US1] Report bar markup in web/src/ui/report-entry.ts: render each KIND_BUTTONS entry as kind icon above short label using icons.ts and the report-kind identities from data-model.md §2 (bearing/explore, omni/cell_tower, null/signal_disconnected, fix/flag)
- [ ] T011 [US1] Report bar styling in web/src/ui/app.css: 4-equal-column grid preserved, kind icons in their `--fx-kind-*` hues, labels at 7:1, state layers + press scale, `--fx-touch` floor, attribution clearance rule retained
- [ ] T012 [US1] Sheet structure in web/src/ui/report-entry.ts: header carries the kind's icon + colour + title (same triple as the bar), explicit close affordance (icon-only `close` is permitted), motion hook classes for enter/exit
- [ ] T013 [US1] Sheet styling in web/src/ui/app.css: extra-large top corners, enter via emphasized-decelerate 300 ms translate-up + backdrop fade, exit via emphasized-accelerate 200 ms, Send as filled primary button visually dominant over tonal secondaries, sheet text ≥ 7:1 on surface-container-high
- [ ] T014 [US1] Single-choice button rows (`.choices` radiogroups) in web/src/ui/report-entry.ts and app.css: selected state as filled tonal (not just colour swap — outline + fill + weight change), unselected quiet, three-across gloved-thumb layout preserved
- [ ] T015 [US1] Microcopy pass over the four sheets in web/src/ui/report-entry.ts: shorten any label where the icon + short label carries the same meaning; hunter language only; input labels stay explicit (relay fields keep their plain questions)
- [ ] T016 [US1] Report flow e2e in web/tests/e2e/report-redesign.spec.ts: assert all four kind buttons expose icon + visible label at equal size, `:active` press state applies a visible state layer, sheet opens/dismisses, one report of each kind submits; run T006–T008 audits against the restyled flow
- [ ] T017 [US1] US1 checkpoint: full unit + e2e suites green including the pre-existing report-entry tests (both relay-toggle directions); grep the touched files for legacy variables — none introduced back

### Field Validation for User Story 1 (deferred milestone — does not gate User Story 2)

- [ ] T018 [US1] When a real hunt is available: hand the phone to a hunter who has never seen the app mid-hunt and ask for a bearing report; record unaided success/hesitation at the four buttons (SC-004/SC-005 in the field) in specs/002-material3-ui-redesign/findings.md

**Checkpoint**: US1 closes on T010–T017; the report flow is the redesigned instrument.

---

## Phase 4: User Story 2 — Status readable from the periphery (Priority: P2)

**Goal**: Status chips, banners, and notices become the glanceable icon + colour + shape
vocabulary; connectivity changes are noticeable peripherally; a draining queue reads as
progress.

**Independent Test**: Drive online → offline → queued → draining → synced with network
throttling: each state identifiable from the primary view without a tap, each transition
changes icon AND colour AND shape, every banner/notice/empty/error state renders in the new
language.

### Implementation for User Story 2

- [ ] T019 [US2] Status chip structure in web/src/ui/map-view.ts: sync-state, queue, and tiles-state chips render icon + short label per data-model.md §3; queue chip exposes the count; share chip and locate/place affordances adopt their icons (share and my_location may be icon-only per contracts/iconography.md)
- [ ] T020 [P] [US2] Chip structure in the satellite modules: web/src/ui/clock-warning.ts (schedule icon), web/src/ui/target.ts (found-it state uses the fix triple), web/src/ui/share.ts (share icon, hunt code stays monospace)
- [ ] T021 [US2] Chip styling in web/src/ui/app.css: pill vs medium container shapes per state, colour roles from tokens (`ok`/`warn`/`error`/`primary` on their containers), 150 ms standard cross-fade on icon+colour state change (compositor-only properties), warning wrap behavior preserved (never truncate)
- [ ] T022 [US2] Queued/draining presentation in web/src/ui/map-view.ts and app.css: count visibly ticks down and a determinate progress hairline advances while draining — primary colour, no spinner, no error styling; flashes synced (`ok` + cloud_done) before returning to live
- [ ] T023 [US2] Banners and notices in web/src/ui/app.css plus web/src/ui/last-hunt.ts and the hand-placement banner in map-view.ts: token surfaces/shapes, leading icon, designed error and empty presentations; GPS-lost banner uses error-container treatment
- [ ] T024 [US2] Blank offline fallback style in web/src/map/basemap.ts: background from `--md-sys-color-surface` (read from tokens, not restated), paired with the tiles-off chip so out-of-coverage ground reads as designed, not broken
- [ ] T025 [US2] Status transition e2e in web/tests/e2e/status-states.spec.ts: walk the transition graph from data-model.md §3 with context.setOffline; assert each state's icon name, colour class, and container shape all differ between adjacent states (the colour-removed distinguishability check, SC-007), and the draining count decreases. Also assert FR-016: warning-class chips (the uncertainty-warning tier) render in the primary view without any tap, use the glanceable colour roles, and wrap rather than truncate at narrow widths
- [ ] T026 [US2] US2 checkpoint: full suites green; manual glanceability walk per quickstart.md SC-007 including DevTools achromatopsia emulation

### Field Validation for User Story 2 (deferred milestone — does not gate User Story 3)

- [ ] T027 [US2] When a real hunt crosses a dead zone: observe whether the hunter notices the offline transition unprompted and whether anyone worries during the drain; record in specs/002-material3-ui-redesign/findings.md

**Checkpoint**: US2 closes on T019–T026; status reads at arm's length.

---

## Phase 5: User Story 3 — The app reads as one designed thing (Priority: P3)

**Goal**: Join screen, popups, map-drawn elements, and the brand assets join the system;
legacy styling is deleted, not orphaned.

**Independent Test**: Walk every remaining surface on a phone-sized viewport: all consume
the token set, the SC-008 greps return nothing, tab and home screen show the evolved mark,
and no surface reads as pre-redesign.

### Implementation for User Story 3

- [ ] T028 [US3] Join screen in web/src/ui/join.ts and app.css: display-scale type hierarchy, one visually dominant filled join action, entrance as a sanctioned expressive moment per FR-005 using the motion tokens (emphasized-decelerate at the medium 300 ms duration; suppressed entirely under reduced motion), inputs on token styling
- [ ] T029 [US3] Report popups in web/src/ui/map-view.ts and the `.maplibregl-popup` overrides in app.css: popup header shows the report kind's icon + colour + label triple matching the bar, retract button restyled as error-outlined, token surfaces, attribution stays clear
- [ ] T030 [US3] Map-drawn colours in web/src/map/layers.ts: marker and wedge rendering takes kind hues from the token constants rather than restating hex values; the per-callsign Tol palette in web/src/log/colour.ts is untouched (frozen by contracts/design-tokens.md §8 — verify no diff)
- [ ] T031 [US3] Evolve the identity mark in web/public/icon.svg: keep the bounded-wedge geometry, recolour to primary-family wedge on `surface` ground, neutral observer dot, stroke weights tuned for 16 px legibility
- [ ] T032 [US3] Derived brand assets (after T031 — PNGs derive from its SVG; parallel with T033/T034): generate web/public/icon-192.png, icon-512.png (maskable, mark in 80% safe zone), apple-touch-icon.png (180×180 opaque); update web/public/manifest.webmanifest (icon list, `theme_color`/`background_color` = final surface value) and web/index.html (favicon link, apple-touch-icon link, theme-color meta)
- [ ] T033 [US3] Delete the legacy layer: remove `--bg/--surface/--surface-raised/--line/--text/--text-dim/--accent/--warn/--danger/--radius` definitions and any remaining consumers across web/src; rename `--touch`→`--fx-touch`, `--mono`→`--fx-font-mono`; both SC-008 greps from quickstart.md return nothing
- [ ] T034 [US3] Coherence + brand e2e/manual: visual sweep of every surface per quickstart.md; SC-010 checks — favicon in tab, iOS add-to-home-screen (opaque, surface ground), Android maskable survives circular crop, theme colour matches
- [ ] T035 [US3] US3 checkpoint: full suites green; T004 contrast test, T006–T008 audits, T016 and T025 story specs all pass against the finished styling

### Field Validation for User Story 3 (deferred milestone)

- [ ] T036 [US3] At a club meeting: hand the join link to someone who has never seen the app and watch the first thirty seconds; record any unprompted reaction verbatim in specs/002-material3-ui-redesign/findings.md

**Checkpoint**: all three stories independently functional; the app is one designed thing.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The measured gates that close the feature, and the record they leave behind.

- [ ] T037 Bundle budget audit: `npm run build`, gzip-measure dist assets; assert total ≤ 330 KB and redesign delta ≤ 20 KB vs the 304 KB baseline (research.md R4); record numbers in specs/002-material3-ui-redesign/findings.md
- [ ] T038 Slow-3G load measurement per quickstart.md: preview build under Slow 3G + 4× CPU vs the same measurement on main; assert ≤ 10 s to interactive join screen and ≤ 120% of baseline (SC-003); record in findings.md
- [ ] T039 Full quickstart.md validation pass end-to-end (all SC sections) on real hardware: one iOS Safari and one Android Chrome device
- [ ] T040 First-time tester sessions (convenience testers, not field validation): run SC-004 (report unaided ≤ 60 s) and SC-005 (name all four kinds from icon+label) with 5 testers; record pass/fail per tester in specs/002-material3-ui-redesign/findings.md
- [ ] T041 [P] Document the design system: header comment in web/src/ui/tokens.css covering regeneration, the hand-tuned block, and the frozen callsign palette; note in docs/ pointing UI contributors at contracts/design-tokens.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 → T002 → T003 (strictly sequential — the script needs the dep, the tokens need the script)
- **Foundational (Phase 2)**: needs T003. T004–T008 all [P]-eligible after it (T004 needs tokens; T005–T008 only need the repo); T009 needs T003 and informs everything after
- **User Stories (Phase 3–5)**: all need Phase 2. Priority order US1 → US2 → US3
- **Polish (Phase 6)**: T037–T039 need all stories (T033's deletion especially); T040 needs US1 at minimum; T041 anytime after Phase 2

### User Story Dependencies

- **US1 (P1)**: only Phase 2. Touches report-entry.ts + app.css sections
- **US2 (P2)**: only Phase 2 (not US1) — touches map-view.ts, satellite chip modules, basemap.ts. May run adjacent to US1 (different files) except both edit app.css: coordinate by keeping story-specific CSS in clearly separated sections
- **US3 (P3)**: T029/T030 benefit from US1's kind-identity precedent but depend only on Phase 2; T033 (legacy deletion) genuinely depends on US1 + US2 being done — it is the last styling task

### Parallel Opportunities

- Phase 2: T004, T005, T006, T007, T008 in parallel (five different files)
- US2: T020 parallel with T019 (different modules)
- US3: T032 runs after T031 (its PNGs derive from T031's SVG) but parallel with T033/T034
- Polish: T041 parallel with everything

## Parallel Example: Phase 2

```bash
# After T003 lands, launch together:
Task: "Contrast audit unit test in web/tests/unit/contrast.test.ts"
Task: "Icon module in web/src/ui/icons.ts"
Task: "Touch-target audit e2e in web/tests/e2e/targets.spec.ts"
Task: "Reduced-motion audit e2e in web/tests/e2e/reduced-motion.spec.ts"
Task: "Network audit e2e in web/tests/e2e/network-audit.spec.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phases 1–2: tokens, icons, guardrail audits, base controls
2. Phase 3: the report flow — the instrument a hunter holds
3. **STOP and VALIDATE**: US1 independent test; the app is shippable here — new report flow, old chrome elsewhere is an acceptable intermediate deploy
4. Deploy/demo

### Incremental Delivery

Each story leaves the app deployable: US1 (report flow) → US2 (status vocabulary) → US3
(join, popups, brand, legacy deletion). T033's deletion lands only in US3, so intermediate
states keep legacy variables alive for unconverted surfaces — mixed but functional.

## Notes

- The three audit e2es (T006–T008) are green from Phase 2 onward — run them after every
  story task; a red audit mid-story is a regression, not a TODO
- Both US1 and US2 edit app.css; if worked concurrently, keep sections disjoint and merge
  frequently (memory: merge, don't rebase, once pushed)
- The per-callsign palette freeze (contracts/design-tokens.md §8) is checked in T030 —
  any diff to web/src/log/colour.ts fails review
- Commit after each task or logical group; each checkpoint is a valid deploy point
