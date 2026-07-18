# Contract: Tour State (persistence)

Device-local persistence for whether the tour has been seen. Stored in the existing IndexedDB `meta`
object store via `getMeta`/`setMeta` (`web/src/log/store.ts`) — the same mechanism as `relay_mode`.

## Key

`tour_state`

## Value shape

```ts
interface TourState {
  status: 'unseen' | 'completed' | 'declined';
  version: number;   // TOUR_VERSION last seen
  updatedAt: number; // epoch ms
}
```

- A missing record is read as `{ status: 'unseen', version: 0, updatedAt: 0 }`.

## Operations

| Operation | Effect |
|-----------|--------|
| `readTourState(db)` | Returns the record or the `unseen` default. Pure read; no write. |
| `markCompleted(db)` | Sets `status: 'completed'`, `version: TOUR_VERSION`, `updatedAt: now`. |
| `markDeclined(db)` | Sets `status: 'declined'`, `version: TOUR_VERSION`, `updatedAt: now`. |

## Rules

- **Offer gating**: the first-run offer appears only when `status === 'unseen'`.
- **No re-offer on version bump** (FR-013): raising `TOUR_VERSION` alone does not change a stored
  `completed`/`declined` back to `unseen`. Any future re-surfacing is a deliberate, separate decision.
- **Offline & no account** (Principle III, Cost of entry): all reads/writes are local; no network, no
  identity. The record is device-scoped and is never written to the report log or synced (Principle
  IV).
- **Relaunch** does not use `markDeclined`; exiting a relaunched tour leaves the stored status intact.
