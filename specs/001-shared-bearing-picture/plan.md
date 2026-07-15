# Implementation Plan: Shared Bearing Picture

**Branch**: `001-shared-bearing-picture` | **Date**: 2026-07-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-shared-bearing-picture/spec.md`

## Summary

A hunt is a code and a shareable link. Participants open the link on a phone, join with a callsign,
and submit four kinds of immutable report — bearing, signal strength, heard-nothing, and found-it.
Every report is drawn on a shared map from its observer's position. No estimate is computed.

The technical shape follows almost entirely from the constitution rather than from preference:

- **The log is a grow-only set of immutable JSON reports keyed by a random UUID.** Merge is set
  union. No CRDT library — a G-Set *is* the trivial CRDT, and a library's binary wire format would
  directly violate "the log format MUST be documented and reimplementable by a third party."
- **The client is where everything happens.** It holds the whole log in IndexedDB, renders the map
  from it, and never needs the server to be useful. The server is a relay: it stores reports, hands
  out what a device is missing, and purges at 30 days. It has no opinion about direction finding.
- **Sync and realtime are one endpoint.** The server assigns a monotonic sequence to each report;
  that sequence is the SSE `id:`, and the browser's `Last-Event-ID` is the sync cursor. Catch-up
  after four offline hours and live push are the same code path.
- **Offline is the default posture, not a mode.** Reports are written locally first and queued for
  the server. Nothing blocks on the network.

Three research findings changed the design and are worth reading before the gates:

1. **Negative reports already exist on the air.** APRS `DFS` with signal strength `0` is a documented,
   load-bearing format meaning "nothing heard here" — used exactly as our spec intends, to eliminate
   territory. Our `null` kind maps to it losslessly. We are not inventing.
2. **Both iOS and Android give a *magnetic* heading, never true.** FR-009 requires true north, so
   declination must be computed on-device, offline. This is solved by an ~8 KB library carrying the
   World Magnetic Model — with a hard expiry in 2029 that must be caught rather than crashed into.
3. **Compass error dominates every other error term by orders of magnitude.** 10–30° near a vehicle
   or an antenna; ±10° at 5 km is ~870 m of cross-track. This sets what the three confidence buckets
   are allowed to claim, and it is the single most important input to Principle I in this feature.

## Technical Context

**Language/Version**: Rust 1.83+ (server); TypeScript 5.7+ (client)

**Primary Dependencies**: Server — `axum`, `tokio`, `sqlx` (Postgres), `serde`. Client — `maplibre-gl`
5.x (map, BSD-3), `@turf/sector` (bearing wedge geometry, MIT), `geomagnetism` (WMM2025 declination,
Apache-2.0, ~8 KB), `idb` (IndexedDB wrapper, ~2 KB). No CRDT library, no UI framework mandated by
this plan.

**Basemap**: [OpenFreeMap](https://openfreemap.org/) hosted vector tiles — no API key, no registration,
no cookies, complete styles including glyphs and sprites, MIT, attribution required
(`OpenFreeMap © OpenMapTiles Data from OpenStreetMap`). Fully open with no open-core, so self-hosting
stays available later without a rewrite. **We do not ship a basemap and do not pre-download one** —
see Complexity Tracking.

**Storage**: Server — Postgres on Render, one append-only `reports` table per the log format contract.
Client — IndexedDB keyed by report ID (the G-Set is literally an object store); one `localStorage`
string for "the last hunt I was in" (FR-004c). No OPFS, no tile archive.

**Testing**: Server — `cargo test`, plus `proptest` for the APRS mapping round-trip (FR-020 says
*losslessly*, which is a property, so it gets property tests). Client — `vitest` for the log fold and
mapping, Playwright for the join/report/render flows and an offline self-test.

**Target Platform**: iOS Safari 17+, Android Chrome (recent). Linux server on Render. HTTPS required —
not a preference: `DeviceOrientationEvent.requestPermission()`, `crypto.randomUUID()`, and service
workers all demand a secure context.

**Project Type**: Web — offline-first PWA plus a thin relay service.

**Performance Goals**: Report visible on other connected devices within 5 s (SC-002). Joined and
looking at a map within 15 s from a cold link (SC-001). A report entered in under 10 s, one-handed
(SC-001a/b).

**Constraints**: Functions with no network for the duration of a hunt (Principle III). No account, no
install, no payment (Operating Constraints). No direction-finding logic server-side (Principle III/IV
and Development Workflow). Union merge with no conflict resolution (Principle IV).

**Scale/Scope**: Tens of participants per hunt; thousands of reports per hunt; 30-day idle retention.
This is small enough that the simplest correct option is the right option nearly everywhere, and the
plan says so rather than building for a scale that will not arrive.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Honest Uncertainty**: **This feature presents no derived estimate at all** (FR-013), so
      there is no credible region to render and no posterior to degrade. Every pixel on the map is a
      report someone actually entered. The gate's geometry conditions (<3 reports, narrow spread,
      multi-modal) cannot arise because nothing is fused. Where the principle *does* bite is the
      bearing wedge, and research changed the answer: **compass error is 10–30° near metal**, so the
      three confidence buckets are capped at what a compass can actually deliver — the narrowest
      claims <16°, and the APRS scale's optimistic <1°/<2°/<4° steps are deliberately unreachable
      from our interface. A wedge whose width was set by a picker offering "<1°" would be a
      confident-looking lie. Provenance is treated the same way: a relayed report is marked as having
      crossed a voice hop (FR-012b), in the primary view, not a tooltip. No uncertainty signal is in
      a footer, tooltip, or dismissible modal.
- [x] **II. Every Radio Contributes**: Yes. `omni` (signal strength 0–9) and `null` (heard nothing)
      are report kinds in the same log, entered from the same surface, rendered on the same map, with
      no directional antenna and no training required (FR-005a/b/d). They are not annotations beside
      the evidence; they *are* evidence, and in P1 there is no estimate for them to be excluded from.
      Research reinforces this: on the air, the negative report (`DFS` s=0) is the *high-volume*
      contribution — "there will be a lot more reports from stations that do not hear the jammer than
      from those that do."
- [x] **III. Offline Is the Normal Case**: With no network for the whole hunt, a joined device reads
      and writes its full local log, renders every report it holds, computes all derived state, takes
      GPS fixes (confirmed: platform geolocation works dataless on both platforms), reads the
      compass, and converts to true north with an on-device magnetic model. Reports are written to
      IndexedDB first and queued; the network is never in the write path, so connectivity loss cannot
      lose or block a report. FR-018 surfaces what the device is missing, and the queue depth is shown
      so a participant knows reports are still stuck on their phone. **The honest weak spot is the
      basemap** — see Complexity Tracking; it degrades to blank-with-reports rather than costing a
      report. First join still requires coverage once (an accepted, spec-recorded limit).
- [x] **IV. Append-Only Log, Derived State**: Reports are immutable. Retraction is a new record
      naming a prior report's ID (FR-010) — never a mutation, never a delete. The store is a G-Set;
      merge is `union`, which is associative, commutative and idempotent, so no conflict can arise and
      no participant is asked to resolve one. The map, the target's found-state, and the retraction
      view are all a fold over the same log, computed identically on every client and never
      authoritative on the server. The log format is plain JSON documented in
      [contracts/log-format.md](contracts/log-format.md) — reimplementable in an afternoon, which is
      the actual test the principle sets.
- [x] **V. Interop Over Invention, Plain Language**: Per report kind:
      - `bearing` → APRS **`/BRG/NRQ`** DF report. Lossless; we carry the raw N, R and Q digits.
      - `omni` → APRS **`DFSshgd`** with strength digit `s` = 1–9.
      - `null` → APRS **`DFSshgd` with `s` = 0**. This is not a stretch: the format's documented
        purpose is drawing where the signal is *not* heard.
      - `fix` → **no on-air format exists.** Verified against APRS101, DF.TXT, omnidf.txt and the 1.1
        and 1.2 addenda: there is no APRS convention, DTI, extension or symbol for "transmitter
        found". The principle's "where one exists" clause applies; we define minimal new semantics and
        say so rather than bending an unrelated format to fit.
      - relayed reports → APRS **third-party traffic (`}`)**, which preserves the original station's
        callsign in the header while naming the relaying gateway — exactly the observer/entering-
        operator split FR-007b requires.

      Vocabulary: no NRQ, DFS, PHG, Q-value or S-point ever reaches a participant-facing surface. The
      mapping lives in one module with round-trip property tests, and the interface speaks in
      bearings, "how sure are you", "how far could it be", and "I hear nothing here". Where the two
      rules conflict — the on-air Q scale offers nine steps, the field needs three fat buttons — the
      interface wins and the mapping absorbs it (FR-006a/b).
- [x] **Operating Constraints**: **RF leg**: P1 ships no on-air gateway, so no message content
      touches amateur spectrum; the APRS mapping is a data-model property with tests, not a
      transmitter. Nothing is encrypted on a leg that does not exist, and hunt content carries no
      business communications. **Privacy**: position is per-report only; there is no continuous
      tracking, no background location (iOS forbids it in a tab anyway), and no movement trace.
      **One new exposure, recorded rather than assumed away**: using a hosted basemap means the tile
      provider sees each participant's IP and the tile coordinates they request — approximate position
      and what ground they are studying, for as long as the map is open. That is a fuller picture of a
      hunter's movement than the reports they file. It does not make the *product* a location beacon
      (no participant's position is shared with anyone by this), and it is what every web map does,
      but it is a third party learning where hunters are. Accepted because the alternative is a tile
      pipeline we have declined to build; OpenFreeMap runs no user database and sets no cookies, which
      is the best available position short of self-hosting. **Revisit if a hunt ever needs to be
      private from its infrastructure.**
      Hunts purge 30 days after their last report. **Liability**: FR-022 states the limits in the
      interface — not certified for life-safety search, and the picture is only as good as the reports
      entered. **Cost of entry**: joining needs no account, no install, no payment. The Add-to-Home-
      Screen prompt is an *offer* to mitigate iOS storage eviction, never a gate — see Complexity
      Tracking, because it is the one place where the best available mitigation is the one the
      constitution forbids requiring.
- [x] **Fusion discipline**: **This plan touches no location-estimate mathematics.** There is no
      posterior, no weighting, no triangulation, no intersection of wedges. `@turf/sector` computes
      the polygon of a wedge the observer described; it does not combine two of them. No named user
      story motivates fusion, so none is built.

## Project Structure

### Documentation (this feature)

```text
specs/001-shared-bearing-picture/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── log-format.md    # The report log — the third-party-reimplementable contract (FR-021)
│   ├── http-api.md      # Relay endpoints: join, append, sync cursor, SSE stream
│   └── aprs-mapping.md  # Lossless mapping to /BRG/NRQ, DFSshgd, third-party (FR-020/020a)
├── checklists/
│   └── requirements.md  # Spec quality checklist (21/21)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/                       # Rust relay. Knows nothing about direction finding.
├── src/
│   ├── main.rs               # axum wiring, config, graceful shutdown
│   ├── routes/
│   │   ├── hunts.rs          # create hunt, fetch hunt metadata
│   │   ├── reports.rs        # append (idempotent by ID), sync since cursor
│   │   └── stream.rs         # SSE; id: = server sequence, honors Last-Event-ID
│   ├── store/
│   │   ├── mod.rs            # single-writer append, cursor reads
│   │   └── purge.rs          # 30-day idle purge job
│   └── model.rs              # opaque report envelope — server does not parse the payload
├── migrations/               # sqlx migrations: hunts, reports
└── tests/
    ├── append_idempotent.rs  # same ID twice = one row
    ├── sync_cursor.rs        # no gaps, no loss under concurrent append
    └── purge.rs              # idle clock restarts on every report

web/                          # TypeScript PWA. Everything that matters lives here.
├── src/
│   ├── log/
│   │   ├── gset.ts           # union merge, dedupe by ID — the whole CRDT
│   │   ├── fold.ts           # log → derived state (map, found-state, retractions)
│   │   ├── store.ts          # IndexedDB persistence, load-all-on-open
│   │   └── sync.ts           # outbound queue, SSE + Last-Event-ID, poll fallback
│   ├── report/
│   │   ├── bearing.ts        # heading capture, declination, confidence + range buckets
│   │   ├── omni.ts           # strength 0-9
│   │   ├── heard_nothing.ts  # the null kind
│   │   ├── fix.ts            # found it
│   │   └── relay.ts          # enter on behalf of an observer (net control)
│   ├── sensors/
│   │   ├── heading.ts        # iOS webkitCompassHeading vs Android deviceorientationabsolute
│   │   ├── declination.ts    # WMM via geomagnetism; 2029 expiry guarded
│   │   └── position.ts       # watchPosition, discard early fixes
│   ├── map/
│   │   ├── basemap.ts        # MapLibre + hosted OpenFreeMap style; blank-but-working when unreachable
│   │   ├── wedge.ts          # @turf/sector → GeoJSON fill
│   │   └── layers.ts         # report rendering per kind, relay marking, attribution
│   ├── aprs/
│   │   └── mapping.ts        # the interop mapping + its inverse (no gateway in P1)
│   └── ui/                   # join, report entry, map view, limits notice
├── public/
│   └── sw.ts                 # service worker: app shell precache
└── tests/
    ├── unit/                 # gset union laws, fold determinism, aprs round-trip
    └── e2e/                  # join <15s, report <10s, offline self-test, 4-device render
```

**Structure Decision**: Two deployables, `server/` and `web/`, because they are genuinely different
things in different languages with different lifecycles — not because a layered architecture was
wanted. The split follows the constitution's Simplicity rule directly: the server has no opinion
about direction finding, so *all* domain logic (log fold, geometry, sensors, APRS mapping) lives in
`web/` and none of it is duplicated server-side. There is no shared domain crate because there is no
shared domain — the server treats a report as an opaque envelope with an ID and a sequence. This is
also why the Rust/TypeScript split costs nothing: the usual objection to a two-language stack is
duplicated model logic, and here the constitution has already forbidden the duplication.

## Build Sequence

Dependency order, with the section that specifies each step. If a step has no reference, it is not
specified yet and that is a defect — say so rather than inventing it.

**Stage 1 — the log, in memory.** No server, no browser, no map. Pure functions and their properties.

| # | Build | Specified by | Done when |
|---|---|---|---|
| 1.1 | Report types, all five kinds | [log-format.md](contracts/log-format.md) · [data-model.md](data-model.md#report) | Types reject a `confidence_q` of 8 at compile time |
| 1.2 | `gset.ts` — union by `id` | [log-format.md § Merge](contracts/log-format.md#merge) | Union laws hold as property tests |
| 1.3 | `fold.ts` — log → derived state | [log-format.md § The fold](contracts/log-format.md#the-fold) · [data-model.md § Derived state](data-model.md#derived-state--the-fold) | **Retraction-before-target passes.** Order-independence is a property test, not a hope |
| 1.3a | `colour.ts` — callsign → swatch; duplicate detection | [log-format.md § Observer colour](contracts/log-format.md#observer-colour-is-derived-not-stored) | Same callsign → same swatch on any device; suffix appears only on a real collision, and **not** when a callsign is merely relayed |
| 1.4 | `aprs/mapping.ts` + inverse | [aprs-mapping.md](contracts/aprs-mapping.md) | Both round-trips pass; `Q ∈ {3,4,5}` asserted mechanically |

Stage 1 is the whole domain. It is testable with no I/O, and it is where the constitution actually
lives. Do not start Stage 2 until its properties pass.

**Stage 2 — the relay.** Still no browser.

| # | Build | Specified by | Done when |
|---|---|---|---|
| 2.1 | Migrations: `hunts`, `reports` | [data-model.md § Server-side model](data-model.md#server-side-model) | `body` is jsonb and nothing reads inside it |
| 2.2 | `POST /api/hunts` + code generation | [http-api.md § Hunt codes](contracts/http-api.md#hunt-codes) | **≥40 bits from a CSPRNG.** The naive word-word-NNNN is ~29 bits and fails this |
| 2.3 | `POST …/reports` — idempotent by `id` | [http-api.md](contracts/http-api.md) | Same `id` twice = one row, `202` both times |
| 2.3a | Rate limit (anti-flood only) | [http-api.md § Rate limiting](contracts/http-api.md#rate-limiting) | Never fires during a real hunt; `429` leaves the report queued, never dropped |
| 2.4 | Single-writer append | [http-api.md § The sequence gap](contracts/http-api.md#the-sequence-gap) | Concurrent appends produce no cursor-visible gap |
| 2.5 | `GET …/reports?since=` | [http-api.md](contracts/http-api.md) | `since=0` returns everything |
| 2.6 | SSE stream, `id:` = seq | [http-api.md](contracts/http-api.md) | `Last-Event-ID` resumes; purged hunt returns `204` |
| 2.7 | `id_digest` | [http-api.md § id_digest](contracts/http-api.md) | Matches the exact spec — sort, `\n`, no trailing newline |
| 2.8 | 30-day idle purge | [data-model.md § Hunt](data-model.md#hunt) | Clock restarts on every append |

**Stage 3 — the client spine.** Still no map, no sensors.

| # | Build | Specified by | Done when |
|---|---|---|---|
| 3.1 | `store.ts` — IndexedDB, load-all-on-open | [research.md § 6](research.md) | Survives force-quit |
| 3.2 | `sync.ts` — outbound queue, SSE, poll fallback | [http-api.md](contracts/http-api.md) · [research.md § 4](research.md) | Queue drains only on `2xx`; reconnect re-creates `EventSource` on `CLOSED` |
| 3.3 | Local participant identity | [http-api.md § Joining is local](contracts/http-api.md#joining-is-a-purely-local-act) | Works with the network already gone |
| 3.4 | Divergence audit | [http-api.md](contracts/http-api.md) | Only runs when the outbound queue is empty |

**Stage 4 — sensors.** Hardware only. A passing CI run here means nothing.

| # | Build | Specified by | Done when |
|---|---|---|---|
| 4.1 | `heading.ts` — iOS vs Android | [research.md § 5](research.md) | Feature-detects; does not read zeros on Safari |
| 4.2 | `declination.ts` — WMM | [research.md § 5](research.md) | **2029 expiry caught, not thrown.** Bellingham shows ~15.2° |
| 4.3 | `position.ts` | [research.md § 5](research.md) | Early km-scale fixes discarded |

**Stage 5 — the map.**

| # | Build | Specified by | Done when |
|---|---|---|---|
| 5.1 | `wedge.ts` — `@turf/sector` | [data-model.md § Rendering](data-model.md#rendering-rules) | North wraparound correct |
| 5.2 | `layers.ts` — per kind, relay marking | [data-model.md § Rendering](data-model.md#rendering-rules) | `omni`/`null` imply no direction; relayed visibly marked |
| 5.3 | `basemap.ts` — OpenFreeMap style, attribution, blank-but-working fallback | [research.md § 6](research.md) | Map renders reports with the tile host unreachable; attribution present |
| 5.4 | Service worker: app shell precache only | [research.md § 7](research.md) | App loads offline. **Tiles are not pre-fetched — that is prohibited** |

**Stage 6 — UI.** Deliberately unspecified; see Open Decisions.

**Stage 7 — deploy.**

| # | Build | Specified by | Done when |
|---|---|---|---|
| 7.1 | Render service + Postgres | — | — |
| 7.2 | **Disable proxy buffering; HTTP/2** | [http-api.md § Deployment requirements](contracts/http-api.md) | `curl -N` shows events arriving one at a time, not in a burst |

7.2 is not tuning. Buffered SSE fails SC-002 **silently and only in production**.

## Open Decisions

Unresolved items a task-writer will hit. Recorded rather than guessed.

- **~~Observer colour~~ — RESOLVED 2026-07-15.** Colour is derived from the callsign and never stored;
  `observer.color` is gone from the log. FR-002a amended, FR-002b/c added. The consequence accepted
  along with it: a pure function of callsign cannot guarantee *distinct* colours, only consistent
  ones, so colour is an aid and the callsign is the identifier. Duplicates are distinguished by a
  suffix shown only on collision. **The only residual is the palette itself** (Stage 6.1) — the
  algorithm is settled, the twelve swatches are provisional and have had no colour-vision or
  direct-sunlight check.
- **UI/interaction is unspecified by choice.** No screens, states, or flows are documented. The
  consequence is accepted and worth naming: SC-001a/b (ten seconds, gloved) and SC-008 (zero jargon)
  are unverifiable until something exists, so the field gate is where a wrong flow gets found. Stage 6
  tasks will necessarily be coarse.
- **~~Clock-skew threshold~~ — RESOLVED 2026-07-15.** Offset measured against the server on load and
  retained offline; reporter warned above 2 minutes; the offset recorded per-report
  (`clock_offset_ms`, `null` = never measured) so every device can caveat the time. Never subtracted
  from `observed_at`. FR-009a–d.
- **`kind: "null"`** is a reserved word in JS. The wire value stays `"null"` (it is a string); the
  module is `heard_nothing.ts`. Noted so nobody "fixes" the wire format.

## Complexity Tracking

> Recorded per Governance: "Complexity that violates a principle MUST be recorded... an unrecorded
> violation is a defect regardless of merit." These are the places where a reviewer could reasonably
> reject on a principle, written down rather than discovered later.
>
> **All three accepted 2026-07-14.** They are decisions, not open questions. Re-open only on new
> evidence from a field test.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **There is no offline basemap** (Principle III). Offline, in ground the hunter has not already looked at, the map renders reports and positions over *blank space* rather than streets. This is the strongest-worded violation in the plan and it is a deliberate choice, not a shortfall. | Every tile provider that could supply an offline archive **prohibits it**. OSMF's [vector](https://operations.osmfoundation.org/policies/vector/) and [raster](https://operations.osmfoundation.org/policies/tiles/) policies both ban bulk downloading by name — *"downloading of tiles in advance instead of downloading when a user views those tiles"*, listing offline use as the prohibited example. Building our own PMTiles pipeline to escape that is a basemap-hosting project bolted onto a story whose whole premise is being the smallest useful thing. Principle III's own wording is *"degrading only to the reports the device already holds"* — reports are never lost or blocked and the picture still renders; it is the *context* that goes. **Partial mitigation that costs nothing and breaks no policy**: OSMF's policy *requires* honouring cache headers for at least 7 days and only forbids **pre-emptive** fetching, so tiles the hunter actually viewed while in coverage legitimately remain cached. Ground already looked at stays drawn. | **Bundling a basemap** blows SC-001's 15-second join and the install-free constraint. **A "download this area" button** is exactly what the providers prohibit — we would be asking users to violate a policy on our behalf. **Self-hosting a PMTiles pipeline** (AOI extracts, glyph hosting, OPFS, and the 206/Cache-Storage problem) is real infrastructure for a hobby tool, and the client's hardest code would exist solely to serve the least-tested path. **Blocking the map until tiles arrive** violates Principle III far worse — a network round-trip in the field path. A blank-but-working map is the only option that breaks no policy and still renders every report offline. **If the blank map proves useless outdoors, the field gate will say so** — and that answer is worth more than a tile pipeline built on a guess. |
| **The best mitigation for iOS storage eviction is one we may not require** (Operating Constraints vs. Principle III). iOS deletes script-writable storage — IndexedDB *and* service worker caches — after 7 days of Safari use without interaction on the site. Home Screen web apps are exempt. The exposed case is a report authored offline and not yet synced, on a phone that gets evicted: SC-005's "100% present" would be false. | The 30-day interference hunter is exactly the usage pattern this rule punishes, and Background Sync — which would flush the queue opportunistically — does not exist on iOS. So the strongest fix is Add to Home Screen, which the constitution forbids *requiring*. We offer it, call `navigator.storage.persist()`, show the unsynced count, and get reports to the server as fast as possible so the vulnerable window stays small. | **Requiring install** violates "no install" outright — not a candidate. **Ignoring it** would leave a silent path to a lost report, which Principle III forbids. **Assuming `persist()` saves us** is not verifiable from primary sources (see research.md); designing as though it were a guarantee is exactly the confident-looking wrongness Principle I exists to prevent. It becomes a field test, not an assumption. |
| **P1 ships an APRS mapping module with no on-air gateway** (arguably unearned complexity under Simplicity). | FR-020/020a make losslessness a requirement of the *recorded meaning*, and "lossless" is a property that is only true if tested. A documented mapping plus round-trip property tests is the minimum that makes the claim honest, and it locks the log's semantics to a real format now — when it is cheap — rather than discovering later that a field cannot be expressed. | **Deferring the mapping until a gateway exists** risks designing a log we cannot losslessly encode, which would make FR-020 retroactively false and force a log-format migration — the one thing an append-only design handles worst. **Shipping an actual gateway** is the genuinely unearned complexity, and is explicitly out of scope: no RF leg in P1. |

## Post-Design Constitution Re-Check

Re-evaluated after Phase 1 (data model, contracts, quickstart):

- **I. Honest Uncertainty** — Holds, and the design strengthened it. The confidence buckets are
  capped by measured compass reality (Q ∈ {3,4,5}; the narrowest claims <16°), and
  [data-model.md](data-model.md) records `heading_magnetic`, `declination`, the WMM epoch, and
  iOS's `webkitCompassAccuracy` alongside the true heading — so a bearing stays reinterpretable and
  its provenance is never lost. No derived estimate exists to overstate.
- **II. Every Radio Contributes** — Holds. `omni` and `null` are first-class in the log format and
  the contract, and `null` maps to a real on-air format whose documented purpose is exactly this.
- **III. Offline Is the Normal Case** — Holds for reports, with the basemap caveat recorded above.
  The write path never touches the network. The one residual risk (iOS eviction of unsynced reports)
  is recorded, mitigated, and assigned to field validation rather than assumed away.
- **IV. Append-Only Log, Derived State** — Holds and got simpler. No CRDT library; a G-Set over
  UUIDv4 keys. Retraction is a record, not a delete. Critically, the fold is specified as
  order-independent: *a retraction may legally arrive before the report it retracts*, so the fold
  accumulates retracted IDs and filters, rather than mutating a found record. The server stores an
  opaque envelope and holds no domain fact a device could not recompute.
- **V. Interop Over Invention, Plain Language** — Holds. Three of four kinds map to existing formats;
  the fourth is honestly declared as having no upstream format rather than being forced into one. Raw
  digits are carried rather than decoded values, because the Q table is genuinely contested between
  APRS101 and PROTOCOL.TXT — decoding on ingest would silently pick a side and lose information.
- **Operating Constraints / Fusion discipline** — Unchanged. No RF leg, no tracking, no estimate, no
  fusion mathematics anywhere in the design.

No new violations. The three recorded above are unchanged in substance after design.
