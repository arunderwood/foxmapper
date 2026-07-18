# Feature Specification: First-Visit Product Tour

**Feature Branch**: `003-product-tour`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Add an optional product tour / guided tutorial for first-time visitors that walks the user through the app. A product tour overlay points out the buttons and fields in order. The goal: a user who completes the tour should be excited to use FoxMapper during a hunt and should know how to introduce it to a team for a hunt. The project must also include the appropriate Claude Code instrumentation (hook/rule/skill) to ensure the tour is kept up to date whenever there is a significant change to the product that may invalidate the tour."

## Clarifications

### Session 2026-07-17

- Q: What accessibility and dismissal baseline must the tour overlay meet? → A: Full baseline — keyboard-navigable (advance/back/exit), ESC and tap-on-scrim dismiss, focus moves to the active step, honors reduced-motion, and each step's copy is announced to screen readers.
- Q: When the tour's content materially changes (version bump), what happens for a device that already completed an older version? → A: No re-offer for now — the version is recorded but a bump does not itself re-offer the tour; how to re-offer after a material change is decided per-update, out of scope here. Returning users still reach the current tour via the manual relaunch affordance (FR-003).
- Q: Which surfaces beyond the core loop should the first-visit tour include? → A: Core loop only — join/target, map + estimate, the three report kinds, and share. Retract, settings, and relay are out of the guided walkthrough (relay only surfaces at all when its per-device mode is on, per the edge case).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A first-timer is walked through the hunt loop (Priority: P1)

A ham who has never opened FoxMapper lands in a hunt for the first time. Instead of an unfamiliar
map and a row of unlabeled buttons, they are quietly offered a guided tour. If they accept, an
overlay walks them, in order, through the surfaces that matter: how they got into this hunt and what
they are looking for, the map and the current location estimate, and — the heart of it — the three
ways they can contribute a report from whatever radio they are holding. When the overlay finishes,
it leaves them on a live hunt view, ready to file their first real report. If they decline, nothing
about the app is blocked or changed.

**Why this priority**: This is the feature. Without the ordered walkthrough there is no tour. It is
the minimum that delivers the stated goal — a newcomer who finishes feels ready to use the tool on a
real hunt — and it is demonstrable on its own.

**Independent Test**: Open the app as a device with no prior tour record, accept the offered tour,
and step through every stop. Verify each step highlights the actual control it describes, that the
three report kinds (bearing, signal-strength, "I hear nothing here") are each shown, that the
credible-region/uncertainty display is called out honestly, and that finishing lands on a usable
hunt view. Verify declining leaves the app immediately usable with no added steps.

**Field Validation** *(deferred milestone — not a gate)*: A hunter who has never seen FoxMapper is
handed a phone at the start of a real hunt, takes the tour once, and then files a correct report
during the hunt without further coaching. The observation that proves it: they contribute usable
evidence on their first hunt having had only the tour, not a person, explain the tool.

**Acceptance Scenarios**:

1. **Given** a device with no record of the tour, **When** the participant first reaches a hunt
   view, **Then** the tour is offered in a way that can be accepted or dismissed without blocking any
   other action.
2. **Given** the tour is running, **When** the participant advances through it, **Then** each step
   points at the specific control or field it describes, shows progress (step N of M), and allows
   moving back as well as forward.
3. **Given** the tour reaches reporting, **When** the participant views the reporting steps, **Then**
   all three first-class report kinds are shown, and it is made explicit that a stock handheld with
   no directional antenna can still contribute.
4. **Given** the tour reaches the estimate, **When** the participant views that step, **Then** the
   credible region / uncertainty display is pointed out and described as a region that grows less
   certain with poor reports — never as a precise point.
5. **Given** the participant declines or exits the tour at any step, **When** they do so, **Then**
   joining, reporting, and viewing the estimate remain fully available with no extra steps.
6. **Given** the tour completes, **When** the last step is dismissed, **Then** the participant is on
   a live, ready-to-use hunt view.

---

### User Story 2 - A completer knows how to bring a team into the hunt (Priority: P2)

Direction finding is a team sport: one radio produces a wedge, three radios produce a fix. A person
who finishes the tour should not only know how to report — they should know how to get their friends
into the same hunt. The tour includes a step that points out how to invite others (share the hunt)
and frames the pitch a hunter would actually make: no account, no install, just open the link and
start reporting.

**Why this priority**: The request names two goals — ready to use it, and ready to introduce it to a
team. This story delivers the second. It builds on US1's walkthrough but is a distinct, separately
testable slice: the team-invitation step and its framing.

**Independent Test**: Complete the tour and confirm it includes a step that points at the
share/invite affordance, explains how a teammate joins, and states that joining needs no account or
install. In a comprehension check, a participant who just finished can describe how they would bring
a friend into the hunt.

**Field Validation** *(deferred milestone — not a gate)*: A hunter who took the tour sends the hunt
link to two friends on the repeater, and those friends join and file reports without being walked
through anything. The observation that proves it: a team assembles into one hunt off the strength of
one person's tour.

**Acceptance Scenarios**:

1. **Given** the tour is running, **When** it reaches the team step, **Then** it points out the
   share/invite affordance and explains, in plain language, how a teammate joins the same hunt.
2. **Given** the team step, **When** the participant reads it, **Then** it makes clear that joining
   requires no account, no install, and no payment.

---

### User Story 3 - The tour cannot silently rot (Priority: P2)

The tour describes specific buttons and fields in a specific order. The day a control is renamed,
moved, removed, or a new way to contribute is added, the tour becomes a liar — and a tour that points
at the wrong thing is worse than no tour, because it teaches a newcomer something false on their
first contact. The project carries an automated check, wired into the Claude Code workflow, that
notices when a change may have invalidated the tour and makes updating (or explicitly reaffirming)
the tour part of finishing that change.

**Why this priority**: The request explicitly asks for this instrumentation, and it protects the
value of US1/US2 over time. It is P2 rather than P1 only because the tour must exist before there is
anything to keep current.

**Independent Test**: Make a change that should invalidate the tour — remove or rename the control a
tour step anchors to, or add a new first-class report kind the tour does not mention — and confirm
the check flags it and surfaces the required action. Make an unrelated change and confirm the check
stays quiet.

**Field Validation** *(deferred milestone — not a gate)*: Not applicable — this is a
maintainer-facing safeguard, validated by its test suite rather than by outdoor use. Its downstream
payoff shows up in US1/US2 field validation staying true over successive releases.

**Acceptance Scenarios**:

1. **Given** a tour step anchored to a specific control, **When** that control's stable anchor is
   removed or renamed, **Then** the check flags the tour as potentially stale and identifies the
   affected step.
2. **Given** a change that adds a new first-class report kind or primary control, **When** the tour
   does not cover it, **Then** the check flags that the tour may need a new or revised step.
3. **Given** a change that touches nothing the tour depends on, **When** the check runs, **Then** it
   does not flag the tour.
4. **Given** the check has flagged potential drift, **When** the person or agent making the change
   reviews it, **Then** the required action (update the tour, or explicitly reaffirm it is still
   correct) is stated clearly enough to act on without reading this spec.

---

### Edge Cases

- **Empty map / early hunt**: On a fresh hunt there may be no reports and therefore no credible
  region to point at. The estimate step MUST still convey the concept — via a representative sample
  or explanatory content — rather than highlighting nothing or breaking.
- **Fully offline for the whole tour**: A first-timer may be handed a phone at a trailhead with no
  signal. The tour MUST start, advance, and complete with no network, and MUST NOT lose or block
  reporting if connectivity never arrives.
- **Reconnect with a divergent log**: If reports sync in mid-tour, the tour MUST NOT be disrupted by
  the map updating underneath it, and MUST NOT depend on any particular report being present.
- **Poor report geometry**: When the live estimate is weak (<3 reports, narrow angular spread,
  multi-modal), the tour MUST show that weakness honestly at the estimate step, not hide it to look
  polished.
- **Stock-handheld-only participant**: Someone with no directional antenna MUST come away from the
  tour knowing they can contribute signal-strength and "I hear nothing here" reports — the tour MUST
  NOT read as "bearings only."
- **Small / mobile screens**: The overlay MUST keep the highlighted control visible and identifiable
  without fully covering it, at phone-sized viewports.
- **Skip, resume, replay**: A participant who exits partway MUST be able to get on with the hunt, and
  MUST be able to relaunch the tour later on demand. The tour MUST NOT re-offer itself unprompted on
  every visit once seen.
- **Relay mode present or absent**: Relay affordances are per-device and may be off. The tour MUST
  NOT assume relay mode is on; if it covers relay at all, it does so only when that affordance is
  present.

## Requirements *(mandatory)*

### Functional Requirements

**The tour experience**

- **FR-001**: The system MUST offer an optional guided tour to a first-time visitor, presented so it
  can be accepted or dismissed without blocking joining, reporting, or viewing the estimate.
- **FR-002**: The tour MUST be skippable and exitable at any step; declining or exiting MUST never
  gate any other function of the app (Constitution: Cost of entry).
- **FR-003**: The tour MUST be re-launchable on demand after the first visit, from a discoverable,
  persistent affordance, so it is not a one-time-only experience.
- **FR-004**: The tour MUST present its steps in a fixed, meaningful order, each step visually
  pointing to the specific control or field it describes.
- **FR-005**: The tour MUST let the participant move forward and backward between steps and MUST show
  progress (which step of how many).
- **FR-006**: Each step MUST keep its referenced control visible and identifiable on the current
  viewport, including phone-sized screens, without the overlay fully obscuring it.
- **FR-007**: The tour MUST walk the core hunt loop in order: how the participant reached this hunt
  and what they are hunting, reading the map and the current location estimate, and filing a report.
- **FR-008**: The tour MUST show all first-class ways to contribute — bearing, signal-strength, and
  "I hear nothing here" (negative) — not bearings alone, and MUST make explicit that a stock handheld
  with no directional antenna can contribute (Constitution: Every Radio Contributes).
- **FR-009**: The tour MUST point out the credible-region / uncertainty display and describe the
  estimate, in plain language, as a region that grows less certain with poor reports; it MUST NOT
  present the estimate as a precise point (Constitution: Honest Uncertainty).
- **FR-010**: The tour MUST include a step showing how to bring others into the hunt (share/invite)
  and MUST frame that joining requires no account, install, or payment.
- **FR-011**: All tour copy MUST use the language hunters speak (fox, bearing, null, S-meter, "I hear
  nothing here") and MUST NOT expose protocol jargon such as NRQ, DFS, or PHG (Constitution: Plain
  Language Over Jargon).
- **FR-012**: The tour MUST function with no network connection for its entire duration; starting,
  advancing, and completing it MUST NOT require a server round-trip (Constitution: Offline Is the
  Normal Case).
- **FR-013**: The system MUST remember, locally on the device, that the tour has been seen,
  completed, or declined, so it is not re-offered unprompted on every visit. This state MUST NOT
  depend on an account or a server. An increase in the tour's version MUST NOT, on its own,
  re-offer the tour to a device that already completed an earlier version; how a materially changed
  tour is re-surfaced is decided per-update and is out of scope for this feature. Returning
  participants reach the current tour through the relaunch affordance (FR-003).
- **FR-014**: When the surface a step points at is absent in the current state (e.g., no estimate yet
  on an empty map), the tour MUST still convey that step via a representative sample or explanatory
  content, rather than pointing at nothing or breaking.
- **FR-015**: On completion, the tour MUST leave the participant on a live, ready-to-use hunt view,
  primed to file their first real report — not on a dead-end or a modal they must escape.
- **FR-020**: The tour overlay MUST be operable without a pointer: the keyboard MUST advance, go
  back, and exit the tour; ESC and tapping the surrounding scrim MUST dismiss it; focus MUST move to
  the active step; the overlay MUST honor a reduced-motion preference; and each step's copy MUST be
  announced to assistive technology.
- **FR-021**: The guided walkthrough MUST be limited to the core contribute-and-share loop
  (join/target, map + estimate, the three report kinds, share) plus the relaunch affordance.
  Retract/correct, settings, and relay MUST NOT be steps in the first-visit tour; relay affordances
  are absent unless the per-device relay mode is on, and even then are out of scope for the tour.

**Keeping the tour current (maintainer-facing)**

- **FR-016**: Each tour step MUST anchor to its target control through a stable, explicit identifier,
  so UI changes can be mechanically checked against the tour.
- **FR-017**: The project MUST include an automated check, integrated into the Claude Code workflow,
  that flags when a change may have invalidated the tour — for example, a step's anchor is removed or
  renamed, or a new first-class report kind or primary control is introduced that the tour does not
  cover.
- **FR-018**: When the check flags potential drift, updating the tour — or explicitly reaffirming it
  is still correct — MUST be part of completing that change, and the check MUST state the required
  action clearly enough to act on without reading this spec.
- **FR-019**: The project MUST document what counts as a "significant change that may invalidate the
  tour" (at minimum: tour-step anchors, the set of first-class report kinds, the primary hunt-loop
  controls, and the ordered walkthrough itself), so the check's scope is understood and maintainable.

### Key Entities *(include if feature involves data)*

- **Tour**: An ordered sequence of steps that together walk the core hunt loop. Carries a version
  that records which tour a device saw; a version increase does not by itself re-offer the tour (see
  FR-013).
- **Tour Step**: A single stop — a stable anchor to one control or field, the plain-language copy that
  explains it, and optional sample/illustration content used when the live surface is not present.
- **Tour State (per device)**: Whether this device has seen, completed, or declined the tour, and
  which tour version — held locally, never tied to an account or server.
- **Tour Anchor**: The stable identifier that ties a step to its UI control and against which the
  staleness check runs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor can complete the full tour in under 3 minutes.
- **SC-002**: After completing the tour, at least 90% of new participants can, unaided, file each of
  the three report kinds (bearing, signal-strength, "I hear nothing here") and locate the
  uncertainty display, in a first-use test.
- **SC-003**: After completing the tour, a participant can correctly describe how to bring a teammate
  into the hunt and state that joining needs no account or install, in a comprehension check.
- **SC-004**: The tour starts, advances, and completes with the network disabled for 100% of its
  steps.
- **SC-005**: Declining or skipping the tour adds zero extra steps to joining and to filing a report,
  compared with the app when no tour exists.
- **SC-006**: The tour can be relaunched on demand at any time after the first visit.
- **SC-007**: In first-use testing, at least 80% of participants who complete the tour rate
  themselves ready and confident to use FoxMapper on a real hunt.
- **SC-008**: For a defined suite of tour-invalidating changes (removing or renaming a step anchor,
  adding a first-class report kind, adding or removing a primary hunt-loop control), the automated
  check flags the stale tour before the change is considered complete, with 100% detection and no
  false alarm on a matched suite of unrelated changes.

## Assumptions

- **First-time** means this device holds no record of the tour. The tour is offered the first time
  the participant reaches a hunt view — where the buttons and fields actually live — and describes how
  they got there as its opening step. It is not shown mid-hunt to returning participants. (Aligns with
  Constitution: Offline Is the Normal Case and Cost of entry — no account, all state device-local.)
- The estimate/uncertainty step falls back to a lightweight scripted sample when the live map has too
  few reports to show a credible region, so the concept is always demonstrable, including offline and
  on a brand-new hunt.
- The share/invite affordance the "introduce a team" step points at already exists in the client; the
  tour points at it rather than inventing a new sharing mechanism.
- The tour targets the existing single-page web client and adds no backend; all tour logic and state
  are client-side, consistent with the server having no opinion about the hunt.
- There is no account or login to attach tour state to; state is per-device by design, which also
  keeps cost of entry at zero.
- The exact form of the Claude Code instrumentation (a hook, a lint/test rule, a skill, or a
  combination) is a plan-phase decision. This spec fixes only the behavior: stable anchors, an
  automated drift check in the Claude Code workflow, a clear required action, and documented scope.
- Wording and sequencing of individual steps will be refined during design and usability testing; the
  spec fixes the surfaces that MUST be covered and their order, not the final copy.
