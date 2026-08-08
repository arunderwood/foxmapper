# Quickstart: Validating True North Bearings

**Feature**: 005-true-north-bearings

How to prove the feature works end-to-end. References:
[spec.md](spec.md) success criteria, [contracts/reference-entry.md](contracts/reference-entry.md),
[contracts/display-surfaces.md](contracts/display-surfaces.md).

## Prerequisites

```bash
cd web && npm install
```

Known local hazards (maintainer's notes):

- **Stale preview server**: Playwright reuses a server already listening on :4173, which may serve
  an old bundle. Kill anything on that port before an e2e run.
- **Service worker**: the cache-first SW can serve stale modules on the Vite dev server. When
  verifying by hand, clear the SW/site data first.
- The relay server needs the docker compose stack, but nothing in this feature touches the
  server — unit + e2e (which stub the relay) are sufficient.

## Static checks and unit tests

```bash
cd web && npm run typecheck && npm run lint && npm run test:unit
```

Unit coverage that must exist and pass (Vitest):

- `declination.test.ts` — `toMagneticHeading` inverse round-trip law; `describeDeclination`
  east/west/near-zero/stale strings.
- `report.test.ts` — compose from `{heading, reference:'true'}` stores `heading_true` verbatim
  and derives magnetic; from `'magnetic'` the reverse; invariant
  `heading_true = normalize(heading_magnetic + declination)` on both paths.
- `compass-dial.test.ts` / `reference.test.ts` — transition table from the entry contract §3:
  live forces true; converted samples reach the smoother; chip switch converts displayed and
  committed values; defaults per surface (§2); switch preview shows the converted number.
- `vocabulary.test.ts` — deny-list extended ("declination" outside settings copy, "WMM", epochs).

## End-to-end (Playwright)

```bash
cd web && npm run test:e2e
```

The new `true-north.spec.ts` (plus edits to `compass-dial.spec.ts`, `relay.spec.ts`) proves the
success criteria with a mocked sensor at a fixed position with known declination (pick Bellingham,
decl ≈ +15.5°E, so offsets are unmistakable):

1. **SC-001 / Story 1** — Mock `deviceorientation` so the compass reads magnetic 344.5°. Draft and
   freeze: the field shows `0.0 ° true`; send with confidence + range; assert the wedge
   centerline geometry is due north (query the rendered feature, `heading_true === 0` within
   0.1°). The displayed number, its label, and the wedge agree.
2. **SC-002 / Story 2** — Arm a relay target at a hand-set position; open the bearing sheet: field
   unit reads `° magnetic` (default), type `220`, assert the switch face reads `= 235.5° true`;
   tap nothing else, send; popup/payload shows `heading_magnetic === 220` exactly and
   `heading_true === 235.5 ± 0.1`. Zero arithmetic performed by the operator.
3. **SC-003** — In flow 1, count reference decisions: none (no chip interaction required). In flow
   2: at most the single optional chip tap.
4. **Story 3 / SC-005** — Open a bearing popup: line reads `Bearing 235° true (220° on a magnetic
   compass)`. Open Settings from the hunt screen: declination line present with east/west wording
   and model vintage; with a mocked out-of-window date, the out-of-date sentence appears.
5. **Offline (FR-007)** — Run flow 1–2 with the network stubbed offline (existing offline.spec
   harness): identical results.
6. **Chip conversion sanity** — Freeze a compass value in flow 1, tap the chip: number converts to
   magnetic (344.5), direction unchanged; tap back: exact original restored (no drift at 0.1°
   display precision).

## Manual smoke (optional, real device)

Dev server (`npm run dev`), phone on the LAN, outdoors away from metal:

- Point the phone at a landmark you can see on the map; freeze; send. The wedge lies along the
  landmark (Story 1's field validation, indoors-approximated).
- Compare Settings' declination line against NOAA's published value for your location.

## Expected outcome

All commands exit green; e2e flows 1–6 pass; no visual regression in the bearing sheet beyond the
added chip/unit label. The feature is done when `/speckit-tasks`-generated work is complete and
this quickstart runs clean.
