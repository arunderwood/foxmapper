# Contract: The Report Log

**This document is the one the constitution actually tests.** Principle IV: *"The log format MUST be
documented and reimplementable by a third party."* If you cannot reimplement FoxMapper's log from this
page alone, in a language of your choice, in an afternoon, this document has failed and the format is
a defect.

Everything else in the system is downstream of this.

## The whole thing, in five sentences

1. A **log** is a set of **reports**.
2. A report is a JSON object with an `id` that is a random UUIDv4.
3. Reports are **immutable**. Nothing is ever edited or deleted.
4. **Merging two logs is set union, keyed by `id`.** There is no conflict resolution because there
   cannot be a conflict.
5. Everything a participant sees is a **fold** over the set, computed the same way on every device.

A correction is not an edit — it is a `retraction` report naming another report's `id`. That is what
keeps merge trivial.

## Report

```json
{
  "v": 1,
  "id": "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "hunt_code": "quiet-fox-8821",
  "kind": "bearing",
  "observer": { "callsign": "KI7XYZ" },
  "position": { "lat": 48.7519, "lon": -122.4787 },
  "position_source": "measured",
  "position_accuracy_m": 8,
  "observed_at": 1784092800000,
  "entered_by": { "participant_id": "3c9a...", "callsign": "KI7XYZ" },
  "payload": { }
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `v` | integer | yes | Format version. `1`. |
| `id` | UUIDv4 string, lowercase canonical | yes | Identity. Generated client-side, offline, uncoordinated. |
| `hunt_code` | string | yes | Which hunt this belongs to. |
| `kind` | enum | yes | `bearing` \| `omni` \| `null` \| `fix` \| `retraction` |
| `observer` | object | yes | Whose observation it is. `callsign` (string) only — **colour is derived, never stored**. |
| `position` | object | yes | `lat`, `lon` — WGS84 decimal degrees. **The observer's** position. |
| `position_source` | enum | yes | `measured` (device fix) \| `placed` (set by hand). |
| `position_accuracy_m` | number | no | Device-reported. **Advisory only** — see "Do not compute on this". |
| `observed_at` | integer | yes | UTC epoch milliseconds, from the authoring device's clock. When the observation happened, **not** when it was typed. |
| `clock_offset_ms` | integer \| `null` | yes | How wrong the authoring device's clock was known to be: device clock minus true time, positive = running fast. **`null` means never measured** — not zero. |
| `entered_by` | object | yes | `participant_id` (UUIDv4), `callsign` (string). Who typed it. |
| `payload` | object | yes | Kind-specific. May be empty (`{}`). |

**`id` generation.** 128 random bits, canonical lowercase hex UUID form. `crypto.randomUUID()` in a
browser; any CSPRNG-backed v4 elsewhere. Do **not** derive it from the content — see "Why IDs are
random" below.

**`relayed` is not a field.** It is derived: `observer.callsign !== entered_by.callsign`. Do not store
it. A stored flag can disagree with the two names it summarises.

## Payloads

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
| `heading_magnetic` | number 0–359.9 | yes | What the device reported. Both platforms give magnetic. |
| `declination` | number | yes | Signed degrees added to get true. |
| `wmm_epoch` | string | yes | Model that produced `declination`, e.g. `"WMM2025"`. |
| `heading_source` | enum | yes | `compass` \| `manual`. |
| `compass_accuracy_deg` | number | no | iOS only. **Absent on Android — the platform exposes nothing.** |
| `confidence_q` | integer, **one of {3, 4, 5}** | yes | Raw APRS Q digit. Three buckets. See the cap below. |
| `max_range_r` | integer, **one of {1, 3, 5}** when authored here; 0–9 when ingested | yes | Raw APRS R digit. Range = 2^R miles → 2, 8, or 32. |
| `wire` | object | no | Raw on-air fields retained on ingest. See "Ingested reports" below. |

**Why magnetic, declination, and the epoch are all recorded.** So the bearing stays reinterpretable.
A log that stored only `heading_true` would assert a conversion it cannot show its work for, and would
be unrecoverable when the magnetic model updates. A reimplementer can recompute `heading_true` from
`heading_magnetic` and their own model, and check ours.

**Why `confidence_q` is capped at 5.** The APRS Q scale runs to 9 (<1°). We emit only 3, 4, or 5 —
worst is <64°, best is **<16°**. Real compass error is 10–30° near a vehicle or antenna. An interface
that let a hunter claim <1° would produce a wedge that looks authoritative and is fiction. **A
reimplementation that widens this range is not compatible with FoxMapper's honesty guarantee**, even
though the log would still parse.

**Why raw digits and not degrees.** The Q→degrees table is contested: APRS101.PDF and PROTOCOL.TXT
disagree, and PROTOCOL.TXT omits the digit 6. Storing degrees would freeze our reading of a disputed
spec into an immutable record. Store the digit; decode at the edge. See
[aprs-mapping.md](aprs-mapping.md).

**Why `max_range_r` is three values, not ten.** Same reason as the Q cap, applied to the other axis.
The scale runs 0–9 (1 to 512 miles); 512 miles is meaningless for a fox hunt, and ten targets is
unhittable with a gloved thumb in under ten seconds (SC-001a). We author `{1, 3, 5}` → **2, 8, or 32
miles**. As with Q, ingest accepts the full 0–9 and retains it.

### `omni`

```json
{ "strength_s": 5 }
```

`strength_s`: integer, **one of {2, 5, 8}** when authored here; **1–9** when ingested. Relative signal
strength where the observer stands. No direction is claimed.

**Why three values, not nine.** The same tension the Q cap resolves. SC-001b gives a signal-strength
report the same ten seconds, one hand, and barely-visible screen as a bearing, so it gets the same
three fat buttons. An S-meter reading called from memory in the cold is a judgement, not a
measurement, and nine targets would imply otherwise. The authored digits sit at the meaningful
midpoints of DF.TXT's operator scale — 2 "detectible, not copyable", 5 "some noise but easy to copy",
8 "dead full-quieting".

`0` is not valid here. Nothing heard is a `null` report.

### `null`

```json
{}
```

Empty. Kind + position + time is the whole claim: *"I heard nothing here."*

This is **negative evidence and it is first-class** — on the air it is the high-volume report, because
far more stations fail to hear a transmitter than hear it. It maps to `DFS` with `s = 0`, an existing
format built for exactly this.

### `fix`

```json
{}
```

Empty. *"I found it, here, then."*

Does not close the hunt. Does not stop reports. Two conflicting `fix` reports both stand — the system
does not adjudicate, and a reimplementation must not either.

### `retraction`

```json
{ "retracts_id": "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f" }
```

`retracts_id`: UUIDv4, required. The report being withdrawn.

**Read this part carefully — it is where reimplementations go wrong:**

- A retraction is **a report in the same set**. It removes nothing. The retracted report stays in the
  log forever, and any correct implementation can still see it.
- **A retraction may arrive before the report it retracts.** Networks reorder; a device may sync a
  retraction and not yet hold its target. This is legal and must work.
- A retraction whose target never arrives is **inert, not an error**. Do not warn, do not drop it, do
  not queue a lookup.
- The retracting party is whoever **entered** the original, not the observer. The observer of a
  relayed report has no device in the hunt.

## Observer colour is derived, not stored

Colour is a pure function of the callsign. It is **never written to the log** — storing it would let
two reports name one observer in two colours (net control relaying KI7XYZ picks one, KI7XYZ's own
device picks another), and would put derived state inside an immutable record.

```
normalized = uppercase(trim(callsign))
index      = be_u32( SHA-256(utf8(normalized))[0..4] ) mod len(PALETTE)
colour     = PALETTE[index]
```

Specified to the byte because this is derived state: Principle IV requires it be *"computed
identically from the same log on every client"*, and two devices disagreeing about who is orange is
that guarantee failing visibly.

**PALETTE is normative and ordered.** Changing it, or its order, repaints every hunt — so it is
versioned with the format, not tuned casually.

| # | Colour | | # | Colour |
|---|---|---|---|---|
| 0 | `#e5533d` | | 6 | `#5b8ff9` |
| 1 | `#f2a03d` | | 7 | `#7f6bd6` |
| 2 | `#d9c02b` | | 8 | `#c264c2` |
| 3 | `#6bbf3f` | | 9 | `#e0629b` |
| 4 | `#2fae7e` | | 10 | `#9c6b45` |
| 5 | `#2eb0c4` | | 11 | `#8a8f99` |

> **This list needs a designer's eye before first release.** It must survive direct sunlight, a
> dimmed screen, and common colour-vision deficiencies — none of which has been checked. Twelve
> entries is a starting point, not a verified answer. The *algorithm* is settled; the swatches are a
> Stage 6 task.

### What this does and does not guarantee

**Guaranteed**: one callsign is one colour, on every device, forever, offline, whether the report was
entered by that operator or relayed by net control. That is the property FR-002a actually needs, and
the reason colour is derived from the callsign rather than from `participant_id` — a participant_id
key would give KI7XYZ one colour for their own reports and a different one for reports net control
relayed on their behalf, which is the same person appearing as two stations.

**Not guaranteed**: that two *different* callsigns get different colours. With twelve swatches and a
hash, a hunt of eight will usually contain a collision — that is birthday maths, not a bug to fix.
**Colour is an aid, never an identifier.** FR-012 requires the callsign on every report, so identity
never rests on colour alone. Any implementation that uses colour as the primary way to tell stations
apart has misread this contract.

Growing the palette reduces collisions and costs distinguishability — twelve colours a human can
actually name beats forty they cannot. This tradeoff is not resolvable by making the list longer.

### Duplicate callsigns

Two participants may share a callsign — the spec admits them both and requires they be *"visibly
distinguished"*. Colour cannot do it: same callsign, same colour, by construction.

They are distinguished by a **suffix**, derived and shown **only when a collision actually exists**:

```
collision  = ≥2 distinct entered_by.participant_id among active reports
             where observer.callsign == entered_by.callsign   (self-reports only)
suffix     = first 2 hex characters of entered_by.participant_id
display    = "KI7XYZ ·a3"
```

- **Only on collision.** A lone KI7XYZ renders as `KI7XYZ`; a suffix on every report would be noise
  in exchange for a case that rarely arises.
- **Self-reports only** in the detection. A relayed report has net control's `participant_id` in
  `entered_by`, so counting it would flag a collision between KI7XYZ and *themselves* every time
  somebody relays them.
- **Two honest limits, stated rather than engineered around:**
  1. One operator using two phones looks like two stations. We cannot tell the difference, and
     pretending otherwise would mean inventing an identity the log does not carry.
  2. **A relayed report cannot be disambiguated at all** — the observer is a bare callsign with no
     `participant_id`. If two KI7XYZs exist and net control relays "KI7XYZ", nobody knows which one
     it was. That is not a gap in the model; the voice call did not disambiguate either, and the map
     should not claim to know more than the radio did.

## Ingested reports: the `wire` object

A report that originated on the air — rather than being authored in this interface — carries the raw
fields it arrived with, so nothing is lost on the way in. FR-020 says the mapping is lossless *to and
from*; this object is the "from" half.

```json
{
  "kind": "null",
  "payload": {},
  "wire": {
    "format": "DFS",
    "raw": "DFS0460",
    "s": 0, "h": 4, "g": 6, "d": 0
  }
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | enum | yes | `DF` (`/BRG/NRQ`) \| `DFS` \| `third-party` |
| `raw` | string | yes | The field exactly as received. The escape hatch: if our parse was wrong, the original survives. |
| *(digits)* | integers | no | The parsed raw digits — `n`, `r`, `q` for `DF`; `s`, `h`, `g`, `d` for `DFS`. Stored undecoded. |

**Rules**

- **Present only on ingested reports.** A report authored in this interface has no `wire` object, and
  its on-air form is computed on demand by the mapping.
- **Retain digits we render nothing with.** `h` (antenna height) and `g` (gain) size the circle of
  negated territory for a null report upstream. P1 draws no circle, so it uses neither — and keeps
  both anyway, because dropping them would be lossy *from* the air and would silently destroy the
  inputs fusion will need on the day it arrives.
- **`wire` may hold values our interface cannot author** — a `Q` of 8, an `r` of 9. That is correct
  and expected: we accept what the air gives us, and separately refuse to *claim* more than a compass
  can deliver. Do not clamp on ingest. Do not widen the authoring range to match.
- On re-emit, `raw` wins over the parsed digits if they ever disagree.

See [aprs-mapping.md](aprs-mapping.md) for the field semantics and the contested Q table.

## Merge

```
merge(A, B) = A ∪ B      keyed by id
```

That is the entire algorithm.

It is associative, commutative, and idempotent, which is the formal reason no conflict can arise:

- `merge(A, B) == merge(B, A)`
- `merge(merge(A, B), C) == merge(A, merge(B, C))`
- `merge(A, A) == A`

**A duplicate `id` is the same report.** Take either; they are byte-identical by construction, because
nothing ever edits a report. If you find two reports with one `id` and different bodies, someone has
violated immutability and you have a bug upstream, not a merge decision to make.

**Never** merge by timestamp. **Never** implement last-write-wins. There is no register to overwrite,
and introducing one would make the phone with the fastest clock the arbiter of truth.

## The fold

```
retracted = { r.payload.retracts_id  |  r ∈ log, r.kind = "retraction" }
active    = [ r  |  r ∈ log, r.kind ≠ "retraction", r.id ∉ retracted ]
found     = ∃ r ∈ active : r.kind = "fix"
```

**Compute `retracted` first, then filter.** Do not walk the log marking reports as you find
retractions — that is order-dependent, and it will pass every test until the day a retraction
overtakes its target on a real network.

Required properties:

| Property | Statement |
|---|---|
| Order-independence | `fold(shuffle(log)) == fold(log)` |
| Idempotence | `fold(A ∪ A) == fold(A)` |
| Commutativity | `fold(A ∪ B) == fold(B ∪ A)` |
| Age-neutrality | The fold never reads report age. No fading, ranking, or time filtering. |

## Why IDs are random, not content-derived

Content addressing is the obvious idea and it is **wrong here**, for a domain reason rather than a
technical one.

Two operators can hear the same voice call and each relay it. That produces two reports which may
serialize identically. **They must both survive** — the system cannot know they describe one
observation, and collapsing them would destroy a real report. Content-derived IDs would silently
merge them.

Random IDs also dodge a second trap: content addressing needs canonical serialization, and float
canonicalization is exactly where a third-party reimplementation computes *different* IDs from the
same report — breaking this contract's whole purpose.

## Do not compute on this

Two fields look like inputs to math and are not:

- **`position_accuracy_m`** — the platforms disagree on what it means. W3C says 95% confidence;
  Android reports 68th percentile; Apple documents no percentile at all. Three meanings, one number.
  Use it as a relative quality hint. Do not weight anything with it.
- **`observed_at`** — a phone clock, and the error is worst exactly where this app lives (no cell
  service means no NTP). Display it, caveated by `clock_offset_ms`. Never merge, order, or resolve
  anything with it.

**`clock_offset_ms` is for display honesty, not arithmetic.** It records what the authoring device
knew about its own clock at the time it wrote the report:

- Measured on load by comparing the device clock to the server's, and retained for use offline. A
  device that has never reached the server writes **`null`**.
- **`null` is not `0`.** Zero means "checked, and correct". Null means "nobody ever checked". An
  implementation that coalesces null to zero is asserting a clock is good when nothing knows that,
  which is precisely the confident-looking wrongness this format exists to prevent.
- **Never subtract it from `observed_at` in the log.** The report says what the reporter's device
  said, forever. A reader may render a corrected time *for display*, but the fact is immutable —
  rewriting it would make the log a record of what we think happened rather than what was reported.
- It is per-report, not per-participant: a hunter may fix their clock mid-hunt, and their earlier
  reports keep the offset that was true when they were written.

## Versioning

`v` is the format version, currently `1`.

- New optional fields do not bump `v`. **Ignore fields you do not recognise** — do not drop them on
  re-emit if you are relaying.
- A change to the meaning of an existing field bumps `v`. Since the log is append-only and immutable,
  a `v` bump means readers must handle both, forever. There is no migration; there is only addition.

This is the cost of an append-only design, and it is why the mapping to existing on-air formats was
settled now (see [aprs-mapping.md](aprs-mapping.md)) rather than after a log existed that could not
express them.
