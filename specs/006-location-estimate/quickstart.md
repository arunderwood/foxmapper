# Quickstart: Validating the Location Estimate

**Feature**: 006-location-estimate

How to prove the feature works end to end. References: [spec.md](spec.md) success criteria,
[contracts/estimate-module.md](contracts/estimate-module.md),
[contracts/display-surfaces.md](contracts/display-surfaces.md), [data-model.md](data-model.md).

## Prerequisites

```bash
cd web && npm install
```

Known local hazards:

- **Stale preview server**: Playwright reuses a server already listening on :4173, which may serve
  an old bundle. Stop anything on that port before an e2e run.
- **Service worker**: the cache-first service worker can serve stale modules on the Vite dev server.
  Clear site data before checking by hand.
- **Relay**: the e2e suite needs the relay. Run it in the docker compose stack, as for every other
  e2e run in this repo.

## 1. Static checks and unit tests

```bash
cd web && npm run typecheck && npm run lint && npm run test:unit
```

Expected:

- `lint` fails on any numeric literal under `web/src/estimate/` outside `values.ts` and
  `detmath.ts` (FR-035).
- Every test named in [estimate-module.md §4](contracts/estimate-module.md) passes.
- `vocabulary.test.ts` passes with the estimate word list (SC-007).

## 2. Reference hunts (SC-001, SC-003, SC-004, SC-006, SC-012)

```bash
cd web && npx vitest run tests/unit/reference-hunts.test.ts --reporter=verbose
```

Expected output includes one coverage line, for example:

```text
coverage 0.9xx on 1000 simulated, 0 recorded — simulated only: self-consistency, not field accuracy
```

Pass conditions:

- Coverage ≥ 0.90 on the calibration batch (SC-001). The line states the simulated/recorded split
  (FR-039).
- Every FR-038 scenario meets its `expect`: the matching warning appears (SC-003), the null-only
  hunt has status `none` (SC-004), and the wrong-bearing hunt contains the fox and shows
  `disagree` (SC-012).
- Removing signal-strength and "heard nothing" reports changes the result digest in every scenario
  that has them (SC-006).

## 3. Tuning loop (maintainers only, FR-037)

1. Edit one value in `web/src/estimate/values.ts`, with its reason.
2. Run step 2.
3. Accept the change only if every pass condition still holds. Put the old and new coverage lines in
   the PR description.

## 4. End to end

```bash
cd web && npx playwright test tests/e2e/estimate.spec.ts
```

Scenarios the spec must cover:

| Scenario | Proves |
|---|---|
| Join a hunt with the estimate never switched: no `estimate-warning` chip, `estimate-region-count` is 0 | FR-029, SC-011, scenario 12 |
| Turn it on in Settings: two crossing bearings give one region and no `too_few` chip after a third report | FR-001, FR-010, scenario 1 |
| One bearing only: region present, `too_few` chip present | Scenario 2 |
| Two groups pointing apart: two regions, `disagree` chip | FR-012, scenario 6 |
| Only "heard nothing": region count 0, `none` chip | FR-015, scenario 10 |
| Retract a report: region recomputes on a second device | FR-007, scenario 9 |
| Turn it off: region and chips gone at once, second device unchanged | FR-031, scenario 13 |
| Reload offline with it on: still on, region drawn | FR-020, FR-030, scenario 14 |
| First switch-on while offline, after one online load: region drawn | Research R10 (worker cached) |
| Same reference hunts in `chromium` and `mobile-safari`: same result digest | SC-005, FR-018 |
| 500 reports, Chromium CPU throttled 4×: region updates within 2 s | SC-002 |
| `estimate_toggled` captured with only `enabled` (analytics stubbed) | FR-041 |

## 5. By hand (5 minutes)

1. Start the app, join a hunt, and file three bearings from three spots around one point.
2. Open Settings and turn on "Show where the fox probably is". Expect a hatched region with its
   label along the edge, and no warning chip.
3. File a "heard nothing" inside the region. Expect the region to move or gain a hole.
4. Turn on airplane mode and file a signal-strength report. Expect the region to update within
   seconds.
5. Turn the estimate off. Expect the map to look exactly as before this feature.

## 6. Field validation (deferred milestone)

Not a gate. See the spec's Field Validation entry and SC-008 and SC-009. When a real hunt happens,
export its log and add it under `web/tests/reference/recorded/` with how the fox position was
confirmed (FR-039).
