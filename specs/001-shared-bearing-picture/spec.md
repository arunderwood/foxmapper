# Feature Specification: Shared Bearing Picture

**Feature Branch**: `shared-bearing-picture-d70afc`

**Created**: 2026-07-14

**Status**: **Closed 2026-07-16 — built and verified. Not proven outdoors.**

Closed on the terms [constitution 1.1.0](../../.specify/memory/constitution.md) sets: *"A story closes
on its tests and its independent-test criteria."* Both are met — 191 unit, 48 server and 98 E2E tests
green, and the Independent Test below is proven mechanically by `web/tests/e2e/four-devices.spec.ts`
(four contexts, four locations, every device holding all four).

**What "closed" does not mean.** Nobody has taken this outdoors. The Field Validation section below
was never run, and **SC-001a/b, SC-006, SC-007, SC-009 and SC-012 are unmeasured — not passing.**
Field validation is a deferred milestone rather than a gate because there is no base of participants
to recruit; the debt is still owed and the questions are preserved verbatim in
[tasks.md](tasks.md)'s Deferred phase. See [findings.md](findings.md) for what is proven and by what.

Live at **https://foxmapper.com**.

**Input**: User description: "Shared bearing picture (Priority: P1) — A group of hunters is trying to find a hidden transmitter. One person creates a session and shares a code. Each hunter opens a link on their phone, joins with their callsign, and — from wherever they are standing — records which direction the signal is coming from. Within seconds, every other hunter sees that observation appear on a shared map, drawn from the reporter's position and shaded to reflect how much they trust it."

## Clarifications

### Session 2026-07-14

- Q: Which report kinds are in P1 scope? → A: All four — `bearing`, `omni`, `null`, and `fix`. This
  closes the Constitution Principle II gap that the initial draft carried as a recorded violation:
  every radio now has a contribution path in the first story.
- Q: How many targets can a hunt have? → A: Exactly one. A multi-fox course is run as multiple hunts,
  or waits for a later story. Reports do not name a target; they belong to the hunt.
- Q: How many bearing-confidence steps does the reporter choose from? → A: Three plain-language
  buckets on screen, each writing a definite full-precision value to the log. Losslessness is met in
  storage, not in the widget: our reports round-trip exactly, and a report ingested from the air
  keeps its original precision while displaying as the nearest bucket.
- Q: In the default entry method, where does the heading come from and is it editable? → A: The
  device compass drafts it and the reporter may adjust it before submitting; if no compass is
  available the reporter sets it by hand. The fast path stays fast, but no heading is recorded that
  the reporter did not vouch for.
- Q: When does a hunt expire? → A: 30 days after the last report. Idle-based, so an active hunt never
  expires out from under its participants; the clock restarts on every report.
- Q: Why 30 days rather than something shorter? → A: It serves a second kind of user — the
  interference hunter, chasing a stuck mic, a jammer, or a noisy switching supply over days rather
  than an afternoon. That user needs the hunt to still be there when they come back. The window is a
  requirement, not a default.
- Q: How does an interference hunter get back to a hunt days later, given there are no accounts? →
  A: The device remembers the last hunt it was in and reopens it on return. Nothing more. Switching
  to any other hunt means opening that hunt's link. There is no hunt list and no history — an earlier
  answer in this session proposed one and was withdrawn as unnecessary.
- Q: Does "multi-session history" mean a list of hunts, or several hunts on one map? → A: Neither.
  Multi-hunt features are out of scope. One hunt per problem, revisited via the last-hunt memory or
  its link.
- Q: Does net control get a large-screen console for rapid entry? → A: No. P1 must work on a large
  screen but is not designed for one, and adds no console, no keyboard-driven entry mode, and no
  net-control-specific layout. Whether net control needs more than the ordinary interface is a
  question for field validation, not for the spec to guess.
- Q: Can a participant enter a report on behalf of someone else, and how is it attributed? → A: Yes —
  this is what net control does. The report carries both the observer (whose observation it is, from
  whose position) and the operator who entered it. The map shows the observer and marks the report as
  relayed. The two are not collapsed: a relayed report has an extra hop where error enters, and the
  log's honest fact is "this operator recorded that this observer reported this."
- Q: Should reports visibly age, or be filterable by time, once a hunt spans days? → A: Neither. All
  reports are drawn alike; the time each was taken is shown on the report. P1 renders what people
  said and when, and adds no interpretation on top of it. Report age becomes a real question when
  fusion arrives and age starts to affect weighting.

### Session 2026-07-15

- Q: Phone clocks are wrong, and the map shows their times. What do we do? → A: Measure the device's
  offset against the server when the app loads, warn the reporter if it is gross (more than 2
  minutes), and record the known offset on each report so any device can show the time with an honest
  caveat. Never alter what the reporter said. An unmeasured offset is recorded as unknown, not as
  zero.
- Q: Anyone with the code can plant bad reports, and nobody can remove them. What is the remedy? →
  A: There is none, by design. Hunts are cheap and disposable: a poisoned hunt is abandoned and a new
  code goes out. No moderator, no creator privileges, no retraction of other people's facts. A plain
  server-side rate limit guards against flooding, and nothing more.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shared bearing picture (Priority: P1)

A group of hunters is trying to find a hidden transmitter. One person creates a hunt and shares a
code. Each hunter opens a link on their phone, joins with their callsign, and — from wherever they
are standing — records which direction the signal is coming from. Within seconds, every other hunter
sees that observation appear on a shared map, drawn from the reporter's position and shaded to
reflect how much they trust it.

A hunter without a directional antenna is not a spectator. From the same screen they can report how
strong the signal is where they stand, or that they hear nothing at all — and either one shows up on
everyone's map as evidence, alongside the bearings. When someone finds the fox, they say so, and the
hunt has an ending.

Not everyone in a hunt is holding a radio. Someone at home, or running a command post, can type in
what they hear called over the air on behalf of the operator who called it — and the map shows that
bearing as that operator's, taken from where they stood, marked as having come through a voice hop.
The picture builds for them the same as for anyone standing in a field.

**Why this priority**: This is the entire premise reduced to its smallest useful form. Groups
currently do this over voice, with each person maintaining a private mental map. Simply making
everyone's observations visible on one map — with no fusion, no estimation — is already better than
the status quo and is the only story that must exist for any other story to matter.

**Independent Test**: Four people in different locations join one hunt, each submits one bearing,
and each can see the other three rendered on their own device within seconds. Delivers value with no
location estimate at all.

**Field Validation**: At a real hunt, at least three participants who did not build the tool join
from their own phones, take bearings from their own positions, and submit them without being talked
through the interface. At least one of them carries only a handheld with a stock antenna and
contributes signal-strength or "heard nothing" reports. Someone runs net control from off the field,
entering what they hear called over the air on others' behalf, and either keeps up with voice traffic
or tells us plainly where the interface lost the race. It survived contact if a participant acts on
someone else's report — drives or walks toward where the wedges overlap, or toward whoever is hearing
it loudest — and can say afterward whose report they trusted and why. It did not survive if anyone
fell back to calling their bearing over voice because the interface was slower than talking.

**Acceptance Scenarios**:

1. **Given** a hunter with a hunt link and no account, **When** they open the link on a phone,
   **Then** they can join and submit a bearing without registering, installing, or paying.
2. **Given** a hunter standing at a known position, **When** they indicate the direction the signal
   came from, **Then** the report is recorded against their position and appears on every
   participant's map.
3. **Given** a report entered by another participant, **When** it renders, **Then** its angular width
   reflects the observer's stated confidence and its length reflects the observer's stated range,
   rather than being drawn as an unbounded line.
4. **Given** a hunter with no network connection, **When** they submit a bearing, **Then** the report
   is accepted and appears on their own map immediately, and is delivered to other participants once
   connectivity returns.
5. **Given** two participants who were separately offline and each submitted reports, **When** both
   regain connectivity, **Then** each device ends up holding both sets of reports with none dropped
   and no participant asked to resolve a conflict.
6. **Given** a hunter who realizes a submitted bearing was wrong, **When** they retract it, **Then**
   the original report remains in the log as a fact, the map stops drawing it as active, and every
   other participant's map reflects the retraction once connected.
7. **Given** a participant whose device cannot supply a position, **When** they place their position
   on the map by hand, **Then** they can submit a bearing from that position, and the map shows other
   participants that the position was self-placed rather than measured.
8. **Given** a hunter holding a handheld with a stock antenna and no way to take a bearing, **When**
   they report how strong the signal is where they stand, **Then** the report is recorded against
   their position and appears on every participant's map as evidence, not as an annotation beside it.
9. **Given** a hunter who hears nothing at all where they are standing, **When** they report that,
   **Then** it is recorded as a report in its own right and appears on every participant's map.
10. **Given** a hunter who has found the transmitter, **When** they report the find, **Then** it
    appears on every participant's map and the hunt's target is marked found.
11. **Given** a participant at home with no radio in hand, **When** an operator calls a bearing over
    voice and the participant enters it on that operator's behalf, **Then** the report is recorded
    against the operator's position, attributed to the operator on every map, and marked as relayed.
12. **Given** a relayed report on the map, **When** any participant looks at it, **Then** they can
    tell that it reached the map through a voice hop and can see who entered it, rather than it
    appearing indistinguishable from a report its observer entered themselves.

---

### Edge Cases

- **No network for the whole hunt**: A participant who joins before losing coverage keeps working.
  They can take bearings, see their own reports, and see every report that reached their device before
  the network dropped. Nothing blocks on a server round-trip. **What degrades is the map underneath**:
  streets and labels are only present for ground already looked at while in coverage — elsewhere the
  reports are drawn over blank space. Positions and wedges are still correct and still readable
  relative to each other; there is simply no map beneath them. A participant who has never loaded the
  hunt link cannot join while offline. Both limits are accepted and called out in Assumptions.
- **Divergent logs on reconnect**: Two devices that diverged merge by union. Every report from both
  sides survives; no ordering question is put to a participant; identical reports arriving by two
  paths are not double-drawn.
- **Poor report geometry** (fewer than three reports, narrow angular spread, wedges that do not
  cross): P1 draws no location estimate at all, so there is nothing to overstate. The map shows only
  what people actually reported. This is the strongest available form of honest uncertainty and is
  part of why the story is worth shipping alone.
- **Stock-handheld participant**: A participant without a directional antenna contributes signal
  strength and "heard nothing" reports from the same screen, on equal footing with bearings. No
  report kind is second-class, and none is presented as a lesser form of evidence.
- **Zero-width or unbounded claim**: A participant cannot submit a bearing with no stated confidence
  and no stated range. Both are required, so no report can render as an infinitely precise or
  infinitely long line.
- **Nothing but "heard nothing"**: A hunt in which every report is a negative one still renders
  honestly — the map shows where people have been and heard nothing, which is real information, and
  it does not imply the transmitter is anywhere in particular.
- **Find reported, hunt continues**: A find does not silence the hunt. Participants can still see
  the map and submit reports afterward — a find can be wrong, and P1 does not lock the log.
- **Two conflicting finds**: Two participants both reporting a find are both recorded. The map shows
  both; the system does not adjudicate which is correct.
- **A relayed report was misheard**: "Two-seven-zero" entered as "two-one-seven". The observer cannot
  fix it — they are not in the app. The operator who entered it retracts it and enters a new one, and
  both facts stay in the log. This is why the relay hop is recorded: a participant who sees a relayed
  bearing that looks wrong knows there was a voice hop where it could have gone wrong.
- **The observer is not a participant**: A voice-only operator with a radio and no phone appears on
  the map as an observer with reports against their position, without ever joining. They never chose
  a color, so one is assigned to their callsign and used consistently, the same as anyone else's — on
  the map they are a station like any other, distinguished only by their reports being relayed.
- **Two operators relay the same call**: Both reports are recorded. They are not deduplicated — the
  system cannot know two similar reports are the same observation, and guessing would destroy a real
  report. Participants see both, each marked relayed.
- **Net control relays their own observation**: They are the observer and the operator. The report is
  not marked relayed, because no hop occurred.
- **A phone whose clock is wrong**: The reporter is told, and can fix it. Reports already filed keep
  the time they were given — they are not rewritten — but they carry the offset that was known at the
  time, so everyone else sees the stated time with the doubt it deserves rather than a clean lie.
- **A phone whose clock was never checked**: A device that joined and lost coverage before any
  connection to the server has no offset. Its reports say the clock is unverified. This is not the
  same as a verified-correct clock and the map must not conflate them.
- **No compass, or a compass that is lying**: A phone held next to a yagi, a handheld, or a car may
  read badly or not at all. The participant sets the heading by hand instead; the report is not
  blocked and no drafted heading is submitted unseen.
- **Stale position**: If an observer's position was captured well before the bearing was taken, the
  report is still recorded, and the map indicates the position is stale rather than silently drawing
  the wedge from a place the observer no longer occupies.
- **Duplicate callsigns**: Two participants joining the same hunt with the same callsign are both
  admitted and visibly distinguished by a short marker beside the callsign — not by color, which they
  share by construction. The marker appears only while the collision exists. Two honest limits: one
  operator using two phones looks like two stations, and a report *relayed* under a duplicated
  callsign cannot be attributed to either of them. The map does not claim to know which one was on
  the radio, because the voice call did not say.
- **Session code reshared or guessed**: Anyone holding the code can join. P1 does not attempt to
  restrict who joins beyond possession of the code. Note this is not hypothetical — **the code is
  normally read aloud over an open repeater**, so it is semi-public the moment a hunt starts.
- **A hunt gets poisoned**: Someone plants false bearings, or a false find. Nobody can remove them —
  not the creator, not net control, not the person the report is about. The remedy is to abandon the
  hunt and start another with a fresh code, which costs one message on the air. The poisoned hunt is
  left to expire on its own. This is a deliberate consequence of reports being immutable facts about
  what someone said: a system where reports can be erased by other people is a system where the
  erasing is the attack.
- **A hunt that has run for days**: Reports accumulate and are all drawn alike, each showing when it
  was taken. P1 does not fade, rank, or filter by age — the participant reads the times and decides
  what is still true. Whether this stays readable across a real week-long interference hunt is a
  question for field validation, not one the spec answers by guessing.
- **Device data cleared, or phone replaced**: The remembered hunt is forgotten and cannot be restored
  — there is no account to restore it from. The hunt itself is untouched and its link still works.
- **Joining a different hunt**: The new hunt becomes the remembered one. The previous hunt is not
  lost — it is still live and still reachable by its link — but the device no longer points at it.
- **The remembered hunt has expired**: The participant is not dropped into a purged hunt. They land
  where a first-time visitor lands, and reach any hunt they still care about by its link.

## Requirements *(mandatory)*

### Functional Requirements

**Session and joining**

- **FR-001**: A participant MUST be able to create a hunt and obtain a shareable code and link
  without an account, an install, or a payment.
- **FR-002**: A participant MUST be able to join an existing hunt by opening its link on a phone and
  supplying a callsign or handle, without registering, installing, or paying.
- **FR-002a**: Every callsign MUST carry a color, and that color MUST be the same on every
  participant's device and everywhere that callsign's reports appear — including reports relayed on
  their behalf by someone else. An observer who never joined MUST carry a color on the same terms.
  The color MUST be derived from the callsign rather than chosen or assigned, so that it needs no
  coordination, no registration, and no network.
- **FR-002b**: Color MUST be treated as an aid to reading the map, never as the identity of a
  station. Two different callsigns MAY share a color; every report MUST therefore show its observer's
  callsign (FR-012), and no interface may rely on color alone to tell stations apart.
- **FR-002c**: When two participants report under the same callsign, the system MUST distinguish them
  visibly. It MUST NOT do so by color — a shared callsign yields a shared color by construction. The
  distinction MUST appear only when such a collision actually exists, so that the ordinary case stays
  uncluttered.
- **FR-003**: The system MUST admit multiple participants to one hunt concurrently and show each of
  them the same set of reports, subject only to what has reached their device.
- **FR-004**: A hunt MUST expire and purge its reports automatically 30 days after its most recent
  report, without a participant having to remember to clean up. The clock MUST be idle-based — every
  new report restarts it — so a hunt that is still in use never expires while people are using it.
- **FR-004a**: A hunt MUST have exactly one target, carrying a frequency, a label, and a found-state
  that begins unfound. The creator MUST be able to set the frequency and label at creation.
- **FR-004b**: Every participant MUST be able to see the target's frequency, label, and found-state
  from the primary view, so they know what they are hunting and whether it has been found.
- **FR-004c**: A device MUST remember the last hunt it was in and MUST reopen that hunt when the
  participant returns, without an account, without a server-side identity, and while offline. Moving
  to any other hunt MUST be done by opening that hunt's link.
- **FR-004d**: The system MUST NOT provide a list of past hunts, a hunt-switching interface, or any
  view that combines reports from more than one hunt. A device remembers exactly one hunt: the last
  one.

**Reporting**

- **FR-005**: A participant MUST be able to record the direction a signal came from, expressed as a
  bearing from their own position.
- **FR-005a**: A participant MUST be able to report how strong the signal is where they are standing,
  without stating any direction. The reporter MUST be offered exactly three plain-language choices,
  for the same reason bearing confidence is (FR-006a) — a signal-strength report gets the same ten
  seconds and the same gloved thumb. The recorded value maps onto the 0–9 relative scale used on the
  air, without that scale being visible.
- **FR-005b**: A participant MUST be able to report that they hear nothing where they are standing.
- **FR-005c**: A participant MUST be able to report that they have found the transmitter, which marks
  the hunt's target found.
- **FR-005d**: All four report kinds MUST be first-class evidence and MUST be reachable from the same
  reporting surface. The interface MUST NOT present the non-directional kinds as lesser
  contributions, and MUST NOT require a directional antenna to contribute.
- **FR-006**: A participant MUST be able to state how much they trust the bearing and how far away
  they believe the source is, and the system MUST require both before accepting the report.
- **FR-006a**: Bearing confidence MUST be offered as exactly three plain-language choices, each
  large enough to hit one-handed without looking closely. The choices MUST be phrased the way a
  hunter would describe a bearing out loud, not as numbers or protocol steps.
- **FR-006c**: Stated range MUST likewise be offered as exactly three plain-language choices. Range
  MUST remain in the interface rather than being defaulted silently: a wedge whose length nobody
  claimed is the map attributing a distance to a reporter who never gave one.
- **FR-006b**: Each confidence choice MUST write a definite, full-precision value to the log, so that
  a report submitted here and re-read here round-trips with no loss. A report ingested from an on-air
  format MUST retain the precision it arrived with and display as the nearest of the three choices.
  The interface MUST NOT expose the underlying value.
- **FR-007**: The system MUST record every report against the observer's position at the time of the
  observation, and MUST record the time the observation was taken — not the time it was entered.
- **FR-007a**: A participant MUST be able to enter a report on behalf of another operator who is not
  using the app — the operator relayed it by voice. This is the net control path.
- **FR-007b**: A relayed report MUST record both the observer — the callsign whose observation it is,
  and from whose position it was taken — and the operator who entered it. The system MUST NOT collapse
  the two into one identity, and MUST NOT record a relayed report as though the entering operator
  observed it.
- **FR-007c**: The observer of a relayed report MUST NOT be required to be a participant. A voice-only
  operator with a radio and no phone MUST be nameable as an observer.
- **FR-007d**: A participant entering a relayed report MUST be able to set the observer's position by
  hand, since it is not their own position and their device cannot supply it.
- **FR-008**: A participant MUST be able to establish their reporting position from their device, and
  MUST be able to place or correct it by hand when the device cannot supply one or supplies a wrong
  one. The system MUST distinguish measured positions from hand-placed ones on the map.
- **FR-008a**: The system MUST offer two ways to enter a report, and a participant MUST be able to
  reach either one without leaving the map:
  - **Device (default)** — the device's position and compass draft the report; the participant picks
    a confidence and submits.
  - **Point-at-map** — the participant taps where they are reporting from and sets the bearing and
    confidence by hand.
- **FR-008b**: In the default method the drafted heading MUST be visible before submission and MUST
  be adjustable by the participant. The system MUST NOT record a heading the participant has not had
  the opportunity to see and correct.
- **FR-008c**: When no compass reading is available, or the reading is untrustworthy, the system MUST
  fall back to letting the participant set the heading by hand rather than blocking the report or
  submitting a drafted heading anyway.
- **FR-009**: The system MUST record bearings unambiguously with respect to true north, regardless of
  whether the participant read them from a magnetic compass, and MUST NOT ask the participant to
  perform that conversion.
- **FR-009a**: The system MUST determine how far the device's clock differs from true time whenever it
  has a network connection, and MUST retain that offset for use while offline.
- **FR-009b**: The system MUST record the known clock offset on every report it authors. Where the
  offset has never been measured, the report MUST say so — an unmeasured clock MUST NOT be recorded as
  a correct one.
- **FR-009c**: The system MUST tell a participant when their clock is grossly wrong (more than two
  minutes out), and MUST NOT silently correct it. The time a participant states is a fact they
  reported; the system reports it back unaltered.
- **FR-009d**: Where a report's clock was known to be wrong, or was never checked, every participant's
  map MUST show its time with that caveat rather than presenting it as exact. A time nobody can vouch
  for MUST NOT be displayed as though someone can.
- **FR-010**: A participant MUST be able to retract a report they entered — including one they
  entered on behalf of an observer, since the observer may have no way to retract it themselves.
  Retraction MUST be recorded as a new fact; the original report MUST NOT be mutated or deleted, and
  the retraction MUST propagate to other participants.

**Rendering**

- **FR-011**: The map MUST draw each bearing report as a bounded region originating at the observer's
  position, whose angular width is set by the observer's stated confidence and whose length is set by
  the observer's stated range. It MUST NOT draw any bearing as an unbounded ray.
- **FR-011a**: The map MUST draw signal-strength, "heard nothing", and find reports at the observer's
  position, each legible as the kind of claim it is. A signal-strength report MUST NOT be drawn in a
  way that implies a direction, and a "heard nothing" report MUST NOT be drawn in a way that implies
  the transmitter is elsewhere in any particular direction.
- **FR-012**: The map MUST attribute each report to its observer — by callsign and by color — and show
  when it was taken.
- **FR-012b**: A relayed report MUST be visibly marked as relayed, and MUST identify the operator who
  entered it as well as the observer. A participant looking at the map MUST be able to tell a report
  someone entered about themselves from one that reached the map by voice through a third party,
  because the second passed through a hop the first did not.
- **FR-012a**: Reports MUST be drawn the same way regardless of age. The map MUST NOT fade, weight,
  rank, or filter reports by how old they are — a report's time is shown, and the participant draws
  their own conclusion from it. P1 renders what was reported and adds no interpretation.
- **FR-013**: The map MUST NOT display a computed location estimate, a most-likely point, or any
  derived claim about where the transmitter is. P1 shows reports and nothing else.
- **FR-014**: A report submitted by any participant MUST appear on every other connected
  participant's map within seconds of submission, with no participant action required to fetch it.

**Offline and merge**

- **FR-015**: A participant who has joined MUST be able to view the map and submit reports with no
  network connection, for the duration of a hunt, degrading only to the reports their device already
  holds.
- **FR-016**: Loss of connectivity MUST NOT lose a report, block reporting, or block display of the
  shared picture.
- **FR-017**: When two devices that hold different reports reconnect, the merge MUST be a union that
  requires no conflict resolution and drops no report from either side.
- **FR-018**: A participant MUST be able to tell, from the primary view, whether they are currently
  seeing everyone's reports or only the ones their device has received.

**Non-goals**

- **FR-023**: The system MUST remain usable on a large screen, but MUST NOT ship a net-control
  console, a keyboard-driven rapid-entry mode, or any net-control-specific layout in P1. Whether one
  is needed is a question for field validation.
- **FR-024**: The system MUST NOT define roles, permissions, or designated positions. Every
  participant has the same capabilities; net control is a thing someone does, not a thing they are.
- **FR-025**: The system MUST NOT provide any means for one participant to retract, hide, edit, or
  override another participant's report. There is no moderator, no creator privilege, and no appeal.
  A report is a fact about what someone said, and only the person who entered it may withdraw it
  (FR-010).
- **FR-026**: The system MUST limit how fast reports can be appended to a hunt, to keep one client
  from flooding it. The limit MUST be loose enough that a hunt full of hunters reporting hard never
  reaches it — it exists to stop a script, not to pace a person.
- **FR-027**: The interface MUST make clear that anyone holding the code can join and report, so a
  participant understands what the code is worth before reading it out over the air.

**Language and interoperation**

- **FR-019**: Every participant-facing surface MUST use the language hunters speak. Protocol
  vocabulary MUST NOT appear anywhere a participant can see it.
- **FR-020**: The recorded meaning of a report — bearing, stated confidence, stated range — MUST map
  losslessly to and from the existing on-air direction-finding formats, without that mapping being
  visible to participants.
- **FR-020a**: The observer/entering-operator distinction on a relayed report MUST map to the
  existing on-air notion of third-party traffic, rather than inventing a new encoding for it.
- **FR-021**: The report log format MUST be documented well enough that a third party could
  reimplement it.

**Limits**

- **FR-022**: The system MUST state its limits in the interface: it is not certified for life-safety
  search, and its picture is only as good as the reports people entered.

### Key Entities

- **Hunt**: One hunt (formerly referred to as "session"). Has a code that grants entry, a shareable
  link, exactly one target, a creation time, and an expiry after which its reports are purged. Holds
  an append-only log of reports. Hunts are cheap and disposable — creating one is not a commitment.
- **Participant**: Someone who joined a hunt, identified by a self-chosen callsign or handle, and
  distinguished on the map by a color. Has no account and no credential beyond possession of the hunt
  code.
- **Target**: What the hunt is looking for. Exactly one per hunt. Has a frequency, a label, and a
  found-state that begins unfound. Because a hunt has one target, a report does not name a target —
  it belongs to the hunt.
- **Observer**: The callsign whose observation a report is, and from whose position it was taken.
  Usually the participant who entered it. For a relayed report, someone else — possibly a voice-only
  operator who is not a participant and has no device in the hunt.
- **Report**: The atom of the system. An immutable, append-only fact. Every report carries its
  observer, the observer's position, whether that position was measured or hand-placed, the time the
  observation was taken, the operator who entered it, and its kind. When observer and entering
  operator differ, the report is relayed. Four kinds exist:
  - **bearing** — the direction the signal came from, the observer's stated confidence in it, and the
    furthest away they believe the source could be.
  - **omni** — how strong the signal is at the observer's position, on a relative 0–9 scale, with no
    direction claimed.
  - **null** — the observer heard nothing at their position. Negative evidence; cheap and abundant.
  - **fix** — the observer found the transmitter. Marks the target found.
- **Retraction**: An immutable fact that names an earlier report and withdraws it. Never removes the
  original.
- **Shared picture**: Derived state — the set of reports a device currently holds, drawn on a map.
  Computed identically from the same log on every device. Never authoritative on a server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A hunter handed only a link can be joined and looking at the map in under 15 seconds,
  with no account and no install, on their own, without being shown how.
- **SC-001a**: A bearing report takes under 10 seconds to enter, one-handed, outdoors, on a phone
  screen the reporter can barely see.
- **SC-001b**: A signal-strength or "heard nothing" report takes under 10 seconds to enter under the
  same conditions.
- **SC-002**: A submitted report is visible on every other connected participant's map within 5
  seconds of submission.
- **SC-003**: Four participants in four different locations can each see the other three's reports on
  their own device in a single hunt, with no report missing.
- **SC-004**: Every bearing on the map is drawn as a bounded region: 0% render as unbounded lines, and
  0% render without a stated confidence and range. No signal-strength or "heard nothing" report
  renders in a way that implies a direction.
- **SC-005**: No report is lost across a full offline period: a participant who submits reports with
  no connection and later reconnects finds 100% of those reports present on other participants'
  devices.
- **SC-006**: A participant can state, when asked at the end of a hunt, whose bearing they trusted
  most and why — demonstrating that the confidence shading communicated something they could act on.
- **SC-007**: In a real hunt, participants stop calling raw bearings over voice for the purpose of
  sharing them, because the map already carries them.
- **SC-008**: 0 protocol jargon terms appear on any participant-facing surface, verified by review of
  every screen a participant can reach.
- **SC-009**: At a real hunt, at least one participant with no directional antenna submits reports
  that other participants act on — demonstrating the non-directional contribution path works in the
  field, not just on paper.
- **SC-010**: 100% of bearing reports submitted via the default entry method were seen by their
  reporter before submission; 0 headings are recorded that the reporter had no chance to correct.
- **SC-011**: 0 relayed reports are attributed to the operator who typed them. Every relayed report on
  the map names its observer and is visibly marked as having come through a voice hop.
- **SC-012**: At a real hunt, someone with no radio in hand keeps up with voice traffic — entering
  relayed reports as fast as they are called — and the participants in the field report that the map
  matched what they heard on the air.

## Assumptions

- **All four report kinds ship in P1.** Signal-strength and negative reports are cheap to carry when
  there is no fusion — each is a position plus one scalar — and including them means no participant
  is a spectator in the first story. This satisfies Constitution Principle II.
- **"Contributes" in P1 means visible to the group, not folded into an estimate.** Principle II calls
  for non-directional reports to be first-class inputs to the location estimate; P1 has no estimate,
  so the strongest available reading is that every kind is first-class *evidence on the shared map*.
  The obligation that they feed the posterior lands with the story that introduces the posterior.
- **Joining requires having loaded the link once**: A participant must reach the hunt link while
  they still have connectivity. After that, reporting and the shared picture work offline. Fully
  offline first-join is out of scope for P1.
- **There is no offline basemap, and this is a deliberate limit.** Reports always render offline; the
  streets under them do not, except where the hunter already looked while in coverage. Every source of
  map tiles that could supply a downloadable area explicitly prohibits downloading one, so an offline
  basemap would mean building and hosting a tile pipeline — a project in its own right, attached to a
  story whose premise is being the smallest useful thing. Whether a blank map with correct reports on
  it is good enough in a real field is exactly the sort of question the field gate exists to answer,
  and it will be answered outdoors rather than guessed at here.
- **Participants carry a phone with a browser and have not been trained on this tool.** They may have
  a compass, a sniffer, and a handheld; they do not have documentation.
- **Confidence and range are stated by the observer, not measured.** The system does not second-guess
  them and does not attempt to calibrate them against other reports in P1.
- **Net control is a behaviour, not a role.** Nobody is designated net control; there is no
  permission, no election, and no special interface. Anyone can enter a relayed report, and net
  control is simply the participant who happens to be doing it a lot from a warm room. This keeps the
  no-account constraint intact and means a hunt does not break if net control's phone dies.
- **A relayed report is trusted exactly as much as its observer's bearing deserves, minus a voice
  hop.** P1 does not model that arithmetic — it records the hop and shows it, and lets the
  participant judge. The system never scores or ranks a relayed report against a direct one.
- **Position defaults to the device's own location, with hand-placement always available** as an
  override, because location may be denied, unavailable under canopy, or simply wrong.
- **Four kinds of user shape this spec.** P1 builds no role, no permission, and no separate interface
  for any of them — they are all just participants, and the same screen serves all four. They are
  recorded because each one caused a requirement:
  - **Hunter (equipped)** — a tape-measure yagi or a Doppler, on foot or mobile, entering bearings
    cold, gloved, or driving. Drives the sub-10-second interaction (SC-001a), the three fat
    confidence buttons (FR-006a), and the compass-drafts-a-heading default (FR-008a).
  - **Hunter (unequipped)** — a handheld and a rubber duck, who needs to contribute meaningfully
    rather than watch. Drives signal-strength and "heard nothing" reports as first-class evidence
    (FR-005a/b/d), and is why Constitution Principle II is satisfied in the first story.
  - **Net control** — at home or in a command post, no radio in hand, entering reports relayed by
    voice on behalf of others and watching the picture build. Drives relayed reports and the
    observer/entering-operator distinction (FR-007a–d, FR-012b). They are the one persona whose
    context contradicts the spec's stated constraints — a keyboard and a monitor, not a cold glove
    and a phone — and P1 does not resolve that contradiction in their favour: the interface works on
    their screen without being designed for it (FR-023). If that proves too slow to keep up with
    voice traffic, field validation will say so (SC-012), and the console becomes its own story.
  - **Interference hunter** — chasing a stuck mic, a jammer, or a noisy switching supply over days
    rather than an afternoon, against something nobody hid and that may be intermittent. Drives the
    30-day retention window, and nothing else: P1 deliberately builds them no history feature. That
    window, plus the device reopening the last hunt and the link continuing to work, is the whole of
    P1's answer to "revisit over days".
- **Hunts purge 30 days after their last report**, on an idle clock, because the interference hunter
  needs them to. Settled. The privacy cost is small and accepted: P1 shares position per-report only,
  so what persists is where someone stood to take a report, not a movement trace. The one forward
  note worth keeping: if continuous position tracking is ever added, re-examine this window — a month
  of traces is a different thing from a month of report pins.
- **Report age carries no rendering meaning in P1.** A week-old bearing and a fresh one are drawn
  identically, each labelled with its time. This is consistent with Principle I as written — the
  principle governs derived estimates and report geometry, and P1 derives nothing; a raw report with
  an honest timestamp overstates nothing. The alternative (fading old reports, or filtering by time
  window) was considered and rejected as interpretation P1 has not earned the right to apply. It
  becomes a live question when fusion arrives and age genuinely affects weighting, and it is worth
  watching in field validation of a long interference hunt.
- **The link is the durable handle for a hunt; the device's memory is only a convenience.** A device
  remembers one hunt — the last one — and reopens it. There is no list, no history, no hunt switcher,
  and no multi-hunt view; these were considered during clarification and cut as unearned. Anyone who
  needs to return to a specific hunt keeps its link, which is what a code and a shareable link are
  for. An interference hunter working one problem over a week is served by the fact that the hunt
  they are in is the hunt they left.
- **Multi-hunt is out of scope, and that is a scope boundary rather than an oversight.** No combining
  reports across hunts, no correlating one noise source across sessions, no cross-hunt search. If
  that need proves real, it arrives as its own story with its own field observation behind it.
- **Possession of the hunt code is the only access control in P1.** No hunt password, no participant
  vetting. The internet leg carries no content that would be a problem on air. The constitution
  permits a session password, and P1 declines to add one: it is another thing to type with a glove on,
  guarding a hunt whose code is being read aloud on an open channel anyway.
- **The threat model is honest about what it does not cover.** Anyone who hears the code can join,
  report, and plant a false find, and nothing can remove what they wrote. The defence is social and
  disposable rather than technical: a hunt is a few hours of a shared radio channel among people who
  mostly know each other, and a spoiled one is replaced by saying a new code. What P1 defends against
  is a *script* — hence the rate limit (FR-026) and code entropy — not a determined human with a
  receiver. If FoxMapper is ever used where a hostile participant is likely, this assumption breaks
  and the constitution's session password is the first thing to revisit.
- **No estimation, no fusion, no server-side direction-finding logic.** The server moves reports
  between devices and holds nothing a device could not recompute.
