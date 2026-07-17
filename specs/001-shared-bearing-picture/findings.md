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
| **SSE is not buffered in production (SC-002)** | `curl -N` against the deployed URL: ~130 ms delivery, events tracking the posts | **T069, on `foxmapper.com` itself** |
| No protocol vocabulary reaches a screen (SC-008, in part) | Literal scan of every UI module + the shipped bundle | `web/tests/unit/vocabulary.test.ts` |
| **SC-008 in full — 0 jargon on all 13 reachable screens** | A human reading every screen of the live app, which the scan cannot do | **T065, on `foxmapper.com`** |
| **SC-003 — four devices, no report missing** | Four independent contexts from four locations; each asserted to hold all four | **`web/tests/e2e/four-devices.spec.ts`** |

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

## Still unknown — DEFERRED 2026-07-16, and still unknown

**These were never answered.** The field-gate was amended from a sequencing gate to an obligation
(constitution 1.1.0) because there is no base of people to recruit for repeated hunts, and a gate
nobody can pass is a stop-work order rather than a quality bar.

**Deferring the question does not answer it.** Everything below is still open, still a real risk, and
recorded here rather than deleted precisely so that "we never asked" is never mistaken for "we asked
and it was fine". US1 closes as **built and verified**, not as proven.

**Unmeasured, not passing** — the success criteria that went with them:

| | asks |
|---|---|
| SC-001a/b | under 10 s, one-handed, gloved, on a screen you can barely see |
| ~~SC-003~~ | **mechanism proven** by `four-devices.spec.ts` (four contexts, four locations, every device holds all four). Four *real phones* on real cell is still owed |
| SC-006 | can a hunter say whose bearing they trusted, and why |
| SC-007 | did anyone fall back to voice because the interface was slower than talking |
| SC-009 | did the stock-antenna hunter contribute, or spectate |
| SC-012 | did net control keep up with voice traffic |

SC-002, SC-004, SC-005, SC-008 and SC-011 **are** proven — by tests, by T069 in production, and by
T065's screen-by-screen review.

**T063 is not in the deferred set.** It needs a phone and a car park, not a field or people, and the
honesty cap (Q ≤ 5) rests on its answer.

**The order matters more than the list.** Added after review: the ladder runs deploy → T069 →
T063/T064 → **T069a (the solo hunt)** → T066 → T070, in ascending order of what a mistake costs.
The first four rungs need nobody. T069a was a gap — Level 4 proved the hardware and Level 6 asked
whether the product survived people, and nothing in between asked whether it worked *as a product*
outdoors. It is not the gate and does not close the story; it is what makes the invitation in T070
worth spending.

**Deploy and T069 are done (2026-07-16). The ladder above T063 is now deferred**, so the order below
is preserved for whoever picks it up rather than as a plan for this week. When a tester base exists,
it still runs deploy → T069 → T063/T064 → T069a → T066 → T070, in ascending order of what a mistake
costs. T064 remains the long pole: a seven-day clock and no dependants.

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

### ~~T065 — jargon review~~ — **DONE 2026-07-16, against the live app. SC-008 passes.**

The mechanical scan (a permanent test) finds 0 occurrences of NRQ, DFS, PHG, Q-value or S-point.
This was the other half: driving `foxmapper.com` through **all thirteen reachable screens** — start,
join, status bar, report bar, the four report sheets, the relay fields, the incomplete-relay refusal,
the report detail popup, the placing banner, share, and the offline status bar — and reading every
word.

**0 protocol vocabulary. SC-008 passes in full.** The language is genuinely hunters': *"Rough guess /
Fairly sure / Very sure"*, *"Full quieting — loud and clean"*, *"I hear nothing here"*, *"Take that
back"*, *"Knowing where the fox is not heard rules out ground for everyone."*

**The review found the thing the scan cannot: the app said "Heading" where the constitution says
"bearing".** Principle V's own word list names *fox, bunny, sniffer, attenuator, body fade, **bearing**,
null, S-meter*. The report bar button said Bearing; the sheet then asked for a Heading. Jargon-free,
and still not the word a hunter uses — you *take a bearing*; a heading is where you are pointed.
Fixed on the participant-facing strings only: `heading.ts` and the `data-testid`s keep their names,
because "heading" is correct for the *sensor* (where the phone points) and "bearing" is correct for
the *claim* (what the hunter asserts). That distinction is the whole reason the bug was invisible.

**Two findings recorded rather than fixed**, because both are design questions rather than wording:

1. **A relayed position is typed as latitude and longitude.** That is not how a position arrives over
   voice. Net control hears "I'm at the corner of Alabama and Yew" or a grid square, not six decimal
   places, and has to convert while the next call is already coming. FR-007d is satisfied — the
   position *is* set by hand — but this is exactly the sort of thing T069a/T070 were meant to catch,
   and those are now deferred. Recorded so it is not lost.
2. **"Middling — within about eight miles"** is clear but archaic. Harmless; noted only because a
   review that finds nothing to mention usually was not a review.

**What this half still cannot do**: I am not a hunter, and reading every screen is not the same as
using them cold, outdoors, with a radio in the other hand. SC-008 is satisfied on its literal terms
("0 jargon terms on any reachable screen"). Whether the words *land* is a T070 question.

### T069a — the solo hunt (added after review)
Hide a transmitter, hunt it yourself, two phones, nobody else. The only rung where **ground truth
exists**, because you hid it: does the wedge point at the transmitter? Also the first honest read on
the blank basemap *while walking*, ten seconds one-handed holding a radio, the cold join on real
cell, and whether the palette survives sunlight.

It cannot answer SC-006, SC-007, SC-009 or SC-012 — all need someone who is not you — and **the
author cannot fairly test the join flow he built**. Not the gate.

### T066 / T070 — four devices, then the hunt
The whole story closes at T070, and only there. The plan is explicit that the questions worth asking
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

### ~~T067–T069 — deploy~~ — DONE 2026-07-16. **`https://foxmapper.com`**

Deployed from the blueprint with no code change. Postgres 18, migrations ran on first boot, one
image serving the PWA and the API from the same origin. `/health` green in ~8 minutes — a cold Rust
release build.

**The custom domain is on the canonical origin, and it was set before any field work on purpose.**
IndexedDB, `localStorage` and the service worker are all scoped per-origin, so a hunt tested on
`foxmapper.onrender.com` and then moved to `foxmapper.com` would silently forget every device's
remembered hunt (FR-004c), its `participant_id`, and its whole local log — no error, just a fresh
install for everyone. It cost nothing to do now and would have cost the field gate to do later.

Nothing in the app needed changing: `API_ORIGIN` falls back to `window.location.origin`, `huntLink()`
reads it too, and the manifest is relative — so **the link now reads `foxmapper.com/h/{code}`**,
which is the thing that actually gets said out loud on a repeater. The apex is canonical and `www`
301s to it, because "double-you double-you double-you" is three syllables nobody wants to key up.

Route 53 note for whoever renews this: the apex is an **A record to `216.24.57.1`**, not an ALIAS.
Route 53's ALIAS only targets AWS resources, so it cannot point at `foxmapper.onrender.com`, and a
CNAME is illegal at a zone apex. That pins the apex to an IP Render could renumber — accepted, and
the documented path, but that is where the fragility sits. `www` is a CNAME and would survive it.

**T069 passed against the deployed URL, and this is the number that mattered.** Three reports posted
3 s apart, arrival timestamped at the `curl -N` end:

| posted | arrived | latency |
|---|---|---|
| `…891.618` | `…891.782` | **164 ms** |
| `…894.831` | `…894.942` | **111 ms** |
| `…897.993` | `…898.129` | **136 ms** |

Events arrived 3.2 s apart — tracking the posts, one at a time, not a burst. **Nothing in Render's
path buffers.** SC-002 budgets 5 s; production delivers in ~130 ms, a ~35x margin. The section this
replaces said "passing locally proves nothing about Render's proxy", which was right, and is why
this was worth running before anyone else was involved.

Verified in production at the same time, all from the plan's Stage 2.5/2.6 "Done when" column:

- `id:` **is** the server sequence, and `Last-Event-ID: 1` replays exactly 2 and 3 — catch-up after
  an offline gap and live push really are one code path, as the plan bet.
- `since=0` returns the whole hunt — the poll fallback works.
- An unknown hunt streams **204**, which is what drives a participant out of a purged hunt.
- **HTTP/2** on both `/health` and the stream (T068).

One thing worth writing down because it looks like a failure and is not: `x-accel-buffering` does
**not** appear in the response headers. An nginx-family proxy reads that header and strips it, so
its absence is consistent with it having been honoured — and the timing above settles the question
regardless of what the headers say.

**`autoDeployTrigger` was wrong by default.** The blueprint did not set it, so the service came up
on `commit` — deploying every push to main whether CI passed or not, for a service whose whole
purpose is to be running while nobody is watching a dashboard. Fixed to `checksPass` (PR #29),
matching what the maintainer's other service already does.

### T071 — the palette. CVD half **done 2026-07-16**; sunlight half still open.

**The twelve were a rainbow, and a rainbow is what CVD flattens.** Measured as CAM02-UCS ΔE between
every pair under simulated vision (Machado 2009, severity 100):

| | outline — carries identity | fill @ 22% |
|---|---|---|
| old rainbow (12) | 14.8 / **4.2** / **2.2** | 4.0 / **0.4** / **0.7** |
| Tol muted (9) | 17.3 / **12.3** / **15.0** | 3.9 / 3.1 / 3.0 |

*(normal / deuteranomaly / protanomaly)*

`#e5533d` red and `#9c6b45` brown both rendered as roughly `#7b6f3e` for a protanope — **ΔE 2.2**.
Seven pairs collided under deuteranomaly. That is ~8% of men, in a hobby that is overwhelmingly
men, and because colour is a hash bucket the collision is *invisible to the person it affects*: they
simply see two hunters as one and have no way to know.

Replaced with **Paul Tol's "muted"** — a human-designed CVD-safe scheme, not something generated.
Worst case **11.8** across all three CVD types.

**Nine is not a downgrade from twelve.** Colour already collided: at eight hunters, twelve swatches
collided 95.4% of the time and nine collide 99.2% — birthday maths, and exactly why FR-002b says
colour is an aid and the callsign is the identifier. A deuteranope was *already* living with ~8
effective colours out of the twelve, unpredictably, and differently from the hunter beside them.

**Three things worth knowing:**

1. **The fill was never the identity carrier and cannot be.** At `fill-opacity: 0.22` every palette
   merges — the old one to **ΔE 0.4**, below a just-noticeable difference, i.e. provably one colour.
   Identity lives in the full-strength outline and the label. Raising the opacity would fix nothing
   worth the cost: even 50% only reaches 8.6 for normal vision, and it would obscure the overlapping
   wedges that are the entire product. The fill is a locator; the outline is the name.
2. **Twelve CVD-safe swatches is achievable** — an annealer found a set at ΔE 20.5. It was also
   unshippable sludge (near-blacks, pure neons). "Twelve is too many" was never the reason; the
   reason is that the twelve chosen were a rainbow.
3. **`docs/log-format.md` and `PALETTE` could drift silently.** The fixed-vector test claimed to
   protect a third-party reimplementation but derived its expectation from `PALETTE` itself, so it
   would pass while the published contract listed different swatches. Four files had to be hand-synced
   for this change and nothing would have caught a typo. Now `colour.test.ts` parses the contract's
   table and asserts it equals `PALETTE` — verified to fail on a one-character drift.

**Still open: the direct-sunlight check.** Simulation is not a person squinting at a dimmed phone on
a hilltop, and it is not a person with actual CVD either — one real pair of eyes is worth having.
That half belongs to T069a, and the palette should not move again after it.
