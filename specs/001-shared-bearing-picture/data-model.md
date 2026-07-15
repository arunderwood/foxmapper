# Phase 1 Data Model: Shared Bearing Picture

The whole model is: **a hunt owns an append-only set of reports; everything else is a fold over that
set.** Nothing below is stored as derived state, and the server stores none of the semantics — only
an envelope with an ID and a sequence.

The authoritative wire format is [contracts/log-format.md](contracts/log-format.md). This document is
the conceptual model and its rules.

## Entities

### Hunt

| Field | Type | Notes |
|---|---|---|
| `code` | string | Grants entry. Appears in the link. The only access control (spec Assumptions). |
| `created_at` | epoch ms (UTC) | Server-stamped. |
| `target` | Target | Exactly one. Never null. |
| `reports` | Set\<Report\> | The log. Append-only. |

**Rules**

- Exactly one target per hunt (FR-004a). A report therefore never names a target — it belongs to the
  hunt. This is why there is no `target_id` anywhere below.
- Expiry is **derived, not stored**: `max(report.received_at) + 30 days` (FR-004). The clock is idle-
  based, so every append pushes it out. A hunt with no reports expires 30 days after creation.
- Purge deletes the hunt and its reports. After purge the code is dead: the SSE stream returns HTTP
  204, which tells the browser to stop reconnecting permanently, and the client lands the participant
  where a first-time visitor lands (spec edge case: "the remembered hunt has expired").

### Target

| Field | Type | Notes |
|---|---|---|
| `frequency` | string | Free text, as a hunter would say it. Not parsed, not validated as a number. |
| `label` | string | What you are hunting. "Stuck mic on the 146.96 machine." |
| `found` | derived bool | **Not stored.** `true` iff a non-retracted `fix` report exists. |

**Rules**

- `found` is a fold over the log, never a column. Storing it would make the server authoritative over
  a domain fact (Principle IV) and would need a conflict rule the union merge does not have.
- A find does not lock the hunt (spec edge case). Reports continue after `found` goes true. Two
  conflicting finds both stand; the system does not adjudicate.
- Frequency is a string on purpose. Hunters say "146.52", "two meters", "the 440 machine". Parsing it
  into a number would reject real input for no gain — P1 never computes on it.

### Participant

| Field | Type | Notes |
|---|---|---|
| `id` | UUIDv4 | Device-local identity. Not a callsign. Never leaves the device except inside reports it authored. |
| `callsign` | string | Self-chosen. **Not unique** — duplicates are admitted and distinguished (spec edge case). |
| `color` | derived | **Not stored.** A pure function of the callsign — see [log-format.md](contracts/log-format.md#observer-colour-is-derived-not-stored). |

**Rules**

- No account, no credential (Operating Constraints). Possession of the hunt code is the whole of auth.
- Callsign is **not identity**. Two participants may share one; the map distinguishes them. Identity
  is the UUID.
- There is **no role, no permission, and no designated position** (FR-024). Net control is a behaviour.

### Observer

Not a stored row — a **value** carried on every report.

| Field | Type | Notes |
|---|---|---|
| `callsign` | string | Whose observation it is, from whose position. **The only stored field.** |
| `color` | derived | Pure function of `callsign`. Never stored, never chosen. |

**Rules**

- An observer **need not be a participant** (FR-007c). A voice-only operator with a radio and no phone
  appears on the map, with reports against their position, having never joined and holding no device
  in the hunt.
- This is why Observer is a value and not a foreign key. There is no row to point at — and it is why
  colour must derive from the callsign rather than from any participant record: an observer who never
  joined has no record to carry one.
- **A callsign is one colour everywhere**, whether that operator entered the report themselves or net
  control relayed it. Deriving colour from `participant_id` instead would give one person two colours
  — their own and the one their relayed reports got — which is the same failure the old stored-colour
  model had.
- Two different callsigns may share a colour. Colour is an aid; the callsign is the identifier
  (FR-012). See [log-format.md](contracts/log-format.md#observer-colour-is-derived-not-stored).

### Report

The atom. Immutable, append-only. Every report carries:

| Field | Type | Notes |
|---|---|---|
| `id` | UUIDv4 | `crypto.randomUUID()`. Client-generated, offline, uncoordinated. The G-Set key. |
| `hunt_code` | string | Which hunt. |
| `kind` | `bearing` \| `omni` \| `null` \| `fix` \| `retraction` | |
| `observer` | Observer | Whose observation. |
| `position` | {lat, lon} | The **observer's** position — not the entering operator's (FR-007). |
| `position_source` | `measured` \| `placed` | Device fix vs placed by hand. Shown on the map (FR-008). |
| `position_accuracy_m` | number? | Relative quality signal **only** — never used in math (see research §5). |
| `observed_at` | epoch ms (UTC) | When the observation was taken. **Not** when it was entered (FR-007). |
| `clock_offset_ms` | integer \| null | How wrong the authoring device's clock was known to be. **null = never measured**, which is not the same as zero (FR-009b). |
| `entered_by` | {participant_id, callsign} | Who typed it. |
| `payload` | kind-specific | Below. |

**Rules**

- **Immutable.** No field is ever updated. Corrections are new records.
- **`relayed` is derived**, not stored: `report.observer.callsign !== report.entered_by.callsign`. It
  is never a flag, because a flag can disagree with the two names it summarises. Net control relaying
  their own observation is therefore automatically *not* relayed (spec edge case), with no special
  case in the code.
- **Two operators relaying the same voice call produce two reports and are NOT deduplicated** (spec
  edge case). This is why IDs are random rather than content-derived — see research §2. Deduplicating
  would destroy a real report.
- `observed_at` comes from a phone clock that may be badly wrong, and skew is worst where the app
  lives (no cell → no NTP). Nothing in the merge consults it. Gross skew (>2 min) is **surfaced to the
  participant, never silently corrected** (FR-009c) — correcting would mutate a reported fact.
- `clock_offset_ms` carries that doubt to everyone else. Without it, only the reporter would know
  their timestamps were wrong, while every other hunter read them as exact — the map would be lying
  to precisely the people who cannot tell. It is display metadata: render a caveat, or a corrected
  time, but **never subtract it from `observed_at` in the log**.

#### payload: `bearing`

| Field | Type | Notes |
|---|---|---|
| `heading_true` | degrees 0–359.9 | What we record and render (FR-009). |
| `heading_magnetic` | degrees 0–359.9 | What the device actually reported. |
| `declination` | degrees | What we added. Signed. |
| `wmm_epoch` | string | e.g. `"WMM2025"`. Which model produced the declination. |
| `heading_source` | `compass` \| `manual` | Drafted by the device, or set by hand. |
| `compass_accuracy_deg` | number? | iOS `webkitCompassAccuracy`. **Null on Android — no equivalent exists.** |
| `confidence_q` | 3 \| 4 \| 5 | Raw APRS Q digit. Three buckets (FR-006a). |
| `max_range_r` | 1 \| 3 \| 5 | Raw APRS R digit. Three buckets → 2, 8, or 32 miles. 0–9 accepted on ingest. |

**Rules**

- **Both magnetic and true are recorded, plus the declination and the model epoch.** This is what
  keeps a bearing reinterpretable when WMM updates, and means the provenance of the number is never
  lost. Recording only `heading_true` would make the log assert a conversion it cannot show its work
  for.
- **`confidence_q` is capped at 5 (<16°) — the narrowest claim the interface can make.** The APRS
  scale goes to Q=9 (<1°), and we deliberately cannot reach it. Compass error is 10–30° near metal
  (research §5); a button offering "<1°" would manufacture precision at the moment the hunter is
  least able to judge it. **This cap is Principle I, expressed as a range constraint.**
- Raw digits are stored, never decoded degrees, because the Q table is contested between APRS101 and
  PROTOCOL.TXT (research §1). Decoding on write would bake our reading of a disputed spec into an
  immutable log.
- Both confidence and range are **required** — this is what makes an unbounded or zero-width wedge
  unrepresentable rather than merely discouraged (spec edge case, FR-011).
- **Range is three buckets for the same reason confidence is.** The R scale runs to 512 miles, which
  is meaningless for a fox hunt, and ten targets is unhittable with a gloved thumb inside SC-001a's
  ten seconds. Keeping range in the interface at all is what preserves acceptance scenario 3 — the
  wedge's length is a claim its observer actually made, not a default wearing their name.

#### payload: `omni`

| Field | Type | Notes |
|---|---|---|
| `strength_s` | 2 \| 5 \| 8 | Relative signal strength. Raw APRS `s` digit. Three buckets. 1–9 accepted on ingest. |

**Rules**

- `s = 0` is not valid here — that is a `null` report, below.
- **Three buckets, not nine.** SC-001b gives a strength report the same ten seconds and the same
  gloved thumb as a bearing, so it gets the same three fat buttons. The authored digits sit at the
  meaningful midpoints of the operator scale: 2 "detectible, not copyable", 5 "some noise but easy to
  copy", 8 "dead full-quieting". A nine-step picker would imply a precision that a shouted S-meter
  guess does not have.

#### payload: `null`

| Field | Type | Notes |
|---|---|---|
| *(none)* | | "I hear nothing here" is fully expressed by kind + position + time. |

**Rules**

- On the wire this is `DFS` with `s = 0` — the existing on-air format whose documented purpose is
  exactly this (research §1). `null` and `omni` are one format with different strength digits, and
  **two kinds in the domain on purpose**: FR-005b requires a distinct "I hear nothing" affordance, and
  a hunter does not think of silence as "strength zero". The interface wins; the mapping absorbs it.
- Upstream, `DFS0hgd` carries antenna height and gain because they size the circle of negated
  territory. **P1 collects neither**, because P1 draws no circle — it draws a marker at a position
  (FR-011a). On ingest from the air those digits are retained raw (see the wire contract); on our own
  reports they are emitted as documented defaults. This is a real, bounded asymmetry and it is written
  down rather than discovered.

#### payload: `fix`

| Field | Type | Notes |
|---|---|---|
| *(none)* | | Position and time say it. |

**Rules**

- **No on-air format exists** for "found it" (research §1). This is the one kind where we define new
  semantics, and Principle V's "where one exists" clause permits it.
- A `fix` makes `target.found` true by fold. It does not close the hunt, does not stop reports, and
  does not win against a second `fix`.

#### payload: `retraction`

| Field | Type | Notes |
|---|---|---|
| `retracts_id` | UUIDv4 | The report being withdrawn. |

**Rules**

- A retraction is **a report, in the same set** — this is what keeps the log a G-Set rather than a
  2P-Set, and therefore what keeps merge conflict-free (research §2). It never removes anything.
- **A retraction may legally arrive before the report it retracts.** The fold must accumulate
  retracted IDs and filter, never "find the report and mark it". This is the single most important
  implementation rule in this document: getting it wrong reintroduces order-dependence into a design
  whose correctness rests on order not mattering.
- A retraction naming an ID that never arrives is inert and harmless. It is not an error.
- Retracting is done by **whoever entered** the report, not the observer (FR-010) — the observer of a
  relayed report has no device in the hunt and could not retract it.
- Retracting a retraction is not modelled. Enter a fresh report instead.

## Derived state — the fold

All of this is computed on every client from the same log, identically (Principle IV). None is stored.

```
fold(reports):
  retracted  = { r.payload.retracts_id : r in reports, r.kind == "retraction" }
  active     = [ r : r in reports, r.kind != "retraction", r.id not in retracted ]
  found      = any(r.kind == "fix" for r in active)
  observers  = distinct(r.observer.callsign for r in active)
  colour(cs) = PALETTE[ be_u32(sha256(upper(trim(cs)))[0..4]) mod len(PALETTE) ]
  ambiguous  = { cs : cs in observers,
                 |distinct(r.entered_by.participant_id for r in active
                           where r.observer.callsign == cs
                             and r.observer.callsign == r.entered_by.callsign)| >= 2 }
  map        = [ render(r) for r in active ]
```

**Properties this must satisfy** (and that the tests assert):

- **Order-independent**: `fold(shuffle(reports)) == fold(reports)`. Falls out of computing `retracted`
  first.
- **Idempotent under union**: `fold(A ∪ A) == fold(A)`.
- **Commutative under union**: `fold(A ∪ B) == fold(B ∪ A)`. This is the formal statement of "merging
  two divergent logs is a union requiring no conflict resolution".
- **Age-neutral**: nothing in the fold or the render consults report age (FR-012a). No fading, no
  ranking, no filtering.

## Rendering rules

| Kind | Drawn as | Constraint |
|---|---|---|
| `bearing` | Sector from `position`, width from `confidence_q`, length from `max_range_r` | Never an unbounded ray (FR-011) |
| `omni` | Marker at `position`, strength legible | **Must not imply a direction** (FR-011a) |
| `null` | Marker at `position`, distinct from `omni` | **Must not imply the target is elsewhere** (FR-011a) |
| `fix` | Marker at `position` | |

Every report shows its observer's callsign and colour and when it was taken (FR-012). A relayed report
is visibly marked and names the entering operator too (FR-012b). A `placed` position is visibly
distinct from a `measured` one (FR-008).

## Server-side model

The server stores an **envelope**, and deliberately cannot read the domain:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key. Append is idempotent by this. |
| `hunt_code` | string | |
| `seq` | bigserial | Monotonic. The SSE `id:` and the sync cursor. |
| `received_at` | epoch ms | **Envelope metadata, not part of the report.** Feeds the idle purge clock and the client's clock-skew check. |
| `body` | jsonb | The report, opaque. The server never parses it. |

**Rules**

- The server has **no opinion about direction finding** (Development Workflow). It does not validate a
  bearing, compute a wedge, decode APRS, or know what `kind` means. `body` is opaque.
- `received_at` stays on the envelope rather than in the report, so the report remains
  client-authored and immutable and the server holds no domain fact a device could not recompute
  (Principle IV).
- **Appends are serialized through a single writer.** Not for throughput — to close the sequence-gap
  hazard where a reader advances past a seq that is still committing and never sees it (research §4).
  That is the one place this design could silently lose a report.
