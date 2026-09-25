# Feature Specification: Location Estimate

**Feature Branch**: `docs/location-estimate-spec`

**Created**: 2026-09-25

**Status**: Implemented (field validation deferred)

**Input**: User description: "Location estimate: from the shared reports, show where the fox probably
is as a credible region, with every report kind contributing"

## Clarifications

### Session 2026-09-25

- Q: Is a strong signal report from one station evidence that the fox is closer to it than to a
  station that reported weak, given that radios and antennas differ? → A: Yes, loosely. Louder means
  probably closer, with a tolerance wide enough to cover mismatched radios. Treating each report as
  only "heard here" would make the handheld hunter's strength choice change nothing, which weakens
  Principle II.
- Q: Does a find replace the region, or count as strong evidence alongside the other reports? → A:
  Strong evidence alongside the other reports. A wrong find can be outweighed. Two conflicting finds
  become two regions with a "reports disagree" warning, so no special rule is needed and the system
  still does not adjudicate between finds.
- Q: Does a report's age change how much it counts? → A: No. Every active report counts the same, and
  hunters retract reports they no longer believe. This keeps the log format's rule that nothing is
  computed from report times (log-format §8), because an offline phone clock can silently discount
  good reports.
- Q: Who turns the estimate off, and is it on by default? → A: Each participant, on their own device.
  It is off by default, and a participant turns it on. The device remembers the choice. No hunt-wide
  switch exists, because that would need a creator privilege (001 FR-024) and a log change (FR-025).
- Q: What likelihood does the region stand for? → A: 90%. Each region together holds 90% of the
  estimate's probability, and participants read it as "about 9 times in 10". 95% makes the region much
  larger for little a hunter can act on. 68% is wrong one time in three.
- Q: Who tunes the estimate? → A: Only the maintainers. Every contribution rule and warning threshold
  is a named number kept in one documented place, and a change is accepted only after a rerun of the
  reference hunts. Participants get the on/off switch and nothing else, which keeps FR-018 true.
- Q: Where do the reference hunts come from? → A: Simulated now, with recorded real hunts added when
  they exist. A simulated hunt proves the estimate agrees with its own assumptions, not that it is
  right in the field, and the spec says so wherever SC-001 is claimed.
- Q: How does the estimate treat one report that disagrees with the rest? → A: Each report's influence
  has a floor, so no single report can rule out an area the other reports support. When any report
  conflicts with the rest beyond a named threshold, the map shows the existing "the reports disagree"
  warning without naming which report, which keeps FR-026 intact.
- Q: Does turning the estimate on or off send an analytics event? → A: Yes, one anonymous event,
  `estimate_toggled` with `enabled`, like the existing `relay_mode_toggled`. It carries no position and
  no content, and the existing analytics opt-out covers it. The choice itself still never reaches the
  hunt server or other participants.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Where the fox probably is (Priority: P1)

A hunt is underway and the map carries a dozen reports: bearing wedges from three hunters with
yagis, signal-strength reports from two people with handhelds, and a scatter of "heard nothing"
reports from people who drove through and heard silence. Today every participant reads that picture
in their head, and each reads it differently. With this story, the map also draws one shaded region
and says, in plain words, "the fox is probably in here." The region is the group's evidence combined:
wedges pull it toward where they overlap, a strong signal pulls it closer to the station that heard
it, and "heard nothing" pushes it away from where people listened and got silence.

The region is honest about itself. When there is only one bearing, the region is as long as that
bearing and no wider, and the map says the estimate is weak and why. When two groups of reports
disagree, the map shows two regions, not one averaged blob between them. As more reports arrive, the region
tightens, and every participant sees it tighten at the same time, from the same reports, with or
without a network connection.

The hunter with a stock handheld sees their report move the region. That is the point of the story.

The estimate is off until a participant turns it on. Some hunters want to read the reports and draw
their own conclusion, and some hunts are run as a test of that skill. A participant who never turns
it on sees the map exactly as it is today. The choice belongs to each participant and each device,
and it changes nothing for anyone else in the hunt.

**Why this priority**: It is the one story this spec contains. The constitution forbids shipping
any smaller slice of it. Principle II requires every non-directional report to feed the estimate
from the moment an estimate exists, so a bearings-only first cut is not allowed. Principle I requires
every estimate to carry its credible region and its weakness warnings, so an estimate without them
is not allowed either. What remains after both rules is this story, whole.

The motivation is the one 001 recorded and deferred. In its Field Validation, a participant "drives or
walks toward where the wedges overlap, or toward whoever is hearing it loudest". Participants do that
arithmetic in their heads today. This story does it once, the same way on every phone, and shows how
much to trust it.

**Independent Test**: Load a hunt log with a known transmitter position and a mix of all four report
kinds onto four devices, two of them offline, with the estimate turned on. Every device draws the same
region, the region contains the known position, and the weakness warning appears exactly when the
geometry is poor. Removing the signal-strength and "heard nothing" reports from the log visibly
changes the region, which proves they contributed.

**Field Validation** *(deferred milestone — not a gate)*: At a real hunt, participants who did not
build the tool are asked afterward whether the region helped them decide where to go, and whether
they trusted it more or less than it deserved. At least one participant with only a handheld is asked
whether they could see their reports change the region. It survived contact if hunters used the
region to choose a direction and the fox was inside it when found. It did not survive if a hunter
drove confidently to the region's centre and the fox was outside it while the map showed no warning.
That outcome is the specific failure Principle I exists to prevent, and it is recorded verbatim if it
happens.

**Acceptance Scenarios**:

Scenarios 1–11 assume the participant has turned the estimate on.

1. **Given** a hunt with two bearings that cross, **When** the map renders, **Then** it shows a
   region around the crossing and states in plain language that the fox is probably inside it.
2. **Given** a hunt with exactly one bearing, **When** the map renders, **Then** the region runs the
   full length of that bearing's wedge, lies within it, and the map warns, in the primary view, that
   the estimate rests on too few reports.
3. **Given** a region drawn from bearings, **When** a participant reports "heard nothing" from inside
   that region, **Then** the region moves away from or shrinks around that participant's position on
   every device.
4. **Given** a region drawn from bearings, **When** a participant with a handheld reports a strong
   signal from a position at one end of the region, **Then** the region shifts toward that participant.
5. **Given** two bearings that are nearly parallel, **When** the map renders, **Then** the map warns
   that the reports point the same way and cannot pin down a distance, rather than drawing a small
   region at a distant crossing.
6. **Given** two groups of reports that point at two different places, **When** the map renders,
   **Then** it draws a separate region for each and warns that the evidence disagrees, rather than one
   region between them.
7. **Given** a participant with no network connection, **When** they submit a report or receive one
   from before the network dropped, **Then** their own region updates within seconds without a server
   round-trip.
8. **Given** two devices holding the same set of reports, **When** each renders the estimate,
   **Then** both draw the same region and the same warnings.
9. **Given** a report that feeds the region, **When** its author retracts it, **Then** the region is
   recomputed without it on every device that has received the retraction.
10. **Given** a hunt whose only reports are "heard nothing", **When** the map renders, **Then** no
    region is drawn and the map says there is not yet anything pointing at the fox.
11. **Given** a region on the map, **When** a participant looks at it, **Then** every report beneath
    it stays visible and readable, and no single point is drawn as the fox's location.
12. **Given** a participant who has never changed the setting, **When** they join a hunt, **Then** the
    map draws no region and no estimate warnings, exactly as it did before this story.
13. **Given** a participant with the estimate on, **When** they turn it off, **Then** the region and
    its warnings disappear from their map at once, and nothing changes on any other participant's
    map.
14. **Given** a participant who turned the estimate on, **When** they close the app and later reopen
    it, offline or in another hunt, **Then** the estimate is still on.

---

### Edge Cases

- **No network for the whole hunt**: Each device computes its region from the reports it holds. A
  device that is missing reports draws a region from fewer reports, and says so through the existing
  indicator of whether it holds everyone's reports (001 FR-018). Two devices that have diverged draw
  different regions. That is correct: each is honest about what it knows. When they reconnect and
  merge, both draw the same region.
- **Divergent logs on reconnect**: The merged log is a union. The region is recomputed from it, and
  nothing about the region is stored or merged separately.
- **Poor geometry** — fewer than three reports, narrow angular spread, or evidence pointing at more
  than one place: the region is drawn as large as the evidence leaves it, and a warning in the primary
  view names which condition applies in hunter language. The warning is part of the region, not a
  footnote, a tooltip, or a dismissible dialog.
- **Stock-handheld participant only**: A hunt with only signal-strength reports and "heard nothing"
  reports still produces a region if any report heard the signal. That region is wide, and it is
  labelled weak. The participant sees their reports shape it.
- **Nothing but "heard nothing"**: No region. Silence rules places out and points at nothing. The map
  already shows where people heard nothing (001), and drawing a region from absence alone would claim
  a location nobody has evidence for.
- **A bearing that misses everything**: One wedge points away from where every other report puts the
  fox. It cannot shrink the region onto the wrong place, because no single report can rule out an area
  the others support (FR-040). It is not silently dropped either. The map shows "the reports disagree"
  (FR-012a) and does not say which report disagrees (FR-026).
- **A wrong bearing that nothing contradicts**: With only one or two reports, a confident wrong bearing
  has nothing to conflict with, so it pulls the region away from the fox and no disagreement is seen.
  The "too few reports" warning (FR-010) is the only signal. The remedy is the one 001 already
  provides: its author retracts it. The region is an argument built from what people said, and it is
  no better than what they said.
- **A find is reported**: A "found it" report is the strongest evidence a hunt can hold, and it feeds
  the region like every other report (see FR-005). A find does not stop the hunt or lock the region,
  because a find can be wrong.
- **Two conflicting finds**: Both stand, as in 001. Each place gets its own region, and the map warns
  that the reports disagree (FR-005, FR-012). The system does not pick one.
- **A hunt that has run for days**: Every active report feeds the region, and a week-old report counts
  the same as a fresh one (FR-006). Participants keep the region current by retracting reports they
  no longer believe. Whether that stays workable over a real week-long interference hunt is a
  question for field validation.
- **A relayed report**: It feeds the region the same way a direct report does. The voice hop is shown
  on the report (001 FR-012b) and does not change its weight.
- **Hand-placed position**: It feeds the region from the position the participant placed. The system
  does not trust it less than a measured one, because it has no honest measure of how much less.
- **Ingested report with a confidence nobody can read**: A bearing ingested from the air with a
  confidence digit that has no agreed width feeds the region at the widest width, the same width the
  map already draws it at.
- **Two devices on different releases**: If the estimate values changed between releases, two devices
  holding the same reports can draw different regions. FR-018 holds only between devices on the same
  release. This is accepted: a hunt is hours long, and the reports themselves are unaffected.
- **A phone that is slow**: A long hunt holds hundreds of reports. The region still updates within the
  time in SC-002 on an ordinary phone, and computing it never blocks reporting.
- **The tour**: The first-visit tour (003) already has a step about the estimate. While no live region
  exists it shows a sample. Once this story ships, the step points at the live region when one exists.
  With the estimate off, the step shows its sample and says where to turn the estimate on.
- **Estimate off**: The map is the 001 map. No region, no estimate warnings, and no "nothing points at
  the fox yet" message. Reports, the offline indicator, and every other warning are unchanged.
- **Two participants, one on and one off**: They look at different maps of the same reports. That is
  intended. Neither participant's choice reaches the other, the hunt server, or the report log. The
  only trace is the anonymous `estimate_toggled` count (FR-041), which carries no hunt and no
  participant.

## Requirements *(mandatory)*

### Functional Requirements

**The estimate**

- **FR-001**: While the estimate is on (FR-028), the map MUST draw a location estimate, derived from
  the hunt's active reports, as one or more shaded regions that the transmitter is probably inside.
- **FR-002**: The estimate MUST be presented as a region only. The map MUST NOT draw a most-likely
  point, a centre marker, crosshairs, or coordinates for the transmitter.
- **FR-003**: The regions MUST together hold 90% of the estimate's probability. The map MUST state
  that in plain language ("the fox is probably in here — about 9 times in 10"), without statistical
  vocabulary.
- **FR-004**: Every active report MUST be able to change the estimate, according to what its kind
  claims:
  - **FR-004a**: A bearing MUST pull the estimate toward the area its wedge covers, within the wedge's
    stated width and range. A bearing MUST NOT push probability beyond its stated range.
  - **FR-004b**: A signal-strength report MUST pull the estimate toward its observer's position, and a
    stronger report MUST pull harder than a weaker one. How reports from different observers compare
    is loose: a louder report from one station is evidence that the fox is probably closer to that
    station than to a station that reported weaker. The tolerance MUST be wide enough that two
    observers with mismatched radios and antennas do not produce a region tighter than their reports
    support (FR-014).
  - **FR-004c**: A "heard nothing" report MUST lower the probability near its observer's position. It
    MUST NOT raise the probability of any other particular place.
- **FR-005**: A find MUST feed the estimate as strong evidence at its observer's position, alongside
  every other active report. It MUST NOT replace the region. Other reports that disagree with a find
  MUST still count, so enough contrary evidence can outweigh a wrong find. Two conflicting finds MUST
  be treated like any other disagreement (FR-012): each place gets its own region, and no rule picks
  one find over the other.
- **FR-006**: Report age MUST NOT change how much a report counts. Every active report counts the same
  whenever it was taken. The estimate MUST NOT read report times at all, because phone clocks are
  unreliable offline. A participant who no longer believes an old report retracts it.
- **FR-007**: Retracted reports MUST NOT feed the estimate.
- **FR-008**: A relayed report MUST feed the estimate exactly as a direct report with the same content
  would. A hand-placed position MUST feed it exactly as a measured position would.
- **FR-009**: The estimate MUST NOT use a device's reported position accuracy or any report's clock
  offset as a weight.

**Turning the estimate on and off**

- **FR-028**: Each participant MUST be able to turn the estimate on and off on their own device, from
  Settings, without leaving the hunt.
- **FR-029**: The estimate MUST be off by default. A participant who has never turned it on MUST see
  no region and no estimate warnings.
- **FR-030**: The device MUST remember the choice across restarts, across hunts, and offline. The
  choice MUST NOT be written to the report log, sent to the hunt server, or shown to other
  participants.
- **FR-041**: Turning the estimate on or off MUST send one anonymous analytics event,
  `estimate_toggled`, whose only property is `enabled`. It MUST follow the existing analytics rules:
  no position, no report content, no hunt code, and nothing sent when analytics is off. The analytics
  document MUST list the event.
- **FR-031**: With the estimate off, the map MUST NOT compute or draw a region or its warnings, and
  MUST otherwise behave exactly as it did before this story.
- **FR-032**: Warnings that belong to the estimate (FR-010 to FR-016) MUST appear only while the
  estimate is on. Principle I governs a derived estimate, and with the estimate off there is none.

**Honest uncertainty**

- **FR-010**: When the estimate rests on fewer than three reports, the primary view MUST say so.
- **FR-011**: When the reports that feed the estimate point in nearly the same direction, and so
  cannot fix a distance, the primary view MUST say so, and the region MUST extend as far along that
  direction as the reports' stated ranges allow.
- **FR-012**: When the evidence points at more than one place, the map MUST draw each place as its own
  region and the primary view MUST say that the reports disagree. The system MUST NOT merge the places
  into one region between them.
- **FR-012a**: When any single report conflicts with the rest beyond a named threshold (FR-034), the
  primary view MUST show the same "the reports disagree" warning as FR-012. It MUST NOT say which
  report conflicts (FR-026).
- **FR-013**: Uncertainty warnings MUST appear in the primary view, next to the estimate. They MUST
  NOT be placed in a footer, a tooltip, or a dialog that can be dismissed. A warning MUST remain while
  its condition holds.
- **FR-014**: The region MUST NOT be smaller than the reports support. A change that makes the region
  look tighter without the reports supporting it is a defect.
- **FR-040**: A single report MUST NOT be able to rule out, on its own, an area that the other active
  reports support. Each report's influence MUST have a floor, defined by a named value (FR-033).
- **FR-015**: When no report claims to have heard the transmitter — no bearing, no signal strength,
  no find — the map MUST NOT draw a region, and MUST say that nothing yet points at the fox.
- **FR-016**: Warnings MUST use hunter language ("too few reports", "these bearings all point the
  same way", "the reports disagree"). Statistical and protocol vocabulary MUST NOT appear.

**Quantified and tunable**

- **FR-033**: Every rule by which a report kind moves the estimate (FR-004a–c, FR-005), the distance
  a "heard nothing" report rules out, and the floor on a single report's influence (FR-040) MUST be
  defined by named numeric values.
- **FR-034**: Every warning condition MUST be defined by a named numeric threshold: the report count
  below which FR-010 applies (3), the angular spread below which FR-011 applies, the share of
  probability a second place must hold before FR-012 applies, and the degree of conflict at which
  FR-012a applies.
- **FR-035**: All the values in FR-033 and FR-034 MUST live in one documented place, each with its
  value and the reason for it. No such value may appear anywhere else.
- **FR-036**: The estimate MUST expose, for any set of reports, the numbers it was drawn from: the
  probability held by each region, and the measured value behind each warning condition. Tests and
  later features read these numbers. Participants see only the plain-language forms (FR-003, FR-016).
- **FR-037**: Only maintainers change these values, by releasing a new version. A change MUST be
  accepted only when the reference hunts still meet SC-001, SC-003, SC-004 and SC-012. Participants
  MUST NOT be able to change any value, and a hunt MUST NOT carry its own values.
- **FR-038**: The simulated reference hunts MUST include every poor-geometry condition (FR-010 to
  FR-012), a hunt of only "heard nothing" reports, a hunt of only signal-strength and "heard nothing"
  reports, two conflicting finds, and one confidently wrong bearing.
- **FR-039**: A recorded real hunt with a confirmed fox position MUST be added to the reference hunts
  when one exists. Any claim that SC-001 is met MUST say whether it rests on simulated hunts alone.

**Where and when it is computed**

- **FR-017**: Each device MUST compute the estimate from the reports it holds, with no server
  involvement. The server MUST NOT compute, store, or send an estimate.
- **FR-018**: Two devices on the same release holding the same set of reports MUST draw the same
  region and the same warnings.
- **FR-019**: The estimate MUST update on its own when a report arrives, is submitted, or is
  retracted. No participant action is needed.
- **FR-020**: The estimate MUST work with no network connection, from the reports the device holds.
- **FR-021**: Computing the estimate MUST NOT block or slow report entry.
- **FR-022**: The estimate MUST NOT be written to the report log. It is derived state, recomputed
  from the log on every device.

**Reading the map**

- **FR-023**: The region MUST NOT hide the reports beneath it. Every report MUST stay visible,
  attributed, and readable while the region is drawn.
- **FR-024**: The region MUST be legible in bright outdoor light and to participants with common
  colour vision deficiencies, and MUST NOT rely on colour alone to show where it is.

**Scope boundaries**

- **FR-025**: This story MUST NOT add report kinds, change what an existing report records, or change
  the log format.
- **FR-026**: This story MUST NOT rank, score, or label individual reports or participants by how
  well they agree with the estimate.
- **FR-027**: The system MUST continue to state its limits in the interface (001 FR-022). The estimate
  MUST NOT be described in any way that suggests it is fit for life-safety search.

### Key Entities

- **Location estimate**: Derived state. The set of places the transmitter probably is, computed from
  the active reports a device holds. It is recomputed whenever those reports change. It is never
  stored, never sent, and never authoritative anywhere.
- **Region**: One contiguous place in the estimate. There is usually one. There is more than one
  when the evidence points at more than one place.
- **Uncertainty warning**: A plain-language statement, shown with the estimate, that one of the
  poor-geometry conditions holds: too few reports, reports that all point the same way, or reports
  that disagree. "Disagree" covers both evidence pointing at more than one place and a single report
  that conflicts with the rest. It exists exactly as long as its condition does.
- **Report**: Unchanged from 001. Each active report's kind decides how it moves the estimate.
- **Estimate values**: The named numbers that define how each report kind moves the estimate and when
  each warning applies (FR-033, FR-034). One documented set per release. Only maintainers change it.
- **Reference hunt**: A set of reports with a known transmitter position. The reference hunts as a set
  are the test that every change to the estimate values must pass. Each one is either **simulated**
  (reports generated around a chosen fox position, with errors drawn to match each report's stated
  confidence) or **recorded** (the log of a real hunt whose fox position was confirmed). Every
  reference hunt is labelled with which it is.
- **Estimate setting**: One on/off choice held by a device. Off until a participant turns it on. It
  applies to every hunt on that device, and it lives only on that device.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across the reference hunts, the transmitter lies inside the drawn region in at least 90%
  of hunts. Met on simulated hunts, this proves the estimate is consistent with its own assumptions.
  It proves accuracy in the field only once recorded real hunts are part of the set (FR-039).
- **SC-002**: A new or retracted report changes the region on the device that holds it within 2
  seconds, for a hunt of up to 500 active reports, on a mid-range phone, with no network.
- **SC-003**: 100% of estimates drawn from fewer than three reports, from nearly parallel bearings,
  from evidence that points at more than one place, or with a report that conflicts with the rest
  carry the matching warning in the primary view.
- **SC-012**: In the reference hunt with one confidently wrong bearing among correct reports, the
  transmitter stays inside the region and the "reports disagree" warning is shown.
- **SC-004**: 0 regions are drawn in a hunt where no report heard the transmitter.
- **SC-005**: Four devices holding the same reports draw the same region and the same warnings in
  100% of reference hunts.
- **SC-006**: For every reference hunt that contains signal-strength or "heard nothing" reports,
  removing them produces a visibly different region. This proves every kind contributes.
- **SC-007**: 0 statistical or protocol terms appear on any surface the estimate adds, verified by
  review of every screen.
- **SC-008**: At a real hunt, a participant with the estimate on who is asked "where do you think the
  fox is, and how sure are you?" gives an answer consistent with the region and its warning.
- **SC-009**: At a real hunt, a participant with only a handheld and the estimate on can point to a
  change in the region that their own report caused.
- **SC-010**: A participant can find and turn on the estimate in under 30 seconds, unaided, from
  inside a hunt.
- **SC-011**: With the estimate off, 0 regions and 0 estimate warnings appear on the map.

## Assumptions

- **The fox does not move.** The estimate assumes one stationary transmitter per hunt, as 001 set
  exactly one target per hunt. A mobile fox makes old reports point at places the fox has left. It is
  out of scope, and it is a separate story if it ever proves real.
- **The fox transmits the whole time it is being hunted, or often enough.** A "heard nothing" report
  taken while an intermittent source was silent is recorded honestly, and it will push the region away
  from where the source is. This is a real limit for interference hunters chasing an intermittent
  source. The participant's remedy is to retract a "heard nothing" they no longer believe.
- **Simulated hunts are where testing starts, not where it ends.** No real hunt has been recorded yet,
  so the first reference hunts are simulated. They assume reporters state their confidence honestly,
  and real hunters may not. Recorded hunts replace that assumption with evidence once they exist.
- **Stated confidence and range are taken at face value**, as in 001. The estimate does not calibrate
  observers against each other or against the result. A hunter who overstates their confidence gets a
  region that trusts them too much. This is the direct cost of "confidence is stated by the observer,
  not measured", and it is accepted.
- **"Heard nothing" means nothing within a limited distance.** Nobody knows the fox's power, so a
  "heard nothing" report can rule out only the area near its observer. How near is a planning
  decision, bounded by FR-014: when unsure, rule out less.
- **One region likelihood, stated once: 90%.** The map shows the region at that one fixed likelihood,
  stated in words (FR-003). Nested contours and a user-chosen likelihood were considered and left out
  as more than a hunter needs to read at a glance.
- **No single point.** 001 forbade a most-likely point. This story keeps that rule (FR-002). A point
  invites driving to it, and a point says nothing about how sure anyone is.
- **Relayed reports and hand-placed positions count in full.** 001 decided the system never scores a
  relayed report against a direct one. Discounting them now would be that same scoring, applied
  invisibly. A participant who doubts a relayed report can see that it was relayed.
- **The region is not a new place to hide warnings.** The poor-geometry conditions are the three
  Principle I names. A single conflicting report raises the existing "disagree" warning rather than a
  new one. This story makes no promise about what it cannot detect, such as a confidently wrong
  bearing that no other report contradicts.
- **The tour's estimate step already exists** (003). It uses a sample until a live estimate exists.
  Pointing it at the live region is part of this story. Rewriting the tour is not.
- **The log format document says "No location is estimated or computed."** That sentence stops being
  true when this ships and is updated. Nothing else in the log format changes (FR-025).
- **001 FR-013 is superseded.** It forbade drawing an estimate in P1. This story is the one that
  lifts it. 001 FR-012a still holds for how each report is drawn: reports are not faded or filtered by
  age on the map, and FR-006 keeps age out of the estimate as well.
