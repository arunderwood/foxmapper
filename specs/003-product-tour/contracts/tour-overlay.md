# Contract: Tour Overlay (DOM + Accessibility)

The UI contract for the running tour. Values are `data-testid` unless noted. These are stable
identifiers the e2e suite and the drift manifest depend on.

## Structure

| testid | Element | Contract |
|--------|---------|----------|
| `tour-offer` | container | The first-run offer. Present only when `tour_state.status === 'unseen'` and the participant is in a hunt view. Dismissible without side effects on the app. |
| `tour-offer-accept` | button | Starts the tour. |
| `tour-offer-decline` | button | Sets `tour_state.status = 'declined'`; removes the offer; changes nothing else. |
| `tour-overlay` | container | The running tour. `role="dialog"`, `aria-modal="true"`, `aria-label="FoxMapper tour"`. Renders a scrim with a spotlight cutout over the active step's anchor. |
| `tour-callout` | container | The step bubble: title, body, controls, progress. Positioned near the anchor; never fully covers it (FR-006). |
| `tour-step-title` | heading | The active step title. |
| `tour-step-body` | text | The active step body. |
| `tour-progress` | text | "Step N of M" (FR-005). |
| `tour-next` | button | Advance. On the last step reads as "Done" and finishes. |
| `tour-back` | button | Go to previous step; absent/disabled on the first step. |
| `tour-exit` | button | Exit the tour. |
| `replay-tour` | button (in settings sheet) | Relaunch the tour on demand (FR-003). |

## Behavior

- **Offer**: shown once per device while `unseen`. Accept → run; decline → `declined`. It never blocks
  any control beneath it (FR-001/FR-002).
- **Ordering**: steps run in the fixed order in [data-model.md](../data-model.md). `tour-progress`
  reflects position.
- **Spotlight**: the active step's anchor rect is measured and kept visible; re-measured on
  `resize`/`scroll`. If an anchor is absent at runtime, the step falls back to a centered callout with
  its copy (and, for `estimate`, the scripted sample) rather than pointing at nothing (FR-014).
- **Finish**: the last step (`finish`) sets `completed` and dismisses to a live hunt view (FR-015).

## Accessibility (FR-020)

- **Keyboard**: `→`/`Enter` advance, `←` back, `Esc` exit. `Tab` order is trapped within
  `tour-callout` while the overlay is open; focus moves to the callout when a step becomes active.
- **Dismissal**: `Esc` and a click on the scrim (outside `tour-callout`) both exit. From the
  first-run offer, exiting counts as `declined`; from a relaunch, exiting leaves status unchanged.
- **Screen reader**: each step change announces the title+body via an `aria-live="polite"` region;
  the callout is the labelled dialog.
- **Reduced motion**: when `prefers-reduced-motion: reduce` is set, all spotlight/callout transitions
  are instant (matches the existing reduced-motion e2e pattern).

## Invariants

- The overlay reads no network and writes only `tour_state` (device meta). It never appends to the
  report log.
- Declining or exiting adds zero steps to joining or reporting versus no-tour (SC-005).
- All visible copy uses hunter vocabulary; no NRQ/DFS/PHG (FR-011, vocabulary test).
