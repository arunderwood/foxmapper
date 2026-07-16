# Implementation findings (001)

What building it taught us, and what is still unknown. Written during implementation rather than
after, because the point of the field gate is that it can still change the answer.

---

## What is proven, and by what

| Claim | Proven by | Where |
|---|---|---|
| Merge needs no conflict resolution | Union laws as property tests | `web/tests/unit/gset.test.ts` |
| The fold is order-independent | Property tests incl. retraction-before-target | `web/tests/unit/fold.test.ts` |
| Two devices agree on who is which colour | SHA-256 pinned against OpenSSL + a fixed vector | `web/tests/unit/colour.test.ts` |
| The APRS mapping is lossless "to and from" | Round-trip property tests both directions | `web/tests/unit/aprs.test.ts` |
| Authored `Q ∈ {3,4,5}` — the honesty cap | Asserted mechanically over every authorable report | `web/tests/unit/aprs.test.ts` |
| Wedges are bounded (SC-004) and wrap north correctly | Geometry property tests | `web/tests/unit/wedge.test.ts` |
| `omni`/`null` imply no direction | Render tests + two-device E2E | `layers.test.ts`, `shared-picture.spec.ts` |
| No cursor-visible sequence gap | A test that **fails when the advisory lock is removed** | `server/tests/sync_cursor.rs` |
| Hunt codes clear 40 bits | Entropy computed from the generator; the naive scheme asserted to fail | `server/tests/hunt_codes.rs` |
| Append is idempotent by id | Same id twice → one row, 202 both times | `server/tests/append_idempotent.rs` |
| The idle purge restarts on every append | Time-injected purge tests | `server/tests/purge.rs` |
| A report survives a force-quit and reaches the server (SC-005) | E2E, offline then reconnect | `web/tests/e2e/offline.spec.ts` |
| 0 relayed reports attributed to the operator (SC-011) | E2E driving the real relay UI | `web/tests/e2e/relay.spec.ts` |
| SSE is not buffered (SC-002 locally) | `curl -N` shows events 2s apart, not a burst | T062, and against the deploy image |
| No protocol vocabulary reaches a screen (SC-008, in part) | Literal scan of every UI module + the shipped bundle | `web/tests/unit/vocabulary.test.ts` |

**Totals**: 153 web unit tests, 47 server tests, 23 E2E. All green.

The vocabulary check surfaced a pleasing structural fact: **"DFS" does not appear in the shipped
bundle at all**, because nothing that renders imports `aprs/mapping.ts` and the module tree-shakes
out entirely. The contract asked for the ugliness to live in one module; it turns out to live in a
module the product does not even ship to a participant.

---

## Bugs the tests did not find — driving the real app did

Recorded because each one argues for the field gate rather than for more unit tests.

1. **The map rendered nothing on a cold open.** `update()` skipped `setData` when the style had not
   loaded, and nothing re-applied it. A hunter opening the app while holding every report saw blank
   ground. It only ever appeared to work because reports were submitted *after* the style loaded.

2. **With the tile host unreachable, no reports rendered at all.** The map booted from the remote
   style, so a failed fetch left it with no sources and no layers — in exactly the case the plan
   calls normal. The basemap now **starts blank and upgrades if the network offers**, which is the
   Principle III ordering: usable first, context later. This is the recorded Complexity Tracking
   violation's mitigation, and it was not actually working.

3. **The clock check measured a cache, not a clock.** `cache: 'no-store'` was ignored, `/health`
   came back in 0 ms with a `Date` header three minutes stale, and the app warned that a correct
   clock was 2 minutes out. `clock_offset_ms` exists for display honesty; garbage in it is worse
   than nothing. Fixed on both sides (cache-busted URL; `no-store` on `/health`).

4. **"No signal" on a healthy stream.** `live` only flipped when reports *arrived*, so a quiet hunt
   looked disconnected. FR-018 failing in the direction that costs trust: an indicator that cries
   wolf is one hunters learn to ignore.

5. **The app-shell precache contained no app.** The worker cached `index.html` but not the
   fingerprinted JS or CSS, because a worker claims the page *after* its scripts are fetched. The
   shell would load offline and then die fetching the app.

6. **Net control could not relay anything.** `relay.ts` existed, the map drew relayed reports, and
   the property tests passed — but no interface created one. SC-011 was untestable through the
   product. The first E2E attempt hid this by importing the module directly, which would have
   passed against a feature that did not exist.

7. **A queue flush 400'd.** `#[serde(untagged)]` matched an array as a single report, so the exact
   request a phone makes on regaining coverage was rejected.

8. **Every parameterised route 404'd.** axum resolved to 0.7, where `{code}` is a literal path
   segment.

---

## Recorded deviations from the plan

| Plan says | Reality | Why |
|---|---|---|
| Rust 1.83+ | Floor is **1.88** | The locked dependency tree needs edition2024 (1.85) and `home` needs 1.88. "1.83+" was a floor; this is where it sits. |
| `word-word-NNNN` codes | `word-word-NNNN-XXXX` | 45.3 bits vs the naive ~29. The contract sanctioned appending a suffix; the entropy floor is the requirement, the format is the means. |
| Server and web as separate deployables | One image, one origin | `EventSource` cannot send custom headers, and CORS on an SSE stream is a needless way to lose the entire sync path. They remain separate codebases with separate lifecycles; only the deploy artifact is shared. |

---

## T073: bundle size against SC-001

Measured, not assumed: **302 KB gzipped** for a cold join (298 KB of it MapLibre).

| Link | Transfer time |
|---|---|
| Slow 3G (0.4 Mbps) | ~6.2 s |
| Typical rural LTE (2 Mbps) | ~1.2 s |
| Good LTE (10 Mbps) | ~0.2 s |

Against SC-001's 15 seconds, that leaves comfortable room on LTE and a **thin margin on slow 3G**
once TLS, DNS, parse and map init are added. This is a transfer estimate on a synthetic link — the
requirement is a cold join on real cell at the trailhead, which only T070 can answer.

The map is the product, so MapLibre is not deferrable. If the field test finds the cold join slow,
the lever is a lighter map, not code-splitting around it.

---

## Still unknown — and only a field test can answer

**T063, T064, T066, T070 cannot be done from here.** They need real phones, four people, and a
hunt. Nothing below is a defect; each is a question the plan deliberately left to the field.

### T063 — sensors, on real iOS and Android
- Does the compass swing 10–30° next to a car? The entire honesty cap (Q ≤ 5) rests on that number.
- Does declination land at ~15.2° in Bellingham? (The library computes 15.18° for 2026 — checked in
  a unit test, but not against a real compass.)
- Does a device clock set to 2030 degrade to a stale magnetic model rather than crashing? The code
  catches the WMM's hard expiry; nobody has watched it happen on a phone.
- **Android reports no compass accuracy at all.** A bearing from an Android phone carries less
  provenance than one from an iPhone, and no code can fix that.

### T064 — iOS storage, the two things research could not verify
- Does `navigator.storage.persist()` actually beat the 7-day ITP eviction rule?
- Does Add to Home Screen discard the tab's existing cache?

Both are recorded in Complexity Tracking as assumptions the design explicitly refuses to make. The
exposed case is a report authored offline, never synced, on a phone that gets evicted — SC-005's
"100% present" would be false.

### T065 — jargon review (half done)
A mechanical scan of every UI and report module, and of the shipped bundle, finds **0 occurrences**
of NRQ, DFS, PHG, Q-value or S-point, and it is now a permanent test.

What a scan cannot do is judge *reachable*. An error path, a popup, or a phrase that is technically
jargon-free but still means nothing to a hunter will all pass it. SC-008 wants a human reading every
screen they can get to; that half is still open.

### T066 / T070 — four phones, four locations, one hunt
The whole story closes here, and only here. The plan is explicit that the questions worth asking
are behavioural:
- Did three untrained participants join and report **without being talked through it**?
- Did the stock-antenna hunter contribute, or spectate? (SC-009 — Principle II's real test.)
- Could net control keep up with voice traffic? (SC-012 — the plan's explicit bet.)
- Did anyone act on someone else's report, and could they say whose they trusted and why? (SC-006)
- Did anyone **fall back to voice because the interface was slower than talking**? (SC-007 — the
  status quo winning.)
- **Was the blank offline basemap usable or useless?** This is the one that can reverse a recorded
  decision. The plan says: *"If the blank map proves useless outdoors, the field gate will say so —
  and that answer is worth more than a tile pipeline built on a guess."*

### T067–T069 — deploy
The blueprint (`render.yaml`) and the image are written, and the image was **built and run**: it
serves the app, the API, the service worker, the SPA fallback for a hunt link, and an unbuffered
SSE stream with the right headers. What has not happened is a deploy to Render — that needs an
account and is the maintainer's to trigger.

**T069 remains open and matters**: `curl -N` must be re-run against the deployed URL. Buffered SSE
fails SC-002 *silently and only in production*, and every check so far has been against localhost
or a local container. Passing here proves nothing about Render's proxy.

### T071 — the palette
The twelve swatches are provisional and have had **no colour-vision-deficiency check and no
direct-sunlight check**. The algorithm is settled and pinned by tests; the colours are a designer's
call. Changing the list repaints every hunt, so it should be settled before first real use.
