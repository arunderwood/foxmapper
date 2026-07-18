# Phase 0 Research: First-Visit Product Tour

Decisions that resolve the plan's open questions. Each is a choice made here so Phase 1 and tasks can
proceed without ambiguity.

## 1. Instrumentation form (the "keep the tour current" mechanism)

The one decision explicitly deferred to planning (clarify session: "let planning decide").

**Decision**: A **layered safeguard** with a deterministic test as the source of truth, a Claude Code
hook to surface it in-session, and a scope doc:

1. **Drift test** — `web/tests/unit/tour-manifest.test.ts` (Vitest). The tour declares, in
   `manifest.ts`, the exact set of `data-testid` anchors it depends on and the set of report kinds it
   covers. The test fails if (a) any declared anchor string is not found in `web/src`, or (b) the
   covered report-kind set is not equal to the code's own `ReportKind` / `KIND_BUTTONS`. This is the
   teeth behind FR-016/FR-017/FR-019 and runs in CI and on every local `npm run test:unit`.
2. **Claude Code hook** — a `PostToolUse` hook in `.claude/settings.json` that, after an Edit/Write to
   a tour-relevant path (`web/src/ui/report-entry.ts`, `share.ts`, `join.ts`, `target.ts`,
   `map-view.ts`, `settings.ts`, or anything under `web/src/ui/tour/`), runs the drift test and prints
   the result. This puts FR-017's flag and FR-018's required action in front of whoever (human or
   agent) is making the change, in-session, rather than only at CI time.
3. **Scope doc** — `docs/product-tour.md` documents what counts as a tour-invalidating change
   (FR-019), so the test's coverage is understood and maintainable.

**Rationale**: The test is deterministic, runs everywhere, and is the hardest to bypass — it does not
depend on an agent choosing to honor a rule. The hook is what makes it *Claude Code instrumentation*
per the request: it fires exactly when tour-relevant code changes and states the required action. The
doc keeps the definition of "significant change" out of code comments and in one referenceable place.

**Alternatives considered**:
- *Hook only (no test)*: rejected — a hook fires only inside Claude Code sessions; a human editing in
  an IDE, or CI, would never see the drift. Fails the "hardest to bypass" bar and FR-017's intent.
- *Skill/rule doc only*: rejected — relies entirely on the agent reading and honoring a checklist; no
  hard failure. Weakest guarantee; acceptable only as the doc layer, which we keep.
- *Snapshot of rendered DOM*: rejected — brittle against unrelated markup changes, high false-alarm
  rate, violating SC-008's "no false alarm on unrelated changes."

## 2. Anchor strategy

**Decision**: Steps anchor to existing `data-testid` attributes (the repo-wide convention). Two new
testids are added: `data-testid="map"` on the MapLibre container (the estimate step's anchor) and
`data-testid="replay-tour"` on a new relaunch entry in the settings sheet. The manifest lists every
anchor string the tour uses.

**Rationale**: `data-testid` is already the stable, greppable identifier used by every UI module and
the e2e suite. Reusing it means the drift test is a simple substring/AST search over `web/src`, and
the tour rides the same anchors the tests already depend on — so a rename that breaks a test also
trips the tour check.

**Alternatives considered**: dedicated `data-tour="..."` attributes (rejected — a second parallel
anchor namespace to maintain, and it wouldn't piggyback on existing test coverage); CSS selectors
(rejected — brittle, couples the tour to styling).

## 3. Overlay + spotlight technique

**Decision**: A single full-viewport scrim element with a "spotlight" cutout over the anchored
control, plus a positioned callout bubble carrying the step copy and controls. Reuse the existing
`role="dialog"` / `aria-label` sheet conventions and the `el()` DOM helper. The cutout is achieved by
reading the anchor's bounding rect and rendering the scrim as four rects around it (or a box-shadow
spotlight), re-measured on resize/scroll so the highlighted control stays visible (FR-006).

**Rationale**: No framework is in play and none is warranted; the app already builds overlays this
way. A rect-based spotlight keeps the target both visible and un-obscured on phone viewports, which
the "small screens" edge case requires. Honoring `prefers-reduced-motion` is already an established
pattern (existing e2e spec) — transitions collapse to instant when it is set.

**Alternatives considered**: a third-party tour library (e.g. driver.js/shepherd) — rejected: adds a
runtime dependency and its own vocabulary/markup for a ~250-line need, and would have to be re-taught
the offline and a11y constraints anyway. Constitution leans to "smallest thing."

## 4. Estimate-step sample when the map is empty (FR-014)

**Decision**: `sample.ts` provides a small, fixed set of illustrative reports whose derived
credible-region is rendered (or a pre-baked region drawn) purely for the estimate step, shown only
when the live log has too few reports to display a region. It is visually marked as an example and is
never written to the log.

**Rationale**: Satisfies FR-014 (the step always has something to point at) without depending on live
data, tiles, or the network — so it holds up offline and on a brand-new hunt. Honest Uncertainty
(Principle I) is preserved because the sample *shows a credible region*, demonstrating the exact
honesty the product promises rather than a false point.

**Alternatives considered**: point the step at an empty map with text only (rejected — weakest
teaching moment, and risks implying the estimate is a point); require ≥3 real reports before the step
runs (rejected — first-timers usually have an empty hunt).

## 5. Tour state schema + versioning

**Decision**: One `meta` record under key `tour_state`: `{ status: 'unseen' | 'completed' |
'declined', version: number, updatedAt: number }`. A module constant `TOUR_VERSION` stamps the tour
content. Per the clarify decision, a version increase is recorded but does **not** by itself re-offer
the tour; re-surfacing after a material change is decided per-update and is out of scope here.

**Rationale**: Mirrors the existing device-scoped `relay_mode` meta pattern exactly — offline, no
account, not in the shared log (Principle IV). Storing `version` now costs nothing and leaves the door
open for a future, deliberately-chosen re-offer behavior without a migration.

**Alternatives considered**: `localStorage` (rejected — the app standardizes persistence on the
IndexedDB `meta` store; splitting state across stores is avoidable complexity); a boolean "seen" flag
(rejected — loses the declined/completed distinction and the version, both cheap to keep).

## 6. First-run offer trigger and relaunch placement

**Decision**: The offer appears the first time a participant reaches a **hunt view** (not the landing
`start` screen), where the anchored controls exist, when `tour_state.status === 'unseen'`. It is a
dismissible offer, not an auto-play. Relaunch lives as a "Take the tour" entry in the settings sheet
(`data-testid="replay-tour"`), available any time (FR-003).

**Rationale**: The buttons and fields the tour describes only exist inside a hunt, so offering there
is where the walkthrough is coherent (recorded as the spec's first-time assumption). Settings is the
established, device-scoped home for "about this device" affordances (same place as relay mode), so
relaunch belongs beside it rather than adding a new chrome element.

**Alternatives considered**: auto-start on first hunt view (rejected — violates the "offered, not
forced" reading of FR-001 and the zero-friction decline of FR-002/SC-005); a dedicated persistent "?"
help button (rejected for v1 — more chrome than the smallest thing needs; can be revisited if
settings proves undiscoverable in usability testing).

## Resolved unknowns

All Technical Context items are concrete; no `NEEDS CLARIFICATION` remains. The estimate-step anchor
and the relaunch affordance are the only two new `data-testid`s; everything else the tour points at
already exists.
