# Contract: Tour Drift Check

The maintainer-facing safeguard that keeps the tour honest (spec US3, FR-016–FR-019). Three layers;
the test is authoritative.

## Layer 1 — Drift test (authoritative)

`web/tests/unit/tour-manifest.test.ts` (Vitest, runs under `npm run test:unit` and in CI).

**Inputs**: the tour's `manifest.ts` (`anchors: string[]`, `coveredKinds: ReportKind[]`), the source
tree `web/src`, and the code's own report-kind enumeration (`ReportKind` / `KIND_BUTTONS` in
`report-entry.ts`).

**Assertions**:
1. **Every declared anchor exists** — for each string in `anchors`, at least one occurrence of that
   `data-testid` exists in `web/src`. A removed/renamed anchor fails here (FR-016/FR-017; acceptance
   US3-1).
2. **Coverage matches the code** — `coveredKinds` equals the set of contribute kinds the app exposes
   (the `KIND_BUTTONS` kinds, i.e. `bearing`, `omni`, `null`). A newly added contribute kind that the
   tour omits, or a removed kind the tour still lists, fails here (FR-017; acceptance US3-2).
3. **Every step's anchor is declared** — each `TourStep.anchor` (except the anchorless `finish`)
   appears in `anchors`. Keeps the manifest and the steps in sync.

**Non-goals** (to satisfy SC-008 "no false alarm on unrelated changes"): the test does not inspect
copy, styling, layout, or DOM shape. Editing unrelated files or markup does not trip it (acceptance
US3-3).

## Layer 2 — Claude Code hook (in-session surfacing)

A `PostToolUse` hook in `.claude/settings.json` that matches Edit/Write to tour-relevant paths and
runs the drift test, printing the outcome.

**Watched paths**: `web/src/ui/report-entry.ts`, `web/src/ui/share.ts`, `web/src/ui/join.ts`,
`web/src/ui/target.ts`, `web/src/ui/map-view.ts`, `web/src/ui/settings.ts`, `web/src/ui/tour/**`.

**Required action on failure** (FR-018): the hook output tells the editor to either update the tour
(steps/manifest) or, if the change is cosmetic, reaffirm by re-running once the anchor is restored —
stated plainly enough to act on without opening the spec.

## Layer 3 — Scope doc (definition of "significant change")

`docs/product-tour.md` (FR-019) enumerates what invalidates the tour:

- A tour-step **anchor** `data-testid` is removed, renamed, or moved to a surface the step no longer
  makes sense on.
- The set of **first-class report kinds** changes (added or removed).
- A **primary hunt-loop control** the tour walks (target, map/estimate, report bar, share) is removed
  or relocated.
- The **ordered walkthrough** itself is restructured.

Anything else — copy tweaks, styling, refactors that preserve testids — is not tour-invalidating.

## Success measure

For the SC-008 suite (rename an anchor; add a report kind; remove a primary control) the test fails
before the change is "done"; for a matched suite of unrelated edits it stays green.
