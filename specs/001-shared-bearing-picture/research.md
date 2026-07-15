# Phase 0 Research: Shared Bearing Picture

Findings that shaped the plan. Each entry records the decision, why, and what else was considered.
Where a source is contested or a claim is unverified, that is stated rather than smoothed over —
a plan that quietly guesses is the same failure mode Principle I exists to prevent.

## Resolved: stack and hosting

Two open questions were decided by the user rather than researched:

- **Rust server + TypeScript PWA.** The repository's `.gitignore` is a Cargo template, so Rust was
  intended. The client is TypeScript because maps, service workers, offline storage and the sensor
  APIs live there, and because the client is where all the UI iteration happens. There is no
  duplicated-domain cost, because the constitution forbids the server from having domain logic.
- **Postgres on Render** for the server's 30-day store.

---

## 1. APRS interop — the mapping is real, and better than expected

**Decision**: Map `bearing` → `/BRG/NRQ`, `omni` → `DFSshgd` (s=1–9), `null` → `DFSshgd` **with s=0**,
relayed → third-party traffic (`}`). Declare `fix` as having **no upstream format**. Carry **raw
digits**, never decoded values.

**Rationale**:

- **`DFS` with s=0 is the existing "heard nothing" format.** This was the most valuable finding of the
  whole phase. From APRS101.PDF p.30: *"A signal strength of zero (0) is particularly significant,
  because APRS uses these 0 signal reports to draw (usually black) circles where the jammer is not
  heard. These black circles are extremely valuable since there will be a lot more reports from
  stations that do not hear the jammer than from those that do."* Our `null` kind is not an
  invention — it is a 1990s format whose documented purpose is exactly our spec's. Principle V is
  satisfied without argument.
- **`DFS` needs no DF equipment**, by design: it was built to be crowdsourced over a voice repeater,
  with reports entered by a third party on others' behalf. That is our unequipped hunter and our net
  control, described in the source material two decades early.
- **The Q table is genuinely contested.** APRS101.PDF gives Q=1→<240°, 2→<120°, 3→<64°, 4→<32°,
  5→<16°, 6→<8°, 7→<4°, 8→<2°, 9→<1°. PROTOCOL.TXT (updated 2008, explicitly "to clarify Q byte")
  gives a *different*, beamwidth-flavoured table that **omits the digit 6 entirely** and reads Q=0 as
  OMNI rather than "useless". aprs.org's own 1.1 addendum concedes: *"Page 34 DF NRQ is not defined
  in spec."* Xastir, the reference implementation, follows APRS101. **We therefore store the raw
  digit and treat APRS101 as normative for display, and we never persist decoded degrees** — the
  decode is the contested part, so decoding on ingest would silently pick a side and destroy
  information we were handed.
- **N=9 means "report is manual"**, which is precisely what every report we author is. Our reports
  are hand-entered by a human, so N=9 is not a fudge — it is the correct value.
- **R encodes range as 2^R**, single digit, so range ∈ {1,2,4,…,512}. Units are miles per APRS101;
  Xastir's source comments say nautical miles and then ignore the distinction. We record the raw
  digit and document that we read it as APRS101 does.
- **Third-party traffic (`}`)** preserves the original station's callsign at the head of the header
  while naming the relaying gateway — structurally the same split as our observer vs. entering
  operator. Note it is *lossy* upstream (unused digipeaters are stripped), but not in any field we
  use.
- **`fix` has no on-air format.** Checked against APRS101 (including full symbol and DTI tables),
  DF.TXT, omnidf.txt, dfing.html, and the 1.1/1.2 addenda. There is no convention for "transmitter
  found". Principle V's "where one exists" clause applies. We say so plainly rather than bending an
  Object or a position comment into a shape it was not meant for.

**Alternatives considered**:

- *Decode Q to degrees on ingest and store degrees* — rejected: the table is contested, and Q=0 is
  overloaded ("useless" vs "omni"). Storing degrees would bake our reading of a disputed spec into an
  immutable log.
- *Invent a compact native encoding and map to APRS only at a future gateway* — rejected by Principle
  V: an on-air format exists for three of four kinds, so inventing is not permitted.
- *Force `fix` into an APRS Object* — rejected as dishonest interop: it would claim a mapping that the
  format does not define, and a future reader would trust it.

**Open, and deliberately not resolved here**: the APRS 1.2 addendum records unresolved defects about
whether `DFS` and `/BRG/NRQ` may coexist in one packet and whether `DFS` takes a trailing slash. Real
APRSdos packets contradict the spec. This only matters when a gateway exists; P1 has no RF leg.

**Sources**: [APRS101.PDF](https://www.aprs.org/doc/APRS101.PDF) ·
[PROTOCOL.TXT](https://www.aprs.org/APRS-docs/PROTOCOL.TXT) · [DF.TXT](https://www.aprs.org/DF-ing/DF.TXT) ·
[omnidf.txt](https://www.aprs.org/DF-ing/omnidf.txt) · [addendum 1.1](https://www.aprs.org/aprs11.html) ·
[addendum 1.2](https://www.aprs.org/aprs12.html) ·
[Xastir draw_symbols.c](https://github.com/Xastir/Xastir/blob/master/src/draw_symbols.c)

---

## 2. The log — a G-Set, and no library

**Decision**: Plain grow-only set of JSON reports keyed by **UUIDv4** (`crypto.randomUUID()`), stored
in IndexedDB, merged by union. **No Automerge, no Yjs.**

**Rationale**:

- A G-Set's merge is set union — associative, commutative, idempotent. That is the formal statement of
  "a union requiring no conflict resolution", and it is the *trivial* CRDT. There is nothing to
  import: `A ∪ B` over an ID-keyed Map is the whole implementation.
- **Retraction as a record keeps us in G-Set land.** A 2P-Set (add/remove) would drag in add-wins vs
  remove-wins semantics and stop being conflict-free. The spec's insistence that retraction is a new
  fact is not merely principled — it is what makes the merge trivially correct.
- **A library's wire format would violate FR-021.** Automerge's and Yjs's formats are binary,
  versioned, and defined by their implementations. Adopting one makes the log format "whatever this
  library version emits", and a third party reimplements it by using the library. Against that,
  *"a report is a JSON object with these fields; the log is a set keyed by id; merge is union"* is
  reimplementable in an afternoon in any language. That is the actual test Principle IV sets.
- **UUIDv4 over UUIDv7**: sortability is worthless here (merge must not depend on order) and v7's is
  actively misleading — it would sort by *entry* time on an untrusted phone clock, while FR-007
  requires we display *observation* time. It also leaks creation order, against the privacy
  constraint, for no benefit.
- **Content-hash IDs are disqualified by a spec edge case.** The spec says two operators relaying the
  same call produce two reports that must *not* be deduplicated. Content addressing would silently
  collapse them — destroying a real report, which is the one thing the design must never do.
- **(participant, counter) IDs are a trap**: the counter must be durably persisted, and the spec's own
  "device data cleared, or phone replaced" edge case would restart it at zero and reissue IDs that
  already exist with different payloads. Silent loss.
- **Make the append endpoint idempotent by ID.** Then the client retries blindly forever with no dedup
  logic — which is exactly what a flaky mobile link needs.

**Alternatives considered**: Automerge (~300 KB + WASM init — against a 15-second cold join over the
same marginal link that motivated offline-first), Yjs (~18 KB, still binary and opaque). Both solve
concurrent *mutation* of shared mutable structures; we have no mutation. A library earns its place
the day a genuinely mutable shared artifact appears — collaborative hunt notes, a multi-editor label.
Not P1.

**Note on bounds**: a G-Set grows forever, which is where CRDT libraries' tombstone GC earns its keep.
The 30-day idle purge bounds it, and a hunt is thousands of records. Not a problem at this scale.

---

## 3. Clocks — carry none of the machinery

**Decision**: No Lamport clock, no HLC. Reports carry `observed_at` (UTC epoch ms, client-authored).
The server separately stamps `received_at` as **envelope metadata, not part of the report**.

**Rationale**:

- **Skewed clocks cannot corrupt this log**, and that is worth stating loudly. Union never consults
  timestamps. There is no LWW register anywhere, so no clock can arbitrate anything, so no clock can
  cause data loss. A design with LWW would let the phone with the fastest clock win every conflict
  forever; that failure mode is designed out.
- Phone clock error is **correlated with our environment** — a phone with no cell service is not
  getting NTP, so skew is worst exactly where the app is designed to live.
- **Lamport would invent an ordering the evidence does not contain.** Two hunters taking bearings
  simultaneously in different places have no happens-before relationship. Imposing a total order on
  independent physical observations is, in miniature, the thing Principle I forbids.
- The one real causal edge — retraction → report — is already carried by an explicit ID reference,
  which is strictly better than a counter. **This yields an implementation rule worth writing down:
  a retraction may arrive before the report it retracts.** So the fold must accumulate retracted IDs
  and filter, never "find the report and mark it".
- Both would add fields to a format third parties must reimplement, for zero behaviour change.

**What we do instead**: detect gross clock skew (compare `observed_at` against the server's
`received_at` when a report syncs) and **tell the participant their clock is wrong — never silently
correct it**. Silent correction would mutate a reported fact.

**Flagged uncertainty**: whether per-report skew metadata earns its complexity in P1 is a field
question, not a design one. The minimal honest version — store, display, warn on gross skew — ships
first.

---

## 4. Sync and realtime — one endpoint

**Decision**: Monotonic server sequence + cursor. **SSE** with `id:` = sequence, so the browser's
`Last-Event-ID` *is* the cursor. Polling the same cursor is the fallback.

**Rationale**:

- Because merge is union over stable unique IDs, *any* protocol that eventually delivers everything is
  correct. Delivery may duplicate, reorder, and repeat. **So the job is to pick the simplest protocol,
  not the cleverest.**
- Per the [WHATWG spec](https://html.spec.whatwg.org/multipage/server-sent-events.html), if the server
  sets `id:`, the browser stores it and replays it as `Last-Event-ID` on reconnect automatically.
  Setting `id:` to the server sequence makes **reconnection and catch-up the same operation** — the
  handler is "stream everything above this sequence, then stream live". Sync after four offline hours
  and live push are one code path.
- HTTP **204 tells the browser to stop reconnecting permanently** — a clean fit for an expired,
  purged hunt (FR-004).
- It is plain HTTP: one GET, `text/event-stream`, debuggable with `curl`, reimplementable in any
  language. A real FR-021 win over WebSocket's handshake and framing.
- Unidirectional is *correct*: writes go over plain POST. Routing writes through a socket would couple
  the write path to connection state — exactly wrong when writes must queue locally regardless.

**Caveats that belong in the deploy doc, not discovered in production**:

- **SSE's "free reconnection" is oversold.** On a non-200 or wrong MIME type the UA must *fail the
  connection and not reconnect*. A transient 502 from a load balancer kills the stream permanently.
  We watch `onerror`, check `readyState === CLOSED`, and re-create with backoff.
- **Proxy buffering breaks SSE silently.** nginx buffers by default: events sit in a buffer, the
  client sees nothing for minutes, and SC-002's 5 seconds fails invisibly and only in production.
  Requires `X-Accel-Buffering: no` / `proxy_buffering off`.
- **Serve over HTTP/2 or HTTP/3.** HTTP/1.1's 6-connections-per-origin cap is marked *Won't fix* in
  Chrome and Firefox.
- **No custom headers on EventSource** — fine, since auth is possession of a hunt code in the URL.
  Minor consequence: the code lands in server access logs.

**The one place this design can silently lose a report**: if `seq` is assigned at transaction start
and commits land out of order, a reader can see seq 5 while 4 is still in flight, advance past it, and
never see 4. **Mitigation: serialize appends through a single writer.** At tens of participants this
costs nothing and removes the hazard entirely.

**Safety net**: expose `count` + a hash of sorted IDs; the client compares periodically (O(1)) and
only on mismatch does a full O(N) ID diff. *This is our own construction, not an established
protocol.* It is cheap insurance for "no report may be lost" — detecting divergence rather than
assuming correctness.

**Alternatives considered**: per-participant version vectors (needed for a future peer-to-peer leg —
BLE/LoRa is plausible for this project — but requires structured IDs and durable per-device counters,
and asserts a completeness it can lose); full set-difference sync (simplest to reason about, but
5,000 UUIDs ≈ 180 KB per sync — too much for a marginal link); WebSocket (rejected: no `Last-Event-ID`
equivalent, so we would rebuild it).

---

## 5. Sensors — the compass is the whole ballgame

**Decision**: Read the platform heading, convert to true north on-device with the World Magnetic
Model, record **both** magnetic and true plus the declination and model epoch, and let the reporter
correct the drafted heading before submitting (FR-008b).

**Findings**:

- **Both platforms give MAGNETIC heading, never true.** Verified from WebKit source, not docs echo:
  `WebCoreMotionManager.mm` reads CoreLocation's `magneticHeading`, not `trueHeading`. The widespread
  developer folklore that `webkitCompassHeading` is secretly true heading is **wrong**. Android's
  absolute orientation is likewise magnetic-referenced. This is good news: one consistent convention,
  declination applied once.
- **The APIs are not the same shape.** iOS: `deviceorientation` + `webkitCompassHeading`, behind
  `DeviceOrientationEvent.requestPermission()` which needs a user gesture and HTTPS. Android:
  `deviceorientationabsolute` + `360 - alpha` + screen-orientation correction. **Safari does not
  implement `deviceorientationabsolute` at all** — feature-detect, never assume.
- **iOS exposes `webkitCompassAccuracy` (±degrees, `-1` = needs calibration). Android exposes
  nothing.** On Android we are blind and can only prompt for a figure-eight with no way to know it
  worked. Worth recording per-report where available.
- **Compass error is the dominant error term, by orders of magnitude.** Soft-iron distortion peaks at
  **20–30° on a vehicle**, typically <10° otherwise (NXP AN4246). **±10° at 5 km is ~870 m of
  cross-track error.** Every other error source — geodesy model, GPS accuracy, declination precision —
  is a rounding error beside it.

  **This is the single most important input to Principle I in this feature.** It sets the ceiling on
  what the confidence buckets may claim: the narrowest bucket maps to Q=5 (<16°), and the APRS scale's
  <1°/<2°/<4° steps are unreachable from our interface *on purpose*. Offering a hunter a "<1°" button
  would manufacture false precision at the exact moment they are least able to judge it.
- **Declination is mandatory, not a nicety.** Bellingham is **15.2°** — 1.3 km of cross-track at 5 km.
  `geomagnetism` (Apache-2.0, ~8 KB gzipped, zero deps, ships WMM2025) computes it offline from
  lat/lon/date. **WMM2025 is valid to 2029-12-31 and the library hard-throws past its window** rather
  than degrading. Wrap it in a try/catch now, or the app fails outright in 2029 for anyone who never
  updated. A stale model drifts ~0.1°/yr — irrelevant next to compass error; an uncaught exception is
  not.
- **GPS works offline on both platforms** — confirmed from Chromium source: Android and iOS default to
  the platform provider, never a network service. The "Chrome needs internet for geolocation" story is
  desktop-only. The real offline cost is **time-to-first-fix**: A-GPS ephemeris needs network, so a
  cold dataless fix can take 30–60 s+ versus 1–5 s warm. Pre-warm the fix while still in coverage and
  show an honest "acquiring" state.
- **`coords.accuracy` must not be used for uncertainty math.** W3C says 95% confidence; Android
  reports 68th percentile (1σ); Apple documents a "radius of uncertainty" with **no percentile at
  all**. Three meanings, one number, and neither platform matches the spec. Relative quality signal
  only.
- **`coords.heading` is useless here** — it is course-over-ground and is `null` when stationary. A DF
  operator stands still and points. This is precisely why the compass work is unavoidable.

**Consequence for the data model**: record `heading_magnetic`, `declination`, `wmm_epoch`, and
`compass_accuracy` (where available) alongside `heading_true`. A bearing then stays reinterpretable
when the model updates, and its provenance is never lost — which is what lets us honour Principle I
without pretending the number was better than it was.

---

## 6. Map and geometry

**Decision**: MapLibre GL JS 5.x against a **hosted OpenFreeMap style**. **No PMTiles, no OPFS, no
offline basemap.** Wedges via `@turf/sector` → GeoJSON fill layer.

> **Superseded 2026-07-15.** This section originally concluded "MapLibre 5.x + PMTiles in OPFS" and a
> self-hosted glyph pipeline. A follow-up question — *why not just use OSMF's cloud offering?* — sent
> us to the primary sources, and the answer inverted the decision. **Every provider that could supply
> an offline archive prohibits building one.** The whole PMTiles/OPFS/glyph edifice existed to serve
> an offline basemap we are not permitted to have, and are no longer building. The MapLibre-over-
> Leaflet reasoning below still stands unchanged; the offline-tiles reasoning is retained because the
> constraints are real and will matter if self-hosting is ever revisited.
>
> **What the policies actually say** — [OSMF vector](https://operations.osmfoundation.org/policies/vector/):
> *"Bulk downloading is prohibited"*, defined as *"downloading of tiles in advance instead of
> downloading when a user views those tiles"*, with offline use as the named example.
> [OSMF raster](https://operations.osmfoundation.org/policies/tiles/) additionally bans *"Pre-seeding
> large areas or multiple zoom levels in advance"*, *"Building tile archives (e.g. `.zip`, `.mbtiles`)
> for later distribution"*, and *"Download city/country for offline use"*. Neither offers an SLA:
> *"availability to others is on a best effort basis"*.
>
> **OSMF serves no glyphs.** The vector policy does not mention glyphs, fonts, or sprites at all — the
> endpoints are `.mvt` tiles and a TileJSON. So "self-host glyphs" was never a choice between OSMF and
> ourselves; OSMF was never a glyph option. A hosted *style* (OpenFreeMap) supplies glyphs and sprites
> as part of the style, which is why it, not OSMF vector, is the pick.
>
> **The one free win**: OSMF's policy *requires* caching (*"according to HTTP Expiry Header,
> alternatively a minimum of 7 days"*) and forbids only **pre-emptive** fetching. Tiles a hunter
> actually viewed while in coverage stay cached legitimately. Ground already looked at keeps its
> basemap offline; new ground does not. That is not a loophole — it is the policy's own requirement.
>
> **Glyph caching, for the record**: glyph requests are plain `GET {fontstack}/{range}.pbf`, so unlike
> PMTiles range requests they *are* cacheable by a service worker. Hosting was never strictly required
> for offline glyphs — availability was. Moot now, but the original framing was wrong and worth
> correcting.

**Rationale**:

- **Rotation decides MapLibre vs Leaflet before anything else.** Heading-up is table stakes for a
  hunt. Leaflet has no native rotation; the only real plugin is GPL-3.0, last published 2023, and
  pinned to an old Leaflet. Leaflet 2.0 has been in alpha since 2025 with a target date of "unknown",
  and Protomaps has put `protomaps-leaflet` in maintenance mode, pointing users at MapLibre. Every
  Leaflet path is a dead end. The 226 KB size delta is noise against a basemap measured in tens of MB.
  Raster tiles also rotate into unreadable baked-in labels; vector re-renders labels upright at any
  bearing and allows a night/high-contrast style swap with no re-download.
- **`cache.put()` rejects 206 Partial Content, and PMTiles is built on range requests.** So naive
  service-worker tile caching **does not work** — and Safari adds its own SW range bugs on top. The
  fix is to bypass Cache Storage entirely: download the archive once into OPFS and hand MapLibre a
  `FileSource` over the handle. This is the kind of thing that fails in a field with no way to debug
  it, which is why it is in the plan and not left to implementation.
- **PMTiles carries geometry only.** MapLibre fetches glyphs and sprites from the style URL at render
  time, so an "offline" map without self-hosted glyphs is an unlabelled, icon-less map. This is the
  most common way "my offline map works" turns out to be false. Self-host both; rewrite style.json.
- **`@turf/sector` is correct and sufficient.** Tested: arc points land at exactly 5.00000 km, and the
  350°→10° north-wraparound case works (Turf 7 fixed the classic bug). Its `destination` uses
  spherical math, ~0.1–0.3% over a few km — **four orders of magnitude below the compass error**.
  Reaching for Vincenty or Karney here would be false precision. Import subpackages, not `@turf/turf`
  (597 KB).
- **MBTiles is a non-starter in-browser** (SQLite via sql.js loads the whole archive into WASM heap on
  every cold start).

**Sizes**: planet z0–15 ≈ 120 GB; a US county at z14 ≈ 10–20 MB; a state at z12 ≈ 50–100 MB. Target
z12–13 for a 10–100 MB area extract. **This is what makes a guaranteed offline basemap incompatible
with a 15-second join** — see the plan's Complexity Tracking.

**Note**: MapLibre v6 is in pre-release; start on 5.x and budget a migration. MapLibre 5 is WebGL2-only.

---

## 7. Install-free offline, and the iOS problem

**Decision**: Plain-tab PWA. Service worker precaches the app shell on first visit. Offer Add to Home
Screen; never require it. Call `navigator.storage.persist()`; do not trust it.

**Findings**:

- **Install-free offline genuinely works.** A plain Safari tab gets service workers (iOS 11.3+), Cache
  Storage, offline GPS, and wake lock. For a single hunt of a few hours, "open link, works offline"
  holds. Only the first visit needs network.
- **The "iOS caps storage at 50 MB" figure is stale folklore.** Safari 17+ gives an origin up to ~60%
  of disk. A 200–500 MB archive is unremarkable.
- **The landmine is the 7-day eviction.** ITP deletes all script-writable storage — explicitly
  including *"Service Worker registrations and cache"* — after 7 days of **Safari use** (not calendar
  days) without interaction. Home Screen web apps are exempt. For a tool used on occasional weekends,
  this is the normal usage pattern, not an edge case. It is also exactly the interference hunter.
  *(A claim you will hit in search results — that iOS 17.4 removed the exemption in the EU — is
  false; Apple reversed it before 17.4 shipped.)*
- **No background execution in a tab on iOS at all.** No Background Sync, no Background Fetch. Screen
  off means nothing runs. This is a hard limit and it is why the unsynced-report window cannot be
  closed opportunistically on the platform where it matters most.
- **Backgrounding = full reload and total in-memory state loss.** Persist continuously; assume any app
  switch is a process kill.

**Flagged uncertainty — do not design around these as though settled**:

1. **Whether `navigator.storage.persist()` exempts an origin from the ITP 7-day rule specifically**
   (as opposed to quota/pressure eviction) could **not** be verified from a primary WebKit source.
   Secondary sources assert it; the 2023 storage-policy post does not mention the 7-day cap at all,
   which may mean superseded, subsumed, or merely unrestated. **Test on a real device.** That is the
   field-gate discipline applied to a dependency.
2. **Whether installing to the Home Screen discards the Safari tab's existing cache** (separate
   storage context) is unresolved — research passes disagreed. If true, "visit → cache → install"
   silently loses everything and re-downloads. **Verify on a real device before building an install
   flow**; if it holds, install must happen while online and before the field, with an explicit
   re-precache.
3. **iOS private browsing** has historically restricted IndexedDB. A hunter opening the link in a
   private tab may get a broken offline experience. Detect, warn, test.

**Sources**: [WebKit ITP](https://webkit.org/tracking-prevention/) ·
[WebKit storage policy, 2023](https://webkit.org/blog/14403/updates-to-storage-policy/) ·
[WebKit full third-party cookie blocking, 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)

---

## Summary of decisions

| Question | Decision | Principle it serves |
|---|---|---|
| Merge | G-Set, union by UUIDv4, no library | IV — and FR-021 reimplementability |
| Report ID | `crypto.randomUUID()`, opaque | IV — no silent loss, no false dedup |
| Clocks | `observed_at` only; no Lamport/HLC | IV, I — invent no ordering |
| Sync | Server sequence cursor | III — offline-tolerant, no-loss |
| Realtime | SSE, `id:` = sequence, `Last-Event-ID` = cursor | III, V — one path, plain HTTP |
| Local store | IndexedDB keyed by report ID | III, IV |
| Heading | Platform magnetic + WMM declination, on-device | III, I, FR-009 |
| Confidence buckets | 3 buttons → Q ∈ {3,4,5}; narrowest <16° | **I** — capped by real compass error |
| Map | MapLibre 5 + hosted OpenFreeMap style; **no offline basemap** | III — with a recorded violation |
| Wedge | `@turf/sector` | I — no false geodetic precision |
| Negative reports | APRS `DFS` s=0 | **II, V** — the format already exists |
| `fix` | No upstream format; declared, not invented | V |
