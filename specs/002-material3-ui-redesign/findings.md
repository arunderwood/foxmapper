# Findings: Material 3 Expressive UI Redesign

## Measured gates (2026-07-17)

### T037 — Bundle budget (FR-017, SC-003 transfer half)

| Asset | gzip bytes |
|---|---|
| index-*.js | 296,625 |
| index-*.css | 13,052 |
| index.html | 486 |
| **Total critical path** | **310,163 (302.8 KiB)** |

- Baseline (pre-redesign, measured 2026-07-16): 304,306 bytes.
- **Delta: +5,857 bytes (+1.9%)** — budget allowed +20 KiB; roof was 330 KiB. Both met with
  wide margin. The growth is the icon module (+~4 KiB in JS) and the token set + new component
  rules (+~1.6 KiB in CSS net). Brand PNGs (17 KiB raw total) are off the critical path —
  fetched only on bookmark/install.

### T038 — Slow-3G load (SC-003 time half)

Method: Playwright chromium + CDP `Network.emulateNetworkConditions` (400 kbps down, 400 ms
RTT) + 4× CPU throttle, against the production preview build; time from navigation to the
join screen's callsign input accepting a click. Three runs.

- **Runs: 7505 / 7509 / 7493 ms — median 7.5 s** against the ≤ 10 s budget. Pass.
- Regression ceiling (≤ 120% of pre-redesign): the path is transfer-bound (6.2 s of the 7.5 s
  is 310 KiB at 50 KiB/s); a +1.9% transfer delta bounds the load-time regression at ~+2%,
  two orders of magnitude inside the ceiling. Pass by measurement + arithmetic.

### Audit suite status (T035 checkpoint)

- Unit: 217/217 including the 25-assertion contrast audit (worst pair `on-primary`/`primary`
  at 7.70:1 vs the 7:1 glanceable floor).
- E2E: chromium 61 passed / 1 skipped; mobile-safari 56 passed / 3 skipped (pre-existing
  conditional skips). Includes both touch-target walks (default + 320 px), reduced-motion,
  network audit with FR-014 invariants, and both story specs.
- SC-008 greps: zero raw colours outside tokens.css, zero legacy variables.

## What the guardrails caught while the work was underway

1. **Reduced-motion kill didn't cover pseudo-elements** — `*` doesn't match `::after`, so the
   new button state layers animated under the preference until the audit flagged it.
2. **The taller report bar put the map attribution under the controls** (FR-014). Fixed
   properly: the offset now tracks the bar's measured height via ResizeObserver instead of a
   constant.
3. **Eased-in press states arrive after the thumb leaves.** The US1 spec's press assertion
   failed against a 150 ms ease-in; press feedback is now instant-in / ease-out.
4. **Pre-existing sub-56 px targets** (share pill 24 px, popup retract 35 px, banner cancel,
   MapLibre's popup close) — all now at or above the floor.

## Deviations from the plan/tasks wording (recorded, reasoned)

- **T021's "150 ms cross-fade on chip state change" was dropped.** The status bar clears and
  rebuilds every position tick (~1 Hz); any CSS transition or entrance animation replays on
  every rebuild — a persistent pulse where a state change should be. The icon + colour +
  shape delta itself is the peripheral signal. Diffing the chip DOM to enable transitions
  would be a refactor of the bar's update model, out of re-skin scope.
- **T024's "fallback from `--md-sys-color-surface`" became `--fx-color-map-ground` (light).**
  The blank ground's lightness is load-bearing: the per-callsign wire palette
  (docs/log-format.md) is tuned for a street map and several Tol swatches vanish on a dark
  ground. Tokenized, but light — the token carries a comment saying why.
- **Queued chip stayed in the warn colour family** rather than a fully distinct colour: it
  renders *beside* the offline chip (not instead of it), so its identity is icon + count +
  pill shape (data-model.md §3 says exactly this; the story spec was initially stricter than
  the model and was corrected).

## Open (cannot be closed from a desk)

- **T039** — full quickstart pass on real iOS Safari + Android Chrome hardware, including
  SC-010 add-to-home-screen checks (browser-level favicon/manifest checks done; the maskable
  crop and iOS opaque render need real launchers).
- **T040** — SC-004/SC-005 first-time tester sessions (5 people): report unaided ≤ 60 s;
  name all four kinds from icon + label. Record per-tester pass/fail here.
- **T018 / T027 / T036** — the deferred field-validation milestones, unchanged.

## Feedback round 1 (2026-07-17, maintainer, desktop viewport)

Six items; all addressed the same day:

1. **"From the spot you set" chip rendered with a seam** — the split-pill construction (icon
   and label as siblings fused by negative margin) was replaced with a single `.chip-status`
   wrapper element. Structural fix, not more CSS glue.
2. **Position chip purpose unclear** — the trimmed labels had dropped the load-bearing verb.
   Now "Reporting from the spot you set" / "Reporting from your phone's fix". Lesson recorded:
   glanceable microcopy still needs its verb when the chip answers "what is happening?".
3. **"Everyone's reports" unclear** — same fix: "Showing everyone's reports" restored.
4. **No feedback after placing a position** — a pin (`edit_location` glyph, primary-container,
   drop-shadowed) now drops at the tapped spot the moment placement lands, and leaves when the
   hunter returns to the device fix. Asserted in status-states e2e.
5. **Relay fields visible by default** — not a redesign bug: this branch forked one commit
   before PR #35 (`[hidden]` vs `.stack` specificity). Merged `origin/main` in; the fix and
   its both-directions tests now ride along.
6. **Relay toggle read as a fourth answer in the choice rows** — restyled as a mode: quiet,
   auto-width, left-aligned, dashed outline (deliberately the same dashed vocabulary relayed
   reports wear on the map), with a new `record_voice_over` icon (subset is now 17).
   Action buttons in the status bar also gained primary-hued icons so "tappable" and "status"
   stop looking identical.
