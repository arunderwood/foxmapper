# Feature Specification: True North Bearings Without Declination Math

**Feature Branch**: `claude/foxmapper-magnetic-true-north-be10be`

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "I've gotten a lot of feedback that the way FoxMapper handles magnetic
vs true north is confusing. For example, the included screenshot shows a bearing reported at zero
degrees. Most people would expect a bearing of zero to report straight north. The mapping needs to
show true north. At the same time it needs to automatically account for whichever system the device
compass is reporting in, true north or magnetic. Additionally, a hunter reporting a bearing to net
control may do so from a magnetic compass. In those situations, the net control must be able to
input that bearing accurately without needing to do their own declination math. Overall, a user
shouldn't have to think about the difference between true and magnetic north unless they want to,
or they are performing an action where the difference may impact the accuracy of the bearing they
are entering. Although I have not explored the app CalTopo, some of the users who have provided
feedback have indicated that it handles this issue well."

## The Problem Today

The map already renders bearing wedges relative to true north, and the log already records both the
magnetic and true value of every bearing. The confusion comes from the seam between entry and
display: the number a reporter sees while taking a bearing is a **magnetic** heading, the wedge that
appears on the map is drawn at the **true** heading, and neither number is labeled with its
reference. In the reported screenshot, a bearing entered as "0" was rendered roughly 15° east of map
north — correct conversion, invisible reasoning. The user experienced it as "I said north and the
app drew not-north."

CalTopo, cited by users as the model to follow, resolves the same tension by three habits: the map
is always true-north based, every displayed bearing carries its reference label, and declination is
computed automatically from location so the user chooses a reference only at the moments where the
choice affects accuracy. This spec adopts the same posture.

## Clarifications

### Session 2026-08-07

- Q: How should bearing headings be displayed in default flows (dial during drafting, map, report
  details)? → A: Always true north, with a visible "true" label; magnetic appears only in manual
  entry (when chosen) and the on-demand detail view. No display-reference setting.
- Q: When a bearing is hand-entered (typed or dictated over the radio, not drafted from the
  compass), which north reference should be pre-selected? → A: Magnetic, always — not sticky, not
  forced-choice. One tap switches to true; the label and the true-equivalent preview make the
  active choice obvious.
- Q: How does the manual-entry reference switch communicate its effect? → A: The switch itself
  shows the converted number the user would be switching to (e.g. while entering 220° magnetic
  where declination is +15°, the switch reads "235° true"), so the consequence of switching is
  visible before it is taken.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Number You See Is the Direction You Get (Priority: P1)

A hunter takes a bearing on the fox — by pointing the phone, or by twisting the dial by hand. From
the moment a heading is shown to the moment the wedge lands on the map, the number displayed, its
reference label, and the direction drawn are one consistent fact. A heading shown as due north draws
a wedge at map north. The device compass's own reference (magnetic on today's phones, but whatever
it reports) is detected and normalized silently; the hunter never sees or performs a conversion.

**Why this priority**: This is the reported confusion. Every bearing entry currently crosses a
silent ~15° discontinuity between the entry surface and the map, and users interpret the correct
wedge as a wrong one. Fixing the seam restores trust in every wedge already on the map.

**Independent Test**: Can be fully tested by simulating a device compass heading in a location with
known declination, drafting a bearing, and confirming the on-screen heading, its label, and the
rendered wedge centerline all describe the same physical direction — with no other story built.

**Field Validation** *(deferred milestone — not a gate)*: A hunter on a real hunt points the phone
down a road they can see on the map, submits the bearing, and the wedge lies along that road. The
observation that proves it: nobody at the tailgate asks "why is my bearing crooked?"

**Acceptance Scenarios**:

1. **Given** a location where declination is +15° east and a device compass reporting magnetic
   headings, **When** the reporter points the device at true north and drafts a bearing, **Then**
   the heading displayed during entry reads 0° labeled as true north, and the submitted wedge
   centerline points at map north.
2. **Given** a reporter hand-adjusts the dial until it reads due north, **When** they submit,
   **Then** the wedge renders straight up on a north-up map.
3. **Given** any surface that displays a bearing number (entry dial, map, report details),
   **When** a heading is shown, **Then** its north reference is visible alongside the number in
   plain hunter language, not protocol jargon.
4. **Given** a device compass that reports true headings rather than magnetic, **When** a bearing
   is drafted from it, **Then** no correction is applied twice and the wedge is still correct.

---

### User Story 2 - Net Control Enters a Relayed Magnetic Bearing (Priority: P2)

A hunter calls in over the radio: "I'm at the fairgrounds, fox bears 220 magnetic." Net control
enters the bearing by hand, marks it as a magnetic compass reading, and sets where the hunter was
standing. The system converts to true using the declination at the *hunter's* position — not net
control's — and the wedge lands exactly where that hunter's compass pointed. Nobody adds or
subtracts anything.

**Why this priority**: Relayed bearings from physical compasses are a core net-control workflow, and
today the only way to enter one accurately is to do declination arithmetic in your head — the exact
failure the feature exists to remove. It is P2 only because it depends on the reference labeling and
conversion behavior established in Story 1.

**Independent Test**: Can be fully tested by entering a known magnetic bearing at a position with
known declination and confirming the stored true heading and rendered wedge are offset by exactly
that declination — without the on-demand detail surface of Story 3.

**Field Validation** *(deferred milestone — not a gate)*: During a real hunt, net control logs a
bearing relayed by a hunter using a baseplate compass, and the hunter later confirms the wedge on
the shared map lies along the direction they sighted. The observation that proves it: the relayed
wedge agrees with the hunter's own device-drafted bearings from the same spot.

**Acceptance Scenarios**:

1. **Given** manual bearing entry, **When** the user enters a number, **Then** the active north
   reference (true or magnetic) is unmistakable at the point of entry and can be switched in one
   action — and the switch control itself shows the converted number it would switch to (entering
   220° magnetic where declination is +15°, the switch reads "235° true").
2. **Given** a bearing entered as 220° magnetic at a position where declination is +15°, **When**
   it is submitted, **Then** the wedge centerline renders at 235° true and the stored report
   carries both values.
3. **Given** net control in one city entering a bearing taken by a hunter in another, **When** the
   bearing's origin is set to the hunter's position, **Then** the conversion uses declination at
   the hunter's position, not the device operator's.
4. **Given** a bearing entered with the wrong reference and then noticed, **When** the user
   corrects it, **Then** the correction is a new fact superseding the old report, consistent with
   the append-only log.

---

### User Story 3 - See the Difference When You Want To (Priority: P3)

A curious or careful user — a ham who owns a baseplate compass, a net control sanity-checking a
strange wedge — can look up what the app knows: the local declination (how far and which way
magnetic north is off true north here), and any bearing expressed in both references. When the
magnetic model behind the conversion is out of date, that is said plainly there too. None of this
is in the way of anyone who never asks.

**Why this priority**: This is the "unless they want to" clause. It builds trust and aids debugging
odd bearings, but no core reporting or mapping flow depends on it.

**Independent Test**: Can be fully tested by opening the declination detail from the hunt screen and
verifying the displayed offset matches the published declination for the current position and date.

**Field Validation** *(deferred milestone — not a gate)*: A hunter cross-checks the app's stated
declination against the value printed on a local topo map or their compass's set declination, and
they agree. The observation that proves it: an experienced ham stops distrusting the wedges.

**Acceptance Scenarios**:

1. **Given** a user on the hunt screen, **When** they seek the declination detail, **Then** they
   find the local declination as a value and direction in plain language (e.g. "magnetic north is
   about 15° east of true north here") within a couple of taps.
2. **Given** a recorded bearing viewed in detail, **When** the user inspects it, **Then** both its
   true and magnetic values are shown, each labeled.
3. **Given** the magnetic model is past its validity window, **When** declination details are
   shown, **Then** the value is still presented and plainly marked as out of date — not hidden,
   not refused.

---

### Edge Cases

- **Declination near zero** (agonic regions): the true/magnetic choice changes nothing visible.
  Labels still appear, conversion still runs, and no confusing "0° correction" ceremony is added.
- **Magnetic model out of validity**: bearings are still converted and rendered using the nearest
  model, and the staleness is stated wherever declination detail is shown. A refused bearing would
  be a larger error than a fraction-of-a-degree drift.
- **No network for the whole hunt**: declination comes from an on-device model; every conversion,
  label, and detail surface works offline. On reconnect, merged logs need no reconciliation —
  every bearing report carries its own conversion facts, so two clients render it identically.
- **Poor report geometry** (<3 reports, narrow spread, multi-modal posterior): unchanged by this
  feature. Reference labeling must not make a weak estimate look stronger — labels state reference,
  never imply sub-degree precision the inputs don't support.
- **Stock-handheld participant** (signal-strength and "nothing here" reports only): their reports
  carry no heading and are untouched. They still benefit: the wedges they see from others now match
  the numbers those others called out on the air.
- **Device compass wildly wrong** (near a vehicle, an antenna): unchanged — the reporter sees the
  drafted heading and can adjust before submitting. Reference normalization neither hides nor
  worsens sensor error.
- **Wrong reference chosen at entry**: the mistake is visible before submitting (both values and a
  live preview of where the bearing points), and after submitting it is correctable only by
  supersession, never by mutating the logged report.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All map rendering of bearings MUST be referenced to true north. A bearing whose
  displayed value is due north in the true reference MUST render at map north.
- **FR-002**: Every displayed heading number — during entry, on the map, and in report detail —
  MUST carry a visible north-reference label in plain hunter language ("true" / "magnetic").
  Default flows display headings in **true north only**; magnetic values appear solely in manual
  entry (when that reference is chosen) and in the on-demand detail view. There is no
  display-reference preference setting.
- **FR-003**: The heading shown to a user at entry time and the wedge subsequently rendered MUST
  describe the same physical direction; no silent reference change may occur between entry and
  display.
- **FR-004**: Headings drafted from the device compass MUST be normalized to true north
  automatically, accounting for whichever reference the device reports in, and MUST NOT apply a
  correction twice when the device already reports true headings. The reporter performs no
  conversion step.
- **FR-005**: Manual bearing entry MUST let the user state which reference their number is in,
  switchable in a single action, with the active reference unmistakable at the point of entry. The
  same physical direction MUST result regardless of which reference is used to express it.
  Typed/relayed entry MUST default to **magnetic** (a dictated bearing almost always comes from a
  physical compass); the default is fixed, not remembered per session. This applies to any number
  typed while no bearing value is committed — including in the compass-drafting sheet — while
  adjusting an already-drafted value keeps that value's reference (a compass-drafted heading stays
  true through edits). The reference switch itself
  MUST show the converted number the user would be switching to — not a bare "true"/"magnetic"
  toggle — so the effect of switching is visible before the tap and the true-north equivalent is
  always visible before submitting.
- **FR-006**: Reference conversion MUST use the declination at the bearing's origin position and
  the current date — the position the bearing was taken from, which for relayed bearings is the
  reporting hunter's stated position, not the device operator's.
- **FR-007**: All conversion, labeling, and declination detail MUST function with no network
  connection for the duration of a hunt.
- **FR-008**: Every recorded bearing MUST carry both its true and magnetic values and the
  conversion facts that relate them (declination applied, model vintage, origin position), so the
  report remains reinterpretable and renders identically on every client.
- **FR-009**: When the magnetic model is outside its validity window, the system MUST still convert
  and render bearings using the nearest available model, and MUST state the staleness wherever
  declination detail is shown.
- **FR-010**: Users MUST be able to view, on demand, the local declination (magnitude and
  direction, in plain language) and both representations of any recorded bearing. This detail MUST
  NOT be required by, or interrupt, any core reporting or viewing flow.
- **FR-011**: No default flow — drafting from the compass, viewing the map, reading a wedge — may
  require the user to make a north-reference decision. The only place the choice appears is manual
  entry, where the reference genuinely affects accuracy.
- **FR-012**: Participant-facing surfaces MUST use the words hunters use ("true north",
  "magnetic"); model and protocol vocabulary (geomagnetic model names, epoch identifiers) MAY
  appear only inside the on-demand detail, phrased plainly (e.g. "using the 2025 magnetic model").

### Key Entities

- **Bearing report**: an immutable logged fact carrying a heading expressed in both references
  (true and magnetic), the conversion facts relating them (declination, model vintage), an origin
  position, confidence, and range. Already exists; this feature constrains how it is entered and
  displayed, not what it stores.
- **North reference**: the frame a heading number is expressed in — true north or magnetic north.
  A property of every *displayed or entered* number, never a property of the physical direction
  itself.
- **Declination**: the signed angular offset between magnetic and true north at a given position
  and date, derived from an on-device magnetic model; carries a staleness state when the model is
  past its validity window.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On every surface, a displayed heading, its reference label, and the rendered
  direction agree — 100% of bearing displays, verified across entry, map, and detail views. A
  bearing displayed as 0° true renders at map north.
- **SC-002**: Net control can log a relayed magnetic-compass bearing performing zero arithmetic,
  and the resulting wedge centerline is within 1° of the correct true bearing anywhere within the
  magnetic model's coverage.
- **SC-003**: Drafting a bearing from the device compass involves zero user decisions about north
  reference, and manual entry involves exactly one — a single visible switch, never a calculation.
- **SC-004**: In the next round of user feedback after release, reports of "the bearing points the
  wrong way" / "zero isn't north" drop to zero (qualitative until a field-tester base exists).
- **SC-005**: A user who wants the local declination can find it from the hunt screen in under 15
  seconds, and its value matches published declination for their position and date.

## Assumptions

- The map is rendered north-up with map-north = true north; this feature adds no magnetic-north
  map orientation mode. (CalTopo's own community reports the magnetic map-reference mode as its
  confusing corner; FoxMapper omits it.)
- Web platform compasses today report magnetic headings; FR-004's "whichever reference the device
  reports" is stated so behavior stays correct if a platform ever supplies true headings.
- A heading set by adjusting the dial follows the surface's active reference: in compass-drafting
  flows that is true north (per the clarified FR-002), so twist-to-aim needs no reference decision
  at all, while in manual-entry flows (typed or relayed, where no compass drafted the number) the
  active reference starts at the clarified magnetic default and the adjustment follows it.
- A bearing's origin position is already captured with every report (the reporter's fix or a
  hand-set position), so declination is always computable at entry time; no network is assumed
  (constitution, Principle III).
- The existing log format already records both headings plus declination and model vintage; this
  feature is expected to require no log-format change, only entry and display behavior.
- Participants have no training on declination and should never need any; the words "true" and
  "magnetic" are assumed within hunter vocabulary, while "declination" appears only inside the
  on-demand detail with its meaning stated in plain words.
