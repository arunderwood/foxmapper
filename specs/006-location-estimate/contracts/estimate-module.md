# Contract: The Estimate Module

**Scope**: `web/src/estimate/`. This is the interface the rest of the app, the tests, and later
features build on (FR-036). Types are in [data-model.md](../data-model.md).

## 1. Pure function

```ts
estimate(input: EstimateInput, values?: EstimateValues): EstimateResult
```

- Pure. It reads nothing but its arguments: no clock, no storage, no network, no `Math.random`.
- `values` defaults to the frozen release set. Tests pass variants to explore tuning. The app never
  passes anything but the default (FR-037).
- Deterministic across engines: same arguments give a byte-identical result, apart from
  `generation` (FR-018). Guaranteed by research R5 and pinned by §4.
- Order-independent: the caller sorts by `id`, and the function re-sorts defensively, so shuffled
  input gives the same result.
- Budget: 500 active reports within 2 s on a mid-range phone (SC-002).

## 2. Worker protocol

`web/src/estimate/worker.ts` wraps §1. `web/src/estimate/client.ts` is the only thing that talks
to it.

| Direction | Message | Payload |
|---|---|---|
| main → worker | `estimate` | `EstimateInput` |
| worker → main | `result` | `EstimateResult` |
| worker → main | `error` | `{ generation, message }`. The client sends it to `captureError` and keeps the previous region on screen. |

**Client rules**:
- `request(active)` builds `EstimateInput` from `FoldResult.active` and posts it. If a request is
  in flight, the new one replaces any pending request, so at most one runs and one waits.
- A result whose `generation` is older than the newest request already answered is dropped.
- `dispose()` terminates the worker. It is called when the setting goes off (FR-031) and when the
  hunt view is torn down.
- `warmUp()` fetches the worker URL once, in the background, at app start, so the service worker
  caches it for offline use (research R10). It never creates the worker.

## 3. Values

- `values.ts` exports `ESTIMATE_VALUES: Readonly<EstimateValues>` and nothing else.
- No other file under `web/src/estimate/` contains a numeric literal other than 0, 1, 2 or 0.5.
  ESLint `no-magic-numbers` enforces it, with `values.ts` and `detmath.ts` exempt.
- `detmath.ts` exports `exp`, `ln`, `sin`, `cos`, `atan2`. They are built from `+ − × ÷`,
  comparisons, and `Math.sqrt`/`floor`/`abs`/`min`/`max` only.
- A source-scan test fails if any file under `web/src/estimate/` calls another `Math` function.

## 4. Test obligations

| Test | Proves |
|---|---|
| `detmath.test.ts` | Each owned function is within 1e-12 relative error of `Math` over its used range. |
| `estimate-kernels.test.ts` | FR-004a (nothing beyond range but the floor), FR-004b (louder pulls harder, monotonic), FR-004c (a null never raises any cell), FR-005 (a find never replaces the region), FR-040 (one report cannot cut a cell by more than its floor). |
| `estimate-warnings.test.ts` | Each threshold fires on its side of the named value and not on the other. |
| `estimate-determinism.test.ts` | fast-check: shuffled input gives the same digest. Adding a retraction gives the digest without that report (FR-007). |
| `estimate-input.test.ts` | The input type drops time, clock, accuracy, placement and relay fields (FR-006, FR-008, FR-009). |
| `reference-hunts.test.ts` | SC-001 (≥ 90% coverage on the calibration batch, split by source), SC-003, SC-004, SC-006, SC-012, and each FR-038 scenario's `expect`. |
| e2e `estimate.spec.ts` | The same reference hunts give the same result digest in `chromium` and `mobile-safari` (SC-005). |
