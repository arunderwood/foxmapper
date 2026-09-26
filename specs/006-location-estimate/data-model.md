# Data Model: Location Estimate

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Nothing here is written to the report log, and the log format does not change (FR-025). Every entity
below is derived state computed on a device, or a device-local setting.

## 1. EstimateInput

What the main thread sends the worker. Built from `FoldResult.active`.

| Field | Type | Rule |
|---|---|---|
| `reports` | `EstimateReport[]` | Sorted by `id`, ascending. Only active, non-retracted observation reports (FR-007). |
| `generation` | integer | Increments per request. A result for an older generation is dropped (research R10). |

**EstimateReport** is a discriminated union holding only what the kernels read:

| `kind` | Fields |
|---|---|
| `bearing` | `id`, `position {lat, lon}`, `heading_true`, `confidence_q`, `max_range_r` |
| `omni` | `id`, `position`, `strength_s` |
| `null` | `id`, `position` |
| `fix` | `id`, `position` |

Absent by construction: `observed_at`, `clock_offset_ms`, `position_accuracy_m`, `position_source`,
`observer`, `entered_by`. The estimate cannot weight by age, clock, accuracy, hand placement, or
relay, because it never receives them (FR-006, FR-008, FR-009).

## 2. EstimateValues

The one documented set of named numbers (FR-033 to FR-035). One frozen object in
`web/src/estimate/values.ts`. Each field has a doc comment giving its unit and reason.

| Group | Field | Initial value | Unit |
|---|---|---|---|
| Region | `REGION_LEVEL` | 0.9 | share of probability |
| Grid | `GRID_CELLS_PER_SIDE` | 128 | cells |
| Grid | `REFINE_LEVEL` | 0.999 | share of probability |
| Grid | `REFINE_PAD_FRACTION` | 0.1 | of the refine box side |
| Bearing | `BEARING_SIGMA_FRACTION` | 0.5 | of the wedge half-width |
| Bearing | `BEARING_RANGE_TAPER` | 0.1 | of the stated range |
| Bearing | `BEARING_FLOOR` | 0.02 | kernel floor |
| Omni | `OMNI_MEDIAN_KM` | weak 8, medium 2, strong 0.4 | km |
| Omni | `OMNI_STRENGTH_BUCKETS` | weak 1–3, medium 4–6, strong 7–9 | strength digit |
| Omni | `OMNI_LOG_SD` | 1.2 | natural-log units |
| Omni | `OMNI_REACH_KM` | 40 | km |
| Omni | `OMNI_FLOOR` | 0.1 | kernel floor |
| Null | `NULL_CLEAR_INNER_KM` | 0.5 | km |
| Null | `NULL_CLEAR_OUTER_KM` | 1.5 | km |
| Null | `NULL_FLOOR` | 0.25 | kernel floor |
| Fix | `FIX_SIGMA_KM` | 0.1 | km |
| Fix | `FIX_FLOOR` | 0.02 | kernel floor |
| Support | `SUPPORT_FLOOR_MULTIPLE` | 2 | × a kernel's floor |
| Warning | `TOO_FEW_REPORTS` | 3 | positive reports |
| Warning | `NARROW_SPREAD_DEG` | 30 | degrees |
| Warning | `SPREAD_NEAR_KM` | 0.5 | km |
| Warning | `SAME_PLACE_KM` | 0.05 | km |
| Warning | `SECOND_PLACE_SHARE` | 0.15 | share of probability |
| Warning | `CONFLICT_AGREEMENT` | 0.1 | normalized agreement, shared across the active reports |

**Validation** (a unit test): every floor lies in (0, 1); `NULL_CLEAR_INNER_KM` <
`NULL_CLEAR_OUTER_KM`; the omni medians fall as strength rises (FR-004b: louder pulls harder);
`REGION_LEVEL` is 0.9 (FR-003).

**Lifecycle**: changed only by a maintainer, in a release, and only when the reference hunts pass
(FR-037). There is no runtime override, no per-hunt value, and no settings path.

## 3. EstimateResult

What the worker returns. This is the exposed surface of FR-036.

| Field | Type | Meaning |
|---|---|---|
| `generation` | integer | Echoes the request. |
| `status` | `'none'` \| `'estimate'` | `none` when no positive report exists (FR-015). |
| `regions` | `Region[]` | Empty when `status` is `none`. Sorted by `probability`, descending, then by first cell index. |
| `level` | number | `REGION_LEVEL`. The regions' probabilities sum to at least this. |
| `metrics` | `EstimateMetrics` | The measured values behind each warning. |
| `warnings` | `WarningKind[]` | Derived from `metrics` and `EstimateValues`. Stable order: `too_few`, `narrow_spread`, `disagree`. |
| `values_digest` | string | SHA-256 of the canonical `EstimateValues`, so a test can tell which release's values produced a result (spec edge case: two devices on different releases). |

**Region**

| Field | Type | Meaning |
|---|---|---|
| `geometry` | GeoJSON `MultiPolygon` | Longitude/latitude, rounded to 1e-6°. Holes allowed: ground a "heard nothing" cleared. |
| `probability` | number | Share of the whole estimate's probability inside this region. |

**EstimateMetrics**

| Field | Type | Warning it drives |
|---|---|---|
| `positive_reports` | integer | `too_few` when below `TOO_FEW_REPORTS` |
| `observer_span_deg` | number \| `null` | `narrow_spread` when below `NARROW_SPREAD_DEG`. `null` when an observer is within `SPREAD_NEAR_KM` of the centre, which means the warning does not apply. |
| `second_place_share` | number | `disagree` when at least `SECOND_PLACE_SHARE` |
| `min_agreement` | number | `disagree` when below `CONFLICT_AGREEMENT` / `active_reports` |
| `active_reports` | integer | Every active report, "heard nothing" included. Shares the conflict level across the reports, so the lowest of several honest reports is not read as a conflict. |

`min_agreement` is one aggregate number. No per-report agreement leaves the worker, so nothing can
rank or label a report by how well it agrees (FR-026).

**Rules**:
- Same `EstimateInput` and same `EstimateValues` → byte-identical `EstimateResult`, apart from
  `generation`, in every engine (FR-018, research R5).
- `status: 'none'` ⇔ no active `bearing`, `omni` or `fix` report.
- Region probabilities sum to ≥ `REGION_LEVEL` and < `REGION_LEVEL` + the probability of the last
  admitted cell.

## 4. WarningKind

| Kind | Copy (participant-facing) | Chip family |
|---|---|---|
| `too_few` | "Too few reports to trust the shading yet" | `warn` |
| `narrow_spread` | "Reports all point the same way — distance unknown" | `warn` |
| `disagree` | "The reports disagree" | `warn` |
| (status `none`) | "Nothing points at the fox yet" | `dim` |

`disagree` has two triggers (FR-012 and FR-012a) and one chip. Copy is defined once, in
`web/src/estimate/copy.ts`, and checked by the vocabulary test (SC-007).

## 5. EstimateSetting

| Field | Store | Key | Default | Rules |
|---|---|---|---|---|
| `enabled` | IndexedDB meta store (device-scoped, as `relay_mode`) | `estimate_enabled` | absent ⇒ off (FR-029) | Survives restarts, hunts, offline (FR-030). Never in the log, never sent to the hunt server. |

**State transitions**:

```text
off ──(Settings toggle)──▶ on      creates the worker, requests an estimate,
                                   sends estimate_toggled {enabled: true}
on  ──(Settings toggle)──▶ off     terminates the worker, clears the region and its chips,
                                   sends estimate_toggled {enabled: false}
```

## 6. ReferenceHunt

Test data only. Never shipped in the app bundle.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Scenario name, for example `one-wrong-bearing`. |
| `source` | `'simulated'` \| `'recorded'` | FR-039. Every coverage claim reports the split. |
| `fox` | `{lat, lon}` | Known transmitter position. |
| `reports` | `EstimateReport[]` | Simulated: generated from a named seed. Recorded: taken from a real hunt's log export. |
| `expect` | object, optional | Scenario assertions: required warnings, `status`, whether the fox is inside. |

Simulated hunts come from `web/tests/reference/simulate.ts` and a seed list. Recorded hunts live
under `web/tests/reference/recorded/` as JSON, each with a README line saying how its fox position
was confirmed.
