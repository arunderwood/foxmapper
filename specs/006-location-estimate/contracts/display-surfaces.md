# Contract: Display Surfaces

**Scope**: Every place a participant meets the estimate. Every string here is covered by the
vocabulary test (SC-007). Copy lives in `web/src/estimate/copy.ts`.

## 1. Settings switch (FR-028 to FR-030, FR-041)

- **Where**: the device-switch group of the settings sheet, directly after the relay switch.
- **Control**: a toggle button with `aria-pressed`, `data-testid="estimate-toggle"`.
- **Label**: "Show where the fox probably is"
- **Note under it**: "Shades the ground the reports point to. Leave it off to read the reports
  yourself."
- **On change**: persist `estimate_enabled` in the meta store, call `track('estimate_toggled',
  { enabled })`, and hand the new value to the app, which creates or disposes the estimate client.
- **Default**: off.

## 2. Map layers (FR-001, FR-002, FR-023, FR-024)

| Layer id | Type | Source | Placement |
|---|---|---|---|
| `estimate-fill` | fill, hatch pattern `estimate-hatch` | `estimate` | Below the wedge layers |
| `estimate-halo` | line, 5 px, map surface colour | `estimate` | Above the fill, below the wedges |
| `estimate-line` | line, 3 px, `--estimate` | `estimate` | Above the halo, below the wedges |
| `estimate-label` | symbol, `symbol-placement: line` | `estimate` | Along the outline |

- **Source data**: one feature per `Region`, carrying `probability` as a property for tests only.
  No style expression reads it.
- **Label text**: "fox probably inside · about 9 in 10". It is placed along the line, never at a
  point.
- **Never drawn**: a centre marker, a most-likely point, a gradient that peaks in the middle, or
  coordinates (FR-002).
- **While off**: the source is empty and the layers draw nothing (FR-031).
- `data-testid="estimate-region-count"` on the status bar carries the region count, so e2e can
  assert without reading canvas pixels.

## 3. Status-bar chips (FR-010 to FR-016, FR-032)

Shown only while the estimate is on, in this order, before the sync and queue chips. Each chip
carries `data-testid="estimate-warning"` and `data-kind`.

| Condition | Text | Family | `data-kind` |
|---|---|---|---|
| `too_few` | Too few reports to trust the shading yet | `warn` | `too_few` |
| `narrow_spread` | Reports all point the same way — distance unknown | `warn` | `narrow_spread` |
| `disagree` | The reports disagree | `warn` | `disagree` |
| status `none` | Nothing points at the fox yet | `dim` | `none` |

The chips are not dismissible. Each lasts exactly as long as its condition (FR-013).

## 4. Tour step `estimate` (spec edge case "The tour")

| State | Behaviour |
|---|---|
| Estimate off | Show the existing sample. Body gains: "Turn it on in Settings: Show where the fox probably is." |
| Estimate on, status `none` | Same as off, without the Settings line. |
| Estimate on, a region exists | No sample. Spotlight `map`. Body as today. |

The `anchor` stays `map` in every state, so the manifest drift check is unchanged.

## 5. Analytics (FR-041)

| Event | Properties | Meaning |
|---|---|---|
| `estimate_toggled` | `enabled` | The estimate was switched on or off on this device. |

A row is added to the table in `docs/analytics.md`. Nothing else about the estimate is sent: no
region, no warning, no metric.

## 6. Documents

- `docs/estimate.md` (new): the model in plain words, the four kernels, the floor, the region,
  the warnings, the reference hunts, and a link to `values.ts`. It holds no number that `values.ts`
  holds.
- `docs/log-format.md`: the sentence "No location is estimated or computed" becomes a pointer to
  `docs/estimate.md`, stating that the estimate is derived and never stored.
- `docs/README.md`: one line linking `estimate.md`.
