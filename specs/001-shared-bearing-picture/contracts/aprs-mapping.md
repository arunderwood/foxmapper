# Contract: APRS Mapping

Constitution Principle V: *"report semantics (bearing quality, range, signal-strength grading) MUST
map losslessly to the APRS DF and DFS formats… Every report kind MUST be expressible in, and
ingestible from, an existing on-air format where one exists."* And, pulling the other way: *"Protocol
vocabulary (NRQ, DFS, PHG) MUST NOT appear on any participant-facing surface."*

The principle says the two rules conflict on purpose, and that **the interface wins and the mapping
absorbs the ugliness**. This document is where the ugliness lives.

**P1 ships no gateway.** Nothing here transmits. This module exists because "losslessly" is a claim
that is only true if tested, and because settling the mapping now — while the log format is still
cheap to change — is what stops us from discovering later that an immutable log cannot express a
format the constitution requires it to.

## The headline: we are not inventing

Three of the four kinds already exist on the air, and one of them fits so exactly it is worth quoting:

> "A signal strength of zero (0) is particularly significant, because APRS uses these 0 signal reports
> to draw (usually black) circles where the jammer is not heard. These black circles are extremely
> valuable since there will be a lot more reports from stations that do not hear the jammer than from
> those that do. This quickly eliminates a lot of territory."
> — APRS101.PDF, p.30

That is our `null` kind, described in the 1990s, for our exact use case. `DFS` was also designed to be
crowdsourced over a voice repeater by stations without DF gear, with reports entered by a third party
on others' behalf — our unequipped hunter and our net control, two decades early.

| Our kind | On-air format | Status |
|---|---|---|
| `bearing` | `/BRG/NRQ` DF report | Exists. Lossless. |
| `omni` | `DFSshgd`, `s` = 1–9 | Exists. Lossless. |
| `null` | `DFSshgd`, **`s` = 0** | Exists. Lossless. Its documented purpose is exactly ours. |
| `fix` | **none** | **No format exists.** See below. |
| relayed | Third-party traffic (`}`) | Exists. Structurally identical to observer vs. entering operator. |

## `bearing` → `/BRG/NRQ`

Wire shape (APRS101 pp. 35–36), an 8-byte field after CSE/SPD:

```
=4903.50N/07201.75W\000/000/270/943
                            ^^^ ^^^
                            BRG NRQ
```

| Ours | Wire | Rule |
|---|---|---|
| `heading_true` | `BRG` | Three digits, 001–360. `heading_true` rounded; 0 → `360`. |
| — | `N` | **Always `9`.** |
| `max_range_r` | `R` | Direct, raw digit. Ours is always 1, 3, or 5. Range = 2^R miles. |
| `confidence_q` | `Q` | Direct, raw digit. Ours is always 3, 4, or 5. |

**N = 9 is not a fudge.** APRS101: `9` = *"report is manual"*. 1–8 encode a hit rate from an automatic
Doppler unit; every FoxMapper report is hand-entered by a human. 9 is simply correct.

**CSE/SPD = `000/000`.** We do not report course or speed. `000` also carries the documented meaning
"the DF station is fixed", which is true at the moment of observation.

**The DF symbol (`/\`) is required.** APRS101 states BRG/NRQ is only meaningful with that symbol.

### The Q table is contested — read this before touching it

Two authoritative sources disagree, and aprs.org concedes the spec is deficient (*"Page 34 DF NRQ is
not defined in spec"*, addendum 1.1).

| Q | APRS101.PDF | PROTOCOL.TXT (2008, "to clarify Q byte") |
|---|---|---|
| 0 | Useless | **OMNI** |
| 1 | < 240° | 128° |
| 2 | < 120° | 64° |
| 3 | < 64° | 32° |
| 4 | < 32° | 16° |
| 5 | < 16° | 8° |
| 6 | < 8° | **absent — the table omits 6** |
| 7 | < 4° | 4° |
| 8 | < 2° | 2° |
| 9 | < 1° | 1° |

**Rules that follow, and they are not negotiable:**

1. **Store the raw digit. Never store decoded degrees.** Decoding on write would freeze our reading of
   a disputed spec into an immutable log.
2. **APRS101 is normative for display**, because Xastir — the reference implementation — implements
   its table exactly.
3. **Q=0 is overloaded** ("useless" vs "omni") and we never emit it. On ingest, retain the digit and
   render nothing directional.

### Why we only ever emit Q ∈ {3, 4, 5}

The scale reaches Q=9 (<1°). **We deliberately cannot.**

Compass error is 10–30° near a vehicle or an antenna, and ±10° at 5 km is ~870 m of cross-track. Our
three buckets map to:

| Bucket (plain language, on screen) | Q | Claim |
|---|---|---|
| roughest | 3 | < 64° |
| middle | 4 | < 32° |
| best we allow | 5 | **< 16°** |

A button that let a hunter claim <1° would render a needle-thin wedge that looks authoritative and is
fiction — at the exact moment they are least able to judge it, cold and gloved on a hilltop. **The cap
is Principle I expressed as an encoding constraint.** A log emitting Q=8 would still parse and would
still be "valid APRS"; it would not be FoxMapper.

Ingest is asymmetric on purpose: **we accept any Q 0–9 from the air and retain it raw** in the report's
`wire` object ([log-format.md](log-format.md)). We do not widen what our own interface can claim.

### The same cap, on the other two axes

| Ours | Authored | Ingested | Why the interface is narrower |
|---|---|---|---|
| `confidence_q` | 3, 4, 5 | 0–9 | Compass error is 10–30°. <1° is fiction. |
| `max_range_r` | 1, 3, 5 → 2, 8, 32 mi | 0–9 → 1…512 mi | 512 miles is meaningless for a hunt; ten targets fails a gloved thumb. |
| `strength_s` | 2, 5, 8 | 1–9 (0 = `null`) | A shouted S-meter guess is a judgement, not a measurement. |

The pattern is one decision applied three times: **the on-air scale is what we accept, and a fat-button
subset is what we claim.** The mapping absorbs the difference, exactly as Principle V instructs.

## `omni` and `null` → `DFSshgd`

Wire shape (APRS101 p.30), 7 bytes after the symbol code:

```
/234517h4903.50N/07201.75W>DFS2360
                           ^^^^^^^
```

| Wire | Meaning | Ours |
|---|---|---|
| `s` | Signal strength, S-points 0–9 | `omni.strength_s` (1–9), or **0 for `null`** |
| `h` | Height above average terrain: 10·2^h feet | Not collected — see below |
| `g` | Antenna gain, dB | Not collected — see below |
| `d` | Directivity: 45·d degrees, 0 = omni | Always `0` (omni) |

The operator-facing S scale (DF.TXT) is what our strength picker means, in hunters' words:

```
0  No signal detected what-so-ever          5  Some noise but easy to copy
1  Detectible signal (Maybe)                6  Good signal with detectible noise
2  Detectible (certain, not copyable)       7  Near Full-quieting
3  Weak, marginally readable                8  Dead Full-quieting, no noise
4  Noisy but copyable                       9  Extremely strong, "pins the meter"
```

**`null` is `s = 0`, and that is the whole encoding.** One format, two kinds in our domain — because
FR-005b requires a distinct "I hear nothing here" affordance and a hunter does not think of silence as
"strength zero". Interface wins; mapping absorbs.

### The one real asymmetry, written down rather than discovered

Upstream, `h` and `g` **matter for a negative report**: they size the circle within which the station
can assert non-detection. A 0-report from a high antenna negates far more territory than one from a
handheld.

**P1 collects neither, because P1 draws no circle** — it draws a marker at a position (FR-011a).
Interpreting how much ground a null report kills is *fusion*, and there is no fusion.

Consequences, precisely:

- **Outbound**: emit `h`, `g`, `d` as documented defaults (`0`, `0`, `0`). Our own reports round-trip
  exactly through our own mapping, which is what FR-020's losslessness requires of them.
- **Inbound**: retain `h`, `g`, `d` **raw**, in the report's `wire` object — defined in
  [log-format.md](log-format.md#ingested-reports-the-wire-object) — even though P1 renders nothing
  with them. Dropping them would be lossy *from* the air, and FR-020 says "to and from".
- **When fusion arrives**, `h` and `g` become live inputs and this interface will need to ask for
  them. That is a known future cost, recorded here so it is not a surprise.

Also noted from the source: APRS plots strength as `P = 10/s`, so **`s=0` divides by zero** — the 1.2
addendum's unofficial fix is to treat 0 as 0.8. Irrelevant to P1 (no plotting math), and a live
concern the day fusion lands.

## Relayed reports → third-party traffic (`}`)

APRS101 pp. 84–86. TNC-2 form:

```
}WB4APR-14>APRS,TCPIP,G9RXG*:<original data>
 ^^^^^^^^^                ^^^^^
 original station         relaying gateway
```

The original station's callsign survives **unchanged at the head of the header**; the relay is named
separately. That is structurally our `observer` vs `entered_by` (FR-007b), which is a good sign: the
split we derived from "a voice hop is where error enters" is the same one AX.25 arrived at.

| Ours | Wire |
|---|---|
| `observer.callsign` | Source callsign in the third-party header |
| `entered_by.callsign` | Receiving gateway callsign, with `*` |
| derived `relayed` | Presence of the `}` construct |

**Known upstream lossiness, ours to inherit, not to fix**: the third-party header strips "unused"
digipeaters and the asterisk. We carry none of those fields, so nothing of ours is lost.

## `fix` → nothing exists

**Checked and confirmed absent.** APRS101 (including the full symbol and DTI tables), DF.TXT,
omnidf.txt, dfing.html, and the 1.1 and 1.2 addenda contain **no** convention, DTI, data extension, or
symbol for "transmitter found". DF.TXT discusses the end of a hunt only narratively, with no reporting
format attached.

Principle V requires an existing format *"where one exists"*. **None exists**, so this is the one kind
where we define new semantics — a bare kind, position, and time.

The closest existing primitives are an Object/Item at the location or a position report with a
comment. **Both were rejected**: neither *means* "found", so mapping onto them would claim an interop
guarantee the format does not make, and a future reader would trust it. Declaring the gap honestly is
worth more than a mapping that looks complete.

## Vocabulary firewall

**Nothing in this document may reach a participant.** Not `NRQ`, `DFS`, `PHG`, `Q`, `R`, `N`, `S`, nor
any of the digits.

The reason is in the principle itself: these are a 1990s encoding most APRS clients never implemented
and the great majority of active hunters have never met. Reusing them is an *interoperation* decision.
Showing them would be a *vocabulary* decision, and a bad one.

So: this mapping lives in exactly one module (`web/src/aprs/mapping.ts`), imported by nothing that
renders. The interface asks "how sure are you?" and "how far could it be?" and offers "I hear nothing
here". SC-008 asserts zero jargon terms across every reachable screen.

## Testing the word "losslessly"

FR-020 says the mapping is lossless. That is a property, so it is tested as one (`proptest`,
`vitest`):

| Property | Statement |
|---|---|
| Round-trip, ours | `decode(encode(r)) == r` for every report our interface can author. |
| Round-trip, theirs | `encode(decode(w)) == w` for every valid wire string, including Q=0…9, s=0…9, and non-default `h`/`g`/`d`. |
| Q is never narrowed | `encode(r).Q ∈ {3,4,5}` for all authored `r` — the honesty cap, asserted mechanically rather than trusted to review. |
| Raw retention | Ingested `h`, `g`, `d`, and out-of-range `Q` survive a decode/encode cycle unchanged. |
| `null` is s=0 | `encode(null_report).s == 0`, always. |

The second property is the one that will fail first, and it should: it is where "we accept what the
air gives us" meets "we only emit what we can honestly claim".

## Sources

[APRS101.PDF](https://www.aprs.org/doc/APRS101.PDF) ·
[PROTOCOL.TXT](https://www.aprs.org/APRS-docs/PROTOCOL.TXT) ·
[DF.TXT](https://www.aprs.org/DF-ing/DF.TXT) ·
[omnidf.txt](https://www.aprs.org/DF-ing/omnidf.txt) ·
[Addendum 1.1](https://www.aprs.org/aprs11.html) ·
[Addendum 1.2](https://www.aprs.org/aprs12.html) ·
[Xastir `draw_symbols.c`](https://github.com/Xastir/Xastir/blob/master/src/draw_symbols.c)
