# Phase 1 Data Model: First-Visit Product Tour

All entities are client-side. Only `TourState` is persisted (device-scoped `meta` store). Nothing
here is part of the append-only report log.

## Tour

The ordered walkthrough as a whole. Static, defined in code (`steps.ts` + `manifest.ts`).

| Field          | Type                    | Notes                                                                                                                                                       |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`      | number (`TOUR_VERSION`) | Stamped into `TourState` on completion. A bump does not re-offer (spec FR-013).                                                                             |
| `steps`        | `TourStep[]`            | Ordered; index is the presentation order.                                                                                                                   |
| `coveredKinds` | `ReportKind[]`          | The report kinds the tour claims to teach. Drift test asserts equality with the code's `KIND_BUTTONS` (the "every radio" kinds: `bearing`, `omni`, `null`). |

**Validation**: `steps` non-empty; each `step.anchor` present in the anchor manifest; `coveredKinds`
exactly the contribute kinds enumerated in `report-entry.ts`.

## TourStep

One stop in the walkthrough.

| Field    | Type                   | Notes                                                                                                               |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`     | string                 | Stable step identifier (e.g. `target`, `estimate`, `bearing`, `omni`, `null`, `share`, `finish`).                   |
| `anchor` | string (`data-testid`) | The control this step points at. Must exist in `web/src`. `finish` may be anchorless (centered).                    |
| `title`  | string                 | Plain-language heading. Hunter vocabulary only.                                                                     |
| `body`   | string                 | Plain-language explanation. No NRQ/DFS/PHG (vocabulary test).                                                       |
| `sample` | boolean (optional)     | `true` for the estimate step: render the scripted credible-region sample when the live map lacks a region (FR-014). |

**Ordered steps (the fixed hunt loop, spec FR-007/008/009/010/021)**:

1. `target` → anchor `target-label` — the name of what you're hunting.
2. `estimate` → anchor `map` — the map and the current **credible region**; described as a region
   that grows less certain with poor reports, never a point (Principle I). `sample: true`.
3. `bearing` → anchor `report-bearing` — for a directional antenna / body-fade bearing.
4. `omni` → anchor `report-omni` — signal strength from any radio, incl. a stock handheld
   (the explicit stock-handheld message lives here, FR-008).
5. `null` → anchor `report-null` — "I hear nothing here" is evidence too.
6. `share` → anchor `share-hunt` — bring the team in; a teammate joins by opening the shared link.
7. `finish` → anchorless — land on a live hunt view, primed to report (FR-015); mentions relaunch.

## TourState (persisted)

Device-scoped record in the IndexedDB `meta` store under key `tour_state`. Mirrors the `relay_mode`
pattern. Never in the report log; never synced.

| Field       | Type                                    | Notes                                       |
| ----------- | --------------------------------------- | ------------------------------------------- |
| `status`    | `'unseen' \| 'completed' \| 'declined'` | Drives whether the first-run offer appears. |
| `version`   | number                                  | The `TOUR_VERSION` the device last saw.     |
| `updatedAt` | number (epoch ms)                       | Last transition time.                       |

Absence of the record is treated as `status: 'unseen'`.

**State transitions**:

```text
(no record / unseen) --offer accepted, all steps done--> completed
(no record / unseen) --offer dismissed / exited early---> declined
completed | declined  --relaunch from settings---------->  (runs; on finish -> completed;
                                                            on exit -> unchanged)
```

- Reaching the `finish` step → `completed`.
- Dismissing the offer, pressing ESC, tapping the scrim, or exiting mid-tour from the first-run
  offer → `declined`. Either terminal status suppresses the unprompted re-offer (FR-013).
- A relaunch from settings never sets `declined`; exiting a relaunched tour leaves prior status
  intact.

## Anchor manifest (drift surface)

Not persisted; a code artifact (`manifest.ts`) read by both the runtime and the drift test.

| Field          | Type           | Notes                                                                                                             |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `anchors`      | `string[]`     | Every `data-testid` any step depends on. Drift test asserts each exists in `web/src`.                             |
| `coveredKinds` | `ReportKind[]` | Asserted equal to the code's contribute-kind set. A newly added kind that the tour omits fails the test (FR-017). |

## Relationships

- `Tour` **has many** `TourStep` (ordered).
- Each `TourStep.anchor` **references** one entry in the anchor manifest, which **references** a real
  `data-testid` in `web/src`.
- `TourState` is per-device and independent of `Tour` content except for the `version` stamp.
