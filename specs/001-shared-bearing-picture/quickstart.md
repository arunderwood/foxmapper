# Quickstart: Validating Shared Bearing Picture

How to prove this feature works. Every scenario maps to a spec success criterion or an acceptance
scenario, and the last section is the one that actually decides whether the story is done — the
constitution's field-gate says a story ships to a real hunt before the next one starts, and *"a story
is not done when its tests pass; it is done when someone used it outdoors and the interaction survived
contact."*

Nothing here is implementation. See [data-model.md](data-model.md) and
[contracts/](contracts/log-format.md) for what the code must satisfy.

## Prerequisites

- Rust 1.83+, Node 22+, a Postgres you can throw away
- A phone. **Not a desktop browser with device emulation** — the two things most likely to be wrong
  (compass and GPS) do not exist there.
- HTTPS for anything touching sensors. `DeviceOrientationEvent.requestPermission()`,
  `crypto.randomUUID()`, and service workers all require a secure context, so `localhost` over plain
  HTTP will pass tests that fail on a real phone.

```bash
# server
cd server && cargo run                # http://localhost:8080

# web (HTTPS, so sensors work)
cd web && npm install && npm run dev -- --https
```

## Level 1 — the log is correct (no browser, no server)

The heart of the design is a fold over a set. It is pure, so test it as such.

```bash
cd web && npm run test:unit
```

Asserts the properties from [log-format.md](contracts/log-format.md):

| Property | Why it matters |
|---|---|
| `fold(shuffle(log)) == fold(log)` | Order-independence. The whole design rests on order not mattering. |
| `fold(A ∪ B) == fold(B ∪ A)` | "Merging two divergent logs is a union requiring no conflict resolution" — mechanically. |
| `fold(A ∪ A) == fold(A)` | Idempotence. A report arriving twice is drawn once. |
| **Retraction arriving before its target** | The rule reimplementations get wrong. Feed the retraction first; the target must be inactive when it lands. |
| Retraction of an ID that never arrives | Inert. Not an error, not a warning. |
| Two identical relayed reports | **Both survive.** Deduplicating would destroy a real report. |
| Age-neutrality | Reports a week apart render identically (FR-012a). |

```bash
cd web && npm run test:aprs      # round-trip properties
cd server && cargo test          # append idempotency, cursor, purge
```

The APRS suite is the interesting one: `decode(encode(r)) == r` for everything we author,
`encode(decode(w)) == w` for everything the air can hand us, and — asserted mechanically rather than
trusted to code review — **`Q ∈ {3,4,5}` for every report our interface can produce**. That test is
Principle I in executable form.

## Level 2 — two browsers, one hunt

Proves FR-014 and SC-002 (a report visible on every other connected device within 5 s).

```bash
cd web && npm run test:e2e -- shared-picture
```

1. Create a hunt; note the code and link.
2. Open the link in two contexts, join as `KI7ABC` and `KI7XYZ`.
3. Submit a bearing from A. **It must appear on B within 5 seconds with no action on B.**
4. Submit an `omni` and a `null` from B. Both appear on A, both legible as what they are, and
   **neither implies a direction** (FR-011a).
5. Retract A's bearing. It stops rendering as active on both, and remains in the log.

**Check the SSE stream by hand once** — the failure here is silent and production-only:

```bash
curl -N -H "Accept: text/event-stream" \
     https://localhost:8080/api/hunts/{code}/stream
```

Events must arrive **as they happen**, not in a burst. A burst means a proxy is buffering, which fails
SC-002 invisibly behind a load balancer while passing every local test. Then reconnect with a cursor
and confirm catch-up is the same path:

```bash
curl -N -H "Accept: text/event-stream" -H "Last-Event-ID: 5" \
     https://localhost:8080/api/hunts/{code}/stream
```

## Level 3 — offline (the constitutional one)

Principle III is the gate this feature is most likely to fail, and a passing test on a fast laptop
proves nothing. **Use a real phone and real airplane mode**, not devtools throttling.

```bash
cd web && npm run test:e2e -- offline
```

1. Join with coverage. Confirm the map renders.
2. **Airplane mode.**
3. Submit a bearing, an `omni`, and a `null`. **All three are accepted and render locally
   immediately.** Nothing blocks, nothing spins, no error.
4. Confirm the UI shows what the device is missing (FR-018) and how many reports are queued.
5. Force-quit the browser. Reopen. **Every report is still there** — this is what catches "we kept it
   in memory".
6. Restore network. Within seconds, all three appear on the other device (SC-005: 100%).
7. Meanwhile the other device also reported offline. **After both reconnect, both devices hold both
   sets, with nothing dropped and nobody asked to resolve anything.**

**The offline self-test, and it should gate deployment**: with the network hard-disabled **and the
HTTP cache cleared**, the app must still load, join, render every held report, and accept new ones.
Clearing the cache is the whole point — a warm tile cache on a dev machine makes a broken offline path
look fine, which is the single easiest thing here to believe works when it does not.

**Expected and acceptable**: offline, in ground not already viewed, the basemap is **blank** and
reports render over it. That is the recorded decision (plan.md, Complexity Tracking) — not a bug. Do
not "fix" it by pre-fetching tiles: **every provider prohibits that by name**, and doing it would have
us asking users to violate a usage policy on our behalf.

What is *not* acceptable: a lost report, a blocked entry, a map that refuses to draw because tiles are
missing, or an error state that treats an unreachable tile host as a failure. The tile host being gone
is the **normal** case in the field, and the app must not act surprised by it.

## Level 4 — the phone realities

These cannot be tested in CI. Do them once per platform, on hardware, and write down what you saw.

**Compass** — the dominant error term in the product:

- iOS: permission is requested from a **user gesture** and the page is HTTPS. `webkitCompassHeading`
  arrives.
- Android: `deviceorientationabsolute` arrives, `360 - alpha` plus screen-orientation correction is
  applied. **Safari does not implement this event at all** — confirm the feature-detect actually
  branches rather than silently reading zeros.
- Both platforms report **magnetic**. Confirm declination is applied: in Bellingham it is ~15.2°, so a
  true heading that equals the magnetic one means the conversion never ran.
- **Stand next to a car, then walk 20 m away and compare.** A 10–30° swing is expected and is the
  whole reason the confidence buckets are capped. If you cannot reproduce that swing you are probably
  reading a stale value.
- iOS gives `webkitCompassAccuracy`; **Android gives nothing**. Confirm the Android path degrades
  honestly rather than inventing a number.

**Declination expiry** — set the device clock to 2030 and confirm the app **does not crash**. The WMM
library hard-throws past its 2029 window rather than degrading. A stale model drifts ~0.1°/yr and is
irrelevant next to compass error; an uncaught exception is not.

**GPS** — airplane mode with Location Services on. A fix still arrives (platform GPS is dataless), but
a cold first fix can take 30–60 s+ without A-GPS. Confirm the "acquiring" state is honest and early
kilometre-scale fixes are discarded.

**iOS storage** — the two things research could not settle from primary sources, which is exactly why
they are here:

1. Does `navigator.storage.persist()` actually protect against the ITP 7-day eviction, as opposed to
   only quota pressure? **Test it. Do not assume it.**
2. Does Add to Home Screen discard the Safari tab's existing cache? If it does, "visit → cache →
   install" silently re-downloads everything, and the install offer must come while online, before the
   field.

## Level 4a — the solo hunt

**Hide a transmitter in a park. Hunt it yourself, with two phones. Invite nobody.**

Level 4 proves the hardware works. Level 6 asks whether the product survives people. Nothing in
between asks whether it works *as a product* — outdoors, moving, in one hand, for someone who does
not need convincing. This is that rung, and it costs a Saturday morning and no goodwill.

It exists because Level 6 gets exactly one first impression with a club. Asking "did the
stock-antenna hunter contribute?" while the compass reads stale zeros wastes the hunt *and* the
people. Everything below is cheaper to find alone.

Run it against the **deployed** URL, on real cell, from a trailhead — not localhost on wifi.

**What only this can tell you:**

- **Is the blank basemap usable while you are actually walking?** The plan's strongest-worded
  Complexity Tracking violation says reports render over blank space out of coverage, and that the
  field gate decides whether that is survivable. You do not need three strangers to find out.
- **Ten seconds, one hand** (SC-001a/b), while holding a radio and a yagi and wearing gloves. Time
  it. The number in the spec is a requirement, not an aspiration.
- **Does the wedge point where you think it points**, from a real position with a real compass, at
  a transmitter whose location you actually know? This is the only test in the whole ladder where
  ground truth is available — you hid it.
- **Cold join on real cell** at the trailhead (SC-001's 15 s), not a 302 KB transfer estimate.
- **Sunlight.** Whether the nine swatches survive a dimmed screen outdoors — **the open half of
  T071**. The colour-vision half is settled (Paul Tol's "muted"); this is the half no simulation can
  answer, and changing the palette after this point repaints every hunt.
- Whether the picture **helps at all**, or is just something to look at.

**What this cannot tell you, and must not be mistaken for:**

- **SC-006** — whether someone acts on *another person's* report and can say whose they trusted.
  Needs another person.
- **SC-007** — whether anyone falls back to voice. Needs voice traffic.
- **SC-009** — whether the stock-antenna hunter contributes. Needs someone who is not you.
- **SC-012** — whether net control keeps up. Needs net control.
- **Whether an untrained participant can join unaided.** *You built it.* You cannot un-know where
  the buttons are, and no amount of care makes your join a fair test of the join.

**This is not the field gate and does not close the story.** Level 6 does. This is what makes
Level 6 worth the invitation.

## Level 5 — the four-device test

The spec's own Independent Test: *"Four people in different locations join one session, each submits
one bearing, and each can see the other three rendered on their own device within seconds."*

Four real phones, four real places, one hunt. Each submits one bearing. Each sees the other three.
No report missing (SC-003).

## Level 6 — the field gate

**This is the one that counts.** The others are necessary and none of them is sufficient.

Take it to a real hunt. From the spec's Field Validation:

- At least **three participants who did not build the tool** join from their own phones and submit
  bearings **without being talked through the interface**.
- At least one carries only a handheld with a stock antenna and contributes `omni` or `null` reports
  (SC-009). If they end up spectating, Principle II is not actually satisfied and the checklist is
  lying.
- Someone runs **net control** from off the field, entering relayed reports as they are called
  (SC-012). **This is the bet the plan makes**: net control has a keyboard and a monitor, and P1
  deliberately gives them the same phone-shaped interface as everyone else. If they cannot keep up
  with voice traffic, that is the answer, and the console becomes its own story.

**It survived contact if** a participant acts on someone else's report — walks or drives toward where
the wedges overlap, or toward whoever is hearing it loudest — and can say afterward whose report they
trusted and why (SC-006).

**It did not survive if** anyone fell back to calling their bearing over voice because the interface
was slower than talking (SC-007). That is the status quo winning, and no green test suite outranks it.

## What to measure

| Criterion | Target | Where |
|---|---|---|
| SC-001 | Joined and looking at a map in **< 15 s** from a cold link | Level 2, then Level 6 on real cell |
| SC-001a/b | A report entered in **< 10 s**, one-handed | Level 6 — gloved, outdoors, on a screen you can barely see |
| SC-002 | Report visible on other devices in **< 5 s** | Level 2 |
| SC-003 | Four devices, no report missing | Level 5 |
| SC-004 | **0%** unbounded wedges; 0% missing confidence or range | Level 1 (unrepresentable by construction) |
| SC-005 | **100%** of offline-authored reports present after reconnect | Level 3 |
| SC-008 | **0** jargon terms on any reachable screen | Review every screen against [aprs-mapping.md](contracts/aprs-mapping.md)'s firewall |
| SC-010 | **0** headings recorded the reporter could not see and correct | Level 2 + Level 4 |
| SC-011 | **0** relayed reports attributed to the operator who typed them | Level 2 |
| SC-012 | Net control keeps up with voice traffic | **Level 6 only.** Cannot be faked. |
