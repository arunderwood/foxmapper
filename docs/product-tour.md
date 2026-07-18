# The product tour, and keeping it honest

FoxMapper offers first-time visitors an optional guided tour of the core hunt loop — what you're
hunting, the map and its credible-region estimate, the three ways any radio can report, and how to
bring a team in. It is a thin, client-only overlay that anchors each step to a control that already
exists. It lives in [`web/src/ui/tour/`](../web/src/ui/tour/) and is relaunchable any time from
**Settings → Take the tour**.

A tour that points at the wrong thing is worse than no tour: it teaches a newcomer something false on
their first contact with the app. This document defines what counts as a **significant change that
may invalidate the tour**, so the drift check's scope is understood and maintainable (spec FR-019).

## What the tour depends on

- **Step anchors** — each step points at a control by its `data-testid`. The current anchors are
  declared in [`manifest.ts`](../web/src/ui/tour/steps.ts) (derived from the steps): `target-label`,
  `map`, `report-bearing`, `report-omni`, `report-null`, `share-hunt`. The `finish`
  step is anchorless.
- **The set of first-class report kinds** — the tour teaches the three _contribute_ kinds
  (`bearing`, `omni`, `null`). These are `coveredKinds` in `manifest.ts`.
- **The primary hunt-loop controls** the tour walks — the target line, the map/estimate, the report
  bar and its kind buttons, and the share affordance.
- **The ordered walkthrough itself** — the fixed order in
  [`steps.ts`](../web/src/ui/tour/steps.ts), which is the hunt loop.

## What counts as a significant (tour-invalidating) change

Any of these means the tour must be updated — or explicitly reaffirmed as still correct — before the
change is done:

1. A tour-step **anchor** `data-testid` is removed, renamed, or moved to a surface where the step no
   longer makes sense.
2. The set of **first-class report kinds changes** — a new way to contribute evidence is added, or an
   existing one is removed.
3. A **primary hunt-loop control** the tour walks (target, map/estimate, report bar, share) is
   removed or relocated.
4. The **ordered walkthrough** is restructured.

Anything else — copy tweaks, styling, refactors that preserve the testids and the kind set — is **not**
tour-invalidating.

## How the drift check draws the line on report kinds

The app ships four report kinds (`KIND_BUTTONS` in
[`report-entry.ts`](../web/src/ui/report-entry.ts)): `bearing`, `omni`, `null`, and `fix`. The tour
covers the first three — the ways any radio contributes evidence to the estimate (Principle II,
FR-008). `fix` ("found the fox") is the _end_ of a hunt, not a way to contribute evidence, so the
first-visit tour deliberately leaves it out (FR-021).

The drift test does not hard-code that exclusion. It asserts that `coveredKinds ∪ uncoveredKinds`
equals the app's whole report-kind set, where `uncoveredKinds` names the kinds left out on purpose
(today: `fix`). The consequence is the useful part: **a genuinely new report kind fails the check**
until a maintainer either gives it a tour step and adds it to `coveredKinds`, or — if it is not a way
to contribute evidence — adds it to `uncoveredKinds`. The omission is always a conscious, reviewed
decision, never a silent gap.

## The check itself

Three layers, the test being authoritative (contract:
[`tour-drift-check.md`](../specs/003-product-tour/contracts/tour-drift-check.md)):

1. **Drift test** — [`web/tests/unit/tour-manifest.test.ts`](../web/tests/unit/tour-manifest.test.ts),
   run by `npm run test:unit` and in CI. Asserts every anchor exists as a `data-testid` in
   `web/src`; that covered + omitted kinds equal the shipped kinds; and that every step's anchor is
   declared. It reads no copy, styling, or layout, so unrelated edits never trip it.
2. **Claude Code hook** — a `PostToolUse` hook
   ([`.claude/settings.json`](../.claude/settings.json) →
   [`.claude/hooks/check-tour-drift.sh`](../.claude/hooks/check-tour-drift.sh)) runs the drift test
   after an edit to a watched path (`report-entry.ts`, `share.ts`, `join.ts`, `target.ts`,
   `map-view.ts`, `settings.ts`, `web/src/ui/tour/**`) and, on failure, prints the required action.
3. **This document** — the human-readable definition of scope above.

Run it directly:

```bash
cd web && npm run test:unit -- tour-manifest
```
