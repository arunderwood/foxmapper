# Contract: Log-Format Delta — `bearing` payload

**Authority**: [`docs/log-format.md`](../../../docs/log-format.md) is the living, third-party-
reimplementable format. This contract pins the single change this feature makes to it and the
invariants that keep the change safe. Feature 001's `specs/001-.../contracts/log-format.md` is
historical record and is **not** edited (the constitution does not rewrite closed specs).

## The change

Remove two fields from the `bearing` payload:

- `heading_source` (`compass` | `manual`) — was `required`.
- `compass_accuracy_deg` (number) — was optional.

Nothing else in the payload changes. `heading_true`, `heading_magnetic`, `declination`, `wmm_epoch`,
`confidence_q`, `max_range_r` are all retained with the same types and constraints.

Update in `docs/log-format.md`: delete the two table rows and the two example lines from the
`bearing` §3 block.

## Why it is safe

| Invariant | Evidence |
|---|---|
| **No renderer regresses** | `grep` shows the fields are write-only: no map, layer, wedge, popup, or fusion path reads `heading_source`/`compass_accuracy_deg`. |
| **Wire round-trip unchanged (Principle V)** | `aprs/mapping.ts` encodes/decodes only `heading_true`, `confidence_q` (Q), `max_range_r` (R). The dropped fields were never on the air, so the lossless APRS DF mapping is untouched. |
| **Merge unchanged (Principle IV)** | Report identity is the `id`; these fields are never part of any key. Presence or absence changes no dedup or union outcome. |
| **Append-only preserved** | No stored report is rewritten. Old and foreign reports may still carry the fields; ingest accepts and ignores them. No migration. |

## Compatibility rules for reimplementers

- **Writers** (this app, going forward): MUST NOT emit `heading_source` or `compass_accuracy_deg`.
- **Readers**: MUST accept a `bearing` payload with or without the fields, and MUST ignore them if
  present. A reader MUST NOT treat their absence as an error or infer a source.
- **Round-trip**: a `bearing` authored after this change round-trips losslessly through storage and
  through the APRS DF mapping using the retained fields alone.

## Tests that hold this contract

- Unit: the bearing arbitrary (`arbitraries.ts`) no longer generates the fields; `report.test.ts`
  asserts an authored `bearing` payload has exactly the retained keys.
- Unit: an ingest/round-trip test feeds a legacy payload *with* the fields and asserts it is accepted
  and the extra keys are dropped/ignored (back-compat).
- Unit: `aprs.test.ts` continues to pass unchanged — proof the wire mapping never depended on them.
