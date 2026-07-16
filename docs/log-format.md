# The FoxMapper Report Log

**Version 1.** This document is everything you need to read, write, merge and render a FoxMapper
log in any language. If you cannot reimplement it from this page alone, in an afternoon, that is a
defect in this document — please say so.

FoxMapper is a shared map for radio direction finding ("fox hunting"). Participants report what
they heard and from where; the map draws every report. **No location is estimated or computed.**

---

## 1. The whole thing, in five sentences

1. A **log** is a set of **reports**.
2. A report is a JSON object with an `id` that is a random UUIDv4.
3. Reports are **immutable**. Nothing is ever edited or deleted.
4. **Merging two logs is set union, keyed by `id`.** There is no conflict resolution because there
   cannot be a conflict.
5. Everything a participant sees is a **fold** over the set, computed the same way on every device.

A correction is not an edit — it is a `retraction` report naming another report's `id`. That is
what keeps merge trivial.

---

## 2. Report

```json
{
  "v": 1,
  "id": "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "hunt_code": "quiet-fox-8821-h7k2",
  "kind": "bearing",
  "observer": { "callsign": "KI7XYZ" },
  "position": { "lat": 48.7519, "lon": -122.4787 },
  "position_source": "measured",
  "position_accuracy_m": 8,
  "observed_at": 1784092800000,
  "clock_offset_ms": null,
  "entered_by": { "participant_id": "3c9a…", "callsign": "KI7XYZ" },
  "payload": {}
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | integer | yes | Format version. `1`. |
| `id` | UUIDv4, lowercase canonical | yes | Identity. Generated client-side, offline, uncoordinated. |
| `hunt_code` | string | yes | Which hunt this belongs to. |
| `kind` | enum | yes | `bearing` \| `omni` \| `null` \| `fix` \| `retraction` |
| `observer` | object | yes | Whose observation it is. `callsign` only — **colour is derived, never stored**. |
| `position` | object | yes | `lat`, `lon` — WGS84 decimal degrees. **The observer's** position. |
| `position_source` | enum | yes | `measured` (device fix) \| `placed` (set by hand). |
| `position_accuracy_m` | number | no | Device-reported. **Advisory only** — see §8. |
| `observed_at` | integer | yes | UTC epoch ms, from the authoring device's clock. When the observation happened, **not** when it was typed. |
| `clock_offset_ms` | integer \| `null` | yes | Device clock minus true time; positive = running fast. **`null` means never measured** — not zero. |
| `entered_by` | object | yes | `participant_id` (UUIDv4), `callsign`. Who typed it. |
| `payload` | object | yes | Kind-specific. May be empty (`{}`). |
| `wire` | object | no | Raw on-air fields, on ingested reports only. See §7. |

**`id` generation.** 128 random bits, canonical lowercase hex UUID. `crypto.randomUUID()` in a
browser; any CSPRNG-backed v4 elsewhere. **Do not derive it from the content** — see §9.

**`relayed` is not a field.** It is derived: `observer.callsign !== entered_by.callsign`. Do not
store it; a stored flag can disagree with the two names it summarises.

---

## 3. Payloads

### `bearing`

```json
{
  "heading_true": 271.4,
  "heading_magnetic": 256.2,
  "declination": 15.2,
  "wmm_epoch": "WMM2025",
  "heading_source": "compass",
  "compass_accuracy_deg": 12,
  "confidence_q": 4,
  "max_range_r": 3
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `heading_true` | number 0–359.9 | yes | Degrees clockwise from **true** north. |
| `heading_magnetic` | number 0–359.9 | yes | What the device reported. Both mobile platforms give magnetic. |
| `declination` | number | yes | Signed degrees added to get true. |
| `wmm_epoch` | string | yes | Model that produced `declination`, e.g. `"WMM2025"`. |
| `heading_source` | enum | yes | `compass` \| `manual`. |
| `compass_accuracy_deg` | number | no | iOS only. **Absent on Android — the platform exposes nothing.** |
| `confidence_q` | integer, **one of {3,4,5}** authored; 0–9 ingested | yes | Raw APRS Q digit. |
| `max_range_r` | integer, **one of {1,3,5}** authored; 0–9 ingested | yes | Raw APRS R digit. Range = 2^R miles. |

**Why magnetic, declination and the epoch are all recorded.** So the bearing stays
reinterpretable. A log storing only `heading_true` asserts a conversion it cannot show its work
for, and becomes unrecoverable when the magnetic model updates. A reimplementer can recompute
`heading_true` from `heading_magnetic` and their own model, and check ours.

**Why `confidence_q` is capped at 5.** The APRS Q scale runs to 9 (<1°). We emit only 3, 4 or 5 —
worst <64°, best **<16°**. Real compass error is 10–30° near a vehicle or antenna. An interface
letting a hunter claim <1° produces a wedge that looks authoritative and is fiction.
**A reimplementation that widens this range is not compatible with FoxMapper's honesty guarantee**,
even though the log would still parse.

**Why raw digits, not degrees.** The Q→degrees table is contested: APRS101.PDF and PROTOCOL.TXT
disagree, and PROTOCOL.TXT omits the digit 6. Storing degrees would freeze one reading of a
disputed spec into an immutable record. Store the digit; decode at the edge (§6).

### `omni`

```json
{ "strength_s": 5 }
```

`strength_s`: integer, **one of {2,5,8}** authored; 1–9 ingested. Relative signal strength where
the observer stands. **No direction is claimed.** `0` is not valid here — nothing heard is a
`null` report.

### `null`

```json
{}
```

Empty. Kind + position + time is the whole claim: *"I heard nothing here."*

This is **negative evidence and it is first-class** — on the air it is the high-volume report,
because far more stations fail to hear a transmitter than hear it, and it is what eliminates
territory.

### `fix`

```json
{}
```

Empty. *"I found it, here, then."* Does not close the hunt. Does not stop reports. **Two
conflicting `fix` reports both stand** — the system does not adjudicate, and a reimplementation
must not either.

### `retraction`

```json
{ "retracts_id": "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f" }
```

**Read this part carefully — it is where reimplementations go wrong:**

- A retraction is **a report in the same set**. It removes nothing. The retracted report stays in
  the log forever.
- **A retraction may arrive before the report it retracts.** Networks reorder. This is legal and
  must work.
- A retraction whose target never arrives is **inert, not an error**. Do not warn, do not drop it.
- The retracting party is whoever **entered** the original, not the observer.

---

## 4. Merge

```
merge(A, B) = A ∪ B      keyed by id
```

That is the entire algorithm. It is associative, commutative and idempotent:

- `merge(A, B) == merge(B, A)`
- `merge(merge(A, B), C) == merge(A, merge(B, C))`
- `merge(A, A) == A`

**A duplicate `id` is the same report.** Take either; they are byte-identical by construction.

**Never** merge by timestamp. **Never** implement last-write-wins. There is no register to
overwrite, and introducing one would make the phone with the fastest clock the arbiter of truth.

---

## 5. The fold

```
retracted = { r.payload.retracts_id  |  r ∈ log, r.kind = "retraction" }
active    = [ r  |  r ∈ log, r.kind ≠ "retraction", r.id ∉ retracted ]
found     = ∃ r ∈ active : r.kind = "fix"
observers = distinct(r.observer.callsign for r in active)
```

**Compute `retracted` first, then filter.** Do not walk the log marking reports as you find
retractions — that is order-dependent, and it will pass every test until the day a retraction
overtakes its target on a real network.

| Property | Statement |
|---|---|
| Order-independence | `fold(shuffle(log)) == fold(log)` |
| Idempotence | `fold(A ∪ A) == fold(A)` |
| Commutativity | `fold(A ∪ B) == fold(B ∪ A)` |
| Age-neutrality | The fold never reads report age. No fading, ranking, or time filtering. |

### Observer colour

Colour is a pure function of the callsign and is **never written to the log**.

```
normalized = uppercase(trim(callsign))
index      = be_u32( SHA-256(utf8(normalized))[0..4] ) mod len(PALETTE)
colour     = PALETTE[index]
```

**PALETTE is normative and ordered.** Changing it, or its order, repaints every hunt.

| # | Colour | | # | Colour |
|---|---|---|---|---|
| 0 | `#e5533d` | | 6 | `#5b8ff9` |
| 1 | `#f2a03d` | | 7 | `#7f6bd6` |
| 2 | `#d9c02b` | | 8 | `#c264c2` |
| 3 | `#6bbf3f` | | 9 | `#e0629b` |
| 4 | `#2fae7e` | | 10 | `#9c6b45` |
| 5 | `#2eb0c4` | | 11 | `#8a8f99` |

**Guaranteed**: one callsign is one colour, on every device, forever, offline, whether the report
was entered by that operator or relayed by someone else.

**Not guaranteed**: that two *different* callsigns get different colours. With twelve swatches and
a hash, a hunt of eight will usually contain a collision — that is birthday maths, not a bug.
**Colour is an aid, never an identifier.** The callsign is on every report; identity never rests
on colour alone.

### Duplicate callsigns

Two participants may share a callsign. Colour cannot distinguish them — same callsign, same
colour, by construction. They are distinguished by a suffix, shown **only when a collision
actually exists**:

```
collision = ≥2 distinct entered_by.participant_id among active reports
            where observer.callsign == entered_by.callsign   (self-reports only)
suffix    = first 2 hex characters of entered_by.participant_id
display   = "KI7XYZ ·a3"
```

**Self-reports only** in the detection: a relayed report carries the relayer's `participant_id`,
so counting it would flag a collision between KI7XYZ and themselves every time somebody relays
them.

Two honest limits: one operator with two phones looks like two stations, and a relayed report
cannot be disambiguated at all. Neither is engineered around — the voice call did not disambiguate
either, and the map should not claim to know more than the radio did.

---

## 6. Rendering

| Kind | Drawn as | Constraint |
|---|---|---|
| `bearing` | Sector from `position`, width from `confidence_q`, length from `max_range_r` | **Never an unbounded ray** |
| `omni` | Marker at `position`, strength legible | **Must not imply a direction** |
| `null` | Marker at `position`, distinct from `omni` | **Must not imply the target is elsewhere** |
| `fix` | Marker at `position` | |

Every report shows its observer's callsign and colour and when it was taken. A relayed report is
visibly marked and names the entering operator. A `placed` position is visibly distinct from a
`measured` one.

**Q → wedge width** (APRS101's table, normative for display because Xastir implements it exactly):

| Q | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| Width | *useless* | <240° | <120° | <64° | <32° | <16° | <8° | <4° | <2° | <1° |

Q=0 is overloaded between specs ("useless" vs "OMNI"). We never emit it; on ingest, retain the
digit and render nothing directional.

---

## 7. Ingested reports: the `wire` object

A report that arrived from the air carries the raw fields it came with, so nothing is lost on the
way in.

```json
{
  "kind": "null",
  "payload": {},
  "wire": { "format": "DFS", "raw": "DFS0460", "s": 0, "h": 4, "g": 6, "d": 0 }
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | enum | yes | `DF` (`/BRG/NRQ`) \| `DFS` \| `third-party` |
| `raw` | string | yes | The field exactly as received. If our parse was wrong, the original survives. |
| *(digits)* | integers | no | Parsed raw digits — `n`,`r`,`q` for `DF`; `s`,`h`,`g`,`d` for `DFS`. Stored undecoded. |

**Rules**

- **Present only on ingested reports.** A report authored in an interface has no `wire` object.
- **Retain digits you render nothing with.** `h` and `g` size the circle of negated territory
  upstream. We draw no circle and keep both anyway — dropping them would be lossy *from* the air.
- **`wire` may hold values an interface cannot author** (a `Q` of 8, an `r` of 9). Do not clamp on
  ingest. Do not widen the authoring range to match.
- On re-emit, `raw` wins over the parsed digits if they disagree.

### On-air mapping

| Kind | Format | Notes |
|---|---|---|
| `bearing` | `/BRG/NRQ` | `BRG` = `heading_true` rounded, 001–360 (0 → `360`). `N` always `9` ("report is manual"). CSE/SPD `000/000`. |
| `omni` | `DFSshgd` | `s` = `strength_s`. We emit `h`=`g`=`d`=`0`. |
| `null` | `DFSshgd` with `s = 0` | The format's documented purpose is exactly this. |
| `fix` | **none exists** | Checked against APRS101, DF.TXT, omnidf.txt and the 1.1/1.2 addenda. This is the one kind with new semantics, declared rather than forced onto an unrelated format. |
| relayed | Third-party traffic (`}`) | Original station's callsign at the head; the relay named separately — structurally `observer` vs `entered_by`. |

---

## 8. Do not compute on this

Two fields look like inputs to maths and are not:

- **`position_accuracy_m`** — the platforms disagree on what it means. W3C says 95% confidence;
  Android reports the 68th percentile; Apple documents no percentile at all. Three meanings, one
  number. Use it as a relative quality hint. Do not weight anything with it.
- **`observed_at`** — a phone clock, and the error is worst exactly where this app lives (no cell
  service means no NTP). Display it, caveated by `clock_offset_ms`. Never merge, order, or resolve
  anything with it.

**`clock_offset_ms` is for display honesty, not arithmetic.**

- **`null` is not `0`.** Zero means "checked, and correct". Null means "nobody ever checked". An
  implementation that coalesces null to zero is asserting a clock is good when nothing knows that.
- **Never subtract it from `observed_at` in the log.** A reader may render a corrected time *for
  display*, but the fact is immutable — rewriting it would make the log a record of what we think
  happened rather than what was reported.
- It is per-report, not per-participant: a hunter may fix their clock mid-hunt, and their earlier
  reports keep the offset that was true when they were written.

---

## 9. Why IDs are random, not content-derived

Content addressing is the obvious idea and it is **wrong here**, for a domain reason rather than a
technical one.

Two operators can hear the same voice call and each relay it. That produces two reports which may
serialize identically. **They must both survive** — the system cannot know they describe one
observation, and collapsing them would destroy a real report.

Random IDs also dodge a second trap: content addressing needs canonical serialization, and float
canonicalization is exactly where a third-party reimplementation computes *different* IDs from the
same report — breaking this document's whole purpose.

---

## 10. Versioning

`v` is the format version, currently `1`.

- New optional fields do not bump `v`. **Ignore fields you do not recognise** — and do not drop
  them on re-emit if you are relaying.
- A change to the meaning of an existing field bumps `v`. Since the log is append-only and
  immutable, a `v` bump means readers must handle both, forever. There is no migration; there is
  only addition.

---

## 11. Sync (optional)

The log is the contract; the transport is not. A reimplementation may move logs by any means —
a USB stick of JSON would satisfy every rule above. What FoxMapper's own relay does:

- `POST /api/hunts/{code}/reports` — append, **idempotent by report `id`**. One report or an array.
- `GET /api/hunts/{code}/reports?since={seq}` — everything above a server-assigned sequence.
- `GET /api/hunts/{code}/stream` — SSE. `id:` is the sequence, so the browser's `Last-Event-ID`
  *is* the sync cursor: catch-up and live push are one code path.
- `GET /api/hunts/{code}` — metadata plus `id_digest`, for detecting divergence cheaply.

The server stores an opaque envelope and holds no domain fact a device could not recompute. It
never parses a report body.

**`id_digest` is specified exactly**, because "SHA-256 over the sorted id list" is not a
specification — a third party would guess a different answer and the audit would report divergence
that isn't there:

```
digest = "sha256:" + hex(
   SHA-256( join( sort_asc( [ lowercase(id) for id in reports ] ), "\n" ) )
)
```

Sort **ascending, bytewise**, over lowercase canonical UUID strings. Join with a single `\n`.
**No trailing newline.** Lowercase hex. The digest of an empty log is the SHA-256 of the empty
string.

---

## 12. Sources

[APRS101.PDF](https://www.aprs.org/doc/APRS101.PDF) ·
[PROTOCOL.TXT](https://www.aprs.org/APRS-docs/PROTOCOL.TXT) ·
[DF.TXT](https://www.aprs.org/DF-ing/DF.TXT) ·
[omnidf.txt](https://www.aprs.org/DF-ing/omnidf.txt) ·
[Addendum 1.1](https://www.aprs.org/aprs11.html) ·
[Addendum 1.2](https://www.aprs.org/aprs12.html)
