# Quickstart: First-Visit Product Tour

Runnable validation for the tour and its drift safeguard. Assumes the FoxMapper docker-compose dev
stack (or `web/` dev server) is up. Commands run from `web/` unless noted.

## Prerequisites

- Node toolchain for `web/` installed (`npm ci`).
- Dev server: `npm run dev` (or the compose stack), then open a hunt (any hunt code) so a hunt view
  renders — the tour is offered there, not on the start screen.

## Validate the tour experience (US1, US2)

Fresh-device offer and full walkthrough:

1. Clear site data (or use a fresh browser profile) so `tour_state` is `unseen`.
2. Open a hunt view. **Expect** the `tour-offer` to appear, dismissible.
3. Accept. Step through with the **keyboard** (`→`/`Enter` forward, `←` back, `Esc` exit).
   **Expect** each step to spotlight the control named in [data-model.md](data-model.md) in order:
   target → estimate → report bar → bearing → omni → null → share → finish. `tour-progress` shows
   "Step N of M".
4. At the **estimate** step on an empty hunt, **expect** the scripted credible-region sample to show
   a *region* (not a point), marked as an example.
5. At **omni**, **expect** the copy to state a stock handheld can contribute.
6. At **share**, **expect** it to point at the share affordance and say joining needs no account or
   install.
7. Finish. **Expect** to land on a live hunt view and `tour_state.status === 'completed'`; reopening
   the hunt does **not** re-offer.

Decline path: fresh device → open hunt → dismiss the offer. **Expect** `declined`, no re-offer, and
joining/reporting available with no extra steps (SC-005).

Relaunch: open settings → `replay-tour`. **Expect** the tour to run again; exiting it leaves the
stored status unchanged.

## Validate accessibility (FR-020)

- Run the tour with only the keyboard end to end; confirm focus stays within `tour-callout` and each
  step is announced (aria-live).
- Set `prefers-reduced-motion: reduce`; confirm transitions are instant.
- `Esc` and a scrim click both exit.

These are covered by `web/tests/e2e/tour.spec.ts`:

```bash
npm run test:e2e -- tour
```

## Validate offline (FR-012, SC-004)

In the e2e spec, load a hunt, go offline (Playwright `context.setOffline(true)`), then run the tour
start→finish. **Expect** every step to work and `completed` to persist. No network request is made by
the tour (cross-check with the existing network-audit approach).

## Validate the drift check (US3, SC-008)

Authoritative test:

```bash
npm run test:unit -- tour-manifest
```

Should pass on a clean tree. Then confirm it *fails* on real drift:

- Temporarily rename a watched anchor (e.g. `report-omni` → `report-signal`) in
  `web/src/ui/report-entry.ts` → **expect** `tour-manifest` to fail naming the affected step.
- Temporarily add a new `ReportKind` to `report-entry.ts` without adding a tour step → **expect** the
  coverage assertion to fail.
- Make an unrelated edit (a comment, a style) → **expect** the test to stay green (no false alarm).

Revert the temporary changes.

Claude Code hook: after editing a watched path in a Claude Code session, **expect** the drift test to
run automatically and its result (and the required action on failure) to be printed.

## Definition of done for validation

- All acceptance scenarios in [spec.md](spec.md) pass by the steps above.
- `npm run test:unit` and `npm run test:e2e` green; `npm run typecheck` and `npm run lint` clean.
- Drift check demonstrably fails on the three SC-008 drift cases and passes on unrelated edits.
