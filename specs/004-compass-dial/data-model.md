# Phase 1 Data Model: Visual Compass Dial for Bearing Entry

This feature persists **no new data** and adds **no field**. It removes two fields from one payload
and introduces one ephemeral, never-persisted interaction state machine. The authority for the wire
format is [`docs/log-format.md`](../../docs/log-format.md); the delta is pinned in
[contracts/log-format-delta.md](contracts/log-format-delta.md).

## 1. `bearing` payload (modified — two fields removed)

**Before** (feature 001):

| Field | Type | Required | Kept? |
|---|---|---|---|
| `heading_true` | number 0–359.9 | yes | **kept** |
| `heading_magnetic` | number 0–359.9 | yes | **kept** |
| `declination` | number | yes | **kept** |
| `wmm_epoch` | string | yes | **kept** |
| `heading_source` | enum `compass`\|`manual` | yes | **REMOVED** |
| `compass_accuracy_deg` | number | no | **REMOVED** |
| `confidence_q` | integer {3,4,5} authored | yes | **kept, unchanged** |
| `max_range_r` | integer {1,3,5} authored | yes | **kept, unchanged** |

**After**: the same payload without the two removed rows.

**Why removed**: both were write-only. No renderer, wedge, layer, or fusion path reads them, and the
APRS mapping carries only `heading_true`, `confidence_q`, `max_range_r`. A bearing is a bearing —
the log does not record where the number came from (spec FR-010).

**Validation rules** (unchanged): `heading_magnetic` is normalized to `[0, 360)`; `heading_true`
is derived from `heading_magnetic + declination` and normalized; `confidence_q` ∈ {3,4,5} and
`max_range_r` ∈ {1,3,5} are both required at authoring — the dial changes how `heading_magnetic` is
produced, nothing else about the payload's constraints.

**Back-compat**: reports that still carry the removed fields (older devices, foreign/ingested logs)
remain valid; ingest ignores the extra keys. No migration; append-only immutability is preserved.

## 2. Removed type

`HeadingSource` (`'compass' | 'manual'`) in `web/src/log/types.ts` is deleted along with its two
usages in the payload. `report/bearing.ts` drops `heading_source` and `compass_accuracy_deg` from
`BearingDraft`, `BearingEntry`, and the object `composeBearing` assembles.

## 3. Dial interaction state (ephemeral — never persisted)

The dial component owns a small state machine that lives only for the duration of one entry and
leaves **no trace in the log** — only the resulting `heading_magnetic` does. Full transition rules
are in [contracts/bearing-entry.md](contracts/bearing-entry.md); the shape:

| State | Meaning | Committed heading? | Send enabled? |
|---|---|---|---|
| `idle` | No-compass device / relay path, or iOS before the start tap. Rose shown, not tracking. | no | no |
| `live` | Rose tracking the (damped) device heading under the fixed index. | no — a live stream is not a commit | no |
| `frozen` | A captured heading is held under the index. | yes | yes (with confidence + range) |
| `by-hand` | Heading set by twisting; sensor detached. Reached from `frozen`, `live`, or `idle` via a twist. | yes | yes (with confidence + range) |

**Committed heading**: `number | undefined`, undefined until the first freeze or twist (mirrors the
existing `magnetic: number | undefined` guard). This is the single value the sheet reads back into
`composeBearing`.

**Transitions** (summary): `idle → live` (auto on open where allowed, else on start tap);
`live → frozen` (freeze); `frozen ⇄ live` (re-take — re-entering `live` clears the commit);
`{idle,live,frozen} → by-hand` (any twist; detaches the sensor). See the contract for the full table.

## 4. What the sheet passes to `composeBearing`

Unchanged except for the two dropped fields: `{ heading_magnetic, confidence_q, max_range_r }` plus
the author context (position, time, observer/operator). The composer computes `heading_true`,
`declination`, and `wmm_epoch` exactly as today. There is no longer a `heading_source` or
`compass_accuracy_deg` to thread through.
