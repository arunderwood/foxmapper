# Feature Specification: Visual Compass Dial for Bearing Entry

**Feature Branch**: `compass-bearing-spec-cee38f`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "A more visual compass-like experience for taking a bearing reading from
the device compass. Today it is just a number that rapidly changes as the device moves. A user
should recognize the experience as being similar to a physical compass. Within the bearing menu it
should be intuitive to start the compass and freeze it when the device is pointed correctly. When the
bearing is frozen it should be possible to twist the on-screen compass dial, either to input a custom
bearing or to correct one when the reading is off. Even for devices without a compass, a user should
be able to use the compass dial experience to set a bearing."

## Clarifications

### Session 2026-07-17

- Q: When Bearing entry opens, what does the compass dial start as? → A: Unset — no submittable
  bearing until the hunter freezes a live reading or twists the dial, and Send stays disabled until
  then. Preserves feature 001's rule that no due-north bearing is filed by default.
- Q: How should the dial represent and set the bearing? → A: A rotating rose under a fixed top index.
  Live, the rose tracks the device; frozen or on a no-compass device, the hunter twists the rose. The
  bearing is read under a fixed marker at the top of the dial ("toward the fox").
- Q: How does the live compass begin on a device that has one? → A: Auto-start where the platform
  allows it — the live compass begins when Bearing entry opens on a platform that needs no permission
  gesture (e.g. Android); where a permission gesture is required (as on iOS), the hunter starts it
  with one explicit tap.
- Q: For someone who cannot perform the twist gesture, what is the non-gesture way to set a bearing? →
  A: The always-visible numeric field, read and typed as the exact bearing. The dial is a progressive
  enhancement and need not itself be keyboard- or assistive-technology-operable.

## User Scenarios & Testing *(mandatory)*

This feature changes **how a bearing is set** inside the existing Bearing report. It adds no report
kind and no field. What changes is the control that produces the heading — from a bare number that
jumps as the phone moves into an instrument a hunter recognizes — and, with it, one simplification to
the log: **a bearing is a bearing, and the log stops recording where the number came from.** The
compass-versus-hand distinction the log carries today is written but never read — no rendering uses
it and the on-air mapping ignores it — so this feature drops it. Confidence and range are untouched;
everything the map draws and everything that goes on the air is identical to a bearing entered today
(Principle IV, Principle V) — see Key Entities.

### User Story 1 - Start and freeze a live compass (Priority: P1)

A hunter opens the Bearing entry, points the phone at where the signal is coming from, and watches a
compass dial — a rose with north, the cardinal points, and degree ticks — turn as they turn, the way
the card of a real compass swings and settles. It reads like an instrument, not a flickering number:
damped enough to be legible while the phone is in motion. When the phone is lined up on the fox, the
hunter freezes the reading with one tap. The dial holds still at the captured bearing, visibly
frozen, and that is the heading the report will carry unless the hunter changes it. If they froze too
early or lined up wrong, they can go live again and re-take it.

**Why this priority**: This is the whole complaint, reduced to its smallest fix. The rapidly-changing
number is unreadable in exactly the moment it matters — outdoors, one-handed, sighting down an
antenna. A damped dial you can start and freeze is recognizable, readable, and captures the reading
at a moment the hunter chose. Everything else in this feature layers onto it. The existing editable
readout stays available for correction, so this story ships without removing any way to fix a bad
draft (feature 001's FR-008b is not regressed).

**Independent Test**: With a device that reports orientation, open Bearing entry, start the compass,
rotate the device, and confirm the dial tracks the device and stays legible while moving. Freeze it
and confirm the dial holds a stable value, the report carries that magnetic heading, and the reporter
saw it before it was sent. Delivers value on its own: a readable, capturable compass in place of a
jittering number.

**Field Validation** *(deferred milestone — not a gate)*: At a real hunt, a hunter sighting a bearing
off a handheld or a yagi starts the dial, points, and freezes without being told how — and afterwards
says the on-screen dial behaved enough like their compass that they trusted the frozen number. It
survived contact if a hunter who owns a physical compass reaches for the freeze at the right moment
unprompted. It did not survive if anyone said the dial was harder to read than the old number, or
froze the wrong value because the live dial was too twitchy to time.

**Acceptance Scenarios**:

1. **Given** a device that reports its orientation, **When** Bearing entry opens (live automatically
   where the platform needs no permission) or the hunter starts the compass (where a permission
   gesture is required), **Then** the rose rotates in step with the device, the fixed top index reads
   the heading, and the dial remains legible — damped like a settling compass card, not redrawn on
   every raw sensor tick.
2. **Given** the compass is live, **When** the hunter freezes it while pointed at the fox, **Then**
   the rose stops tracking the device, holds the captured magnetic heading under the index, is visibly
   in a frozen state, and that heading becomes the report's draft.
3. **Given** Bearing entry has just opened and the hunter has neither frozen nor twisted, **When**
   they look at the controls, **Then** no bearing is committed and Send is disabled — a live rose
   streaming under the index offers no due-north default to submit (FR-003a).
4. **Given** a frozen bearing, **When** the hunter chooses to go live again, **Then** the dial
   resumes tracking the device and no earlier frozen value is submitted behind their back.
5. **Given** a live or frozen dial, **When** the reporter reads it, **Then** it shows a heading
   relative to north with cardinal marks — the magnetic heading — and never asks the reporter to
   convert to true north themselves (feature 001's FR-009 true-north handling is unchanged).
6. **Given** the hunter has frozen a bearing, **When** they submit, **Then** the report carries the
   heading they saw on the dial and nothing they did not see (feature 001's FR-008b).

---

### User Story 2 - Twist a frozen dial to correct or customize (Priority: P2)

The frozen reading is close but a few degrees off — the phone was near the car, or the hunter knows
the fox is a touch left of where the reading settled. Rather than reaching for a number pad, they put
a finger on the dial and twist it, the way you rotate a compass housing, until the bearing reads
right. The heading follows the twist in real time. They can also ignore the sensor entirely and dial
in a bearing they already know. A twisted bearing is just a bearing: the log records the number, not
that a finger moved it.

**Why this priority**: Correcting a drafted heading is already required (feature 001's FR-008b), and today it means
typing. Direct manipulation of the dial is the natural gesture once a dial exists: it keeps the
hunter's eyes on the instrument and their hand on the screen, and it makes "the compass is lying,
nudge it" a two-second motion instead of a keyboard trip. It rides on Story 1's dial, so it is
genuinely second: the freeze is worth shipping before the twist, because the editable readout already
covers correction in the meantime.

**Independent Test**: Freeze (or, on any device, take) a bearing, drag the dial by a known amount, and
confirm the displayed and recorded heading moved by that amount. Confirm a bearing can be dialed in
from scratch with no reliance on the number pad, and that a twisted bearing is recorded no differently
from a typed one.

**Field Validation** *(deferred milestone — not a gate)*: At a real hunt, a hunter whose phone reads
badly next to a vehicle freezes, sees the bearing is wrong, and twists it onto the correct line
without complaint — and can say afterwards that correcting it felt like adjusting a compass, not
fighting a form. It did not survive if hunters left obviously-wrong frozen headings uncorrected
because the twist was too fiddly to land, or fell back to typing every time.

**Acceptance Scenarios**:

1. **Given** a frozen bearing, **When** the hunter twists the dial, **Then** the displayed heading
   tracks the twist in real time and the compass stops taking sensor updates (the human has taken
   over).
2. **Given** a bearing that started as a live compass reading, **When** the hunter twists it at all,
   **Then** the submitted bearing is the twisted value and is recorded no differently from any other
   bearing — the log does not note that it began as a sensor reading or that a hand adjusted it.
3. **Given** a hunter who wants a specific bearing, **When** they twist the dial to it without ever
   going live, **Then** they can set and submit that bearing using the dial alone.
4. **Given** a coarse or gloved touch, **When** the hunter twists, **Then** they can still land on an
   intended heading — the gesture is forgiving enough to hit a bearing one-handed, and a non-drag way
   to set the exact number remains available (FR-006 budget, SC-001a).

---

### User Story 3 - The dial as the by-hand entry method (Priority: P3)

A phone with no compass — or held next to a yagi where the compass is useless — gets the same dial.
There is no live mode to start; the hunter simply twists the dial to the bearing and submits, and the
experience is the compass dial, not a lone text box. The same by-hand dial serves net control
entering a bearing an operator called over voice: there is nothing to point at the fox, so the
operator dials in the number they were given.

**Why this priority**: Every device deserves the recognizable control, not just the ones with a
magnetometer, and Principle II's "every radio contributes" extends to "every phone gets the same
tool." But a phone with no compass already has a working by-hand path today (the editable readout), so
bringing the full dial to it is the enhancement that lands last. It reuses Story 2's twist entirely —
a no-compass device is just a frozen dial that was never live.

**Independent Test**: With orientation events unavailable, open Bearing entry and confirm the dial is
offered with no dead "start the compass" affordance, that a bearing can be set purely by twisting, and
that the submitted report is indistinguishable in the log from a bearing typed today. Confirm the
relay/by-voice entry path presents the same by-hand dial and no live compass.

**Field Validation** *(deferred milestone — not a gate)*: At a real hunt, a participant on a phone
with no compass, and a net-control operator entering voiced bearings, both set headings on the dial
without a numeric keyboard and without being shown how. It did not survive if either fell back to
typing because the dial was slower than the number they already knew.

**Acceptance Scenarios**:

1. **Given** a device that reports no orientation, **When** the hunter opens Bearing entry, **Then**
   the dial is present, there is no start-the-compass affordance that cannot do anything, and the
   hunter can set a bearing by twisting.
2. **Given** a bearing set entirely by twisting, **When** it is submitted, **Then** the report is
   identical in the log to a bearing typed by hand today — a bearing, with no note of how it was set.
3. **Given** net control entering a bearing called over voice, **When** they open the bearing control
   for that relay, **Then** they get the by-hand dial and no live compass, because there is nothing
   to point at the fox.

---

### Edge Cases

- **A compass that is lying**: A phone next to a car, a handheld, or a yagi can read 10–30° off. The
  live dial shows the bad reading; the hunter freezes and twists it onto the right line, and the
  report carries the corrected bearing (Story 2). No heading is submitted that the reporter did not
  see and vouch for — the same honesty guarantee feature 001's FR-008b already gives, now expressed through the
  dial. The log records the bearing they sent, not that they corrected it.
- **No compass at all**: No live mode, no dead button pretending there is one; the dial is set by
  twisting (Story 3). The phone with no magnetometer and the phone whose magnetometer is being ignored
  take the same by-hand path — the interface does not make the hunter diagnose which they have.
- **Froze too early**: A hunter who captures the wrong moment goes live again and re-takes, or twists
  the frozen value into place. A freeze is never final until the report is sent.
- **Opened but nothing set**: A hunter who opens Bearing entry and neither freezes nor twists has
  committed no bearing; Send is disabled and there is no due-north default waiting to be submitted
  (FR-003a). On a compass device the rose may be streaming live under the index, but a live stream is
  not a submittable value until it is frozen.
- **Permission denied or unavailable**: On a platform that gates the compass behind a permission
  prompt, a refusal drops the hunter to the by-hand dial rather than blocking the report — the same
  fallback as today, now landing on the dial instead of a bare number.
- **Landscape / device held sideways**: The dial reads a correct heading regardless of how the phone
  is held, on the same basis the raw reading is corrected for screen orientation today. A hunter
  sighting along a horizontal antenna is a normal case, not an error.
- **Reduced motion**: A hunter who has asked their device to reduce motion still gets a working live
  compass — the dial's rotation is the reading, not decoration — but any non-essential animated
  flourish (a settle bounce, a freeze pulse) is dropped. The functional content survives; the garnish
  does not.
- **Twitchy sensor**: Raw orientation jumps around, which is the entire reason the old number was
  unreadable. The live dial is damped so it reads like a settling card; the freeze captures a settled
  value, not whichever raw sample happened to land on the tap.
- **Twist versus scroll**: Twisting the dial must not be swallowed by the entry sheet scrolling, and
  scrolling the sheet must not spin the dial. The gesture that spins the compass and the gesture that
  moves the sheet are distinct, so neither steals the other.
- **Magnetic, not true**: The dial is a magnetic instrument, like a real compass. It never shows a
  declination bezel and never asks the hunter to correct for declination — the system still converts
  to true north and records both, invisibly (feature 001's FR-009, unchanged). Adding a declination
  adjustment to the dial is a non-goal (FR-016).
- **Very high or very low latitudes / near a magnetic anomaly**: The dial shows whatever the device
  reports, however poor. It does not invent a steadiness the sensor does not have; the freeze-and-twist
  path exists precisely so a hunter can override a reading the environment has spoiled.
- **Accessibility without the gesture**: A twist is a fine-motor drag. A hunter who cannot perform it
  — coarse motor control, assistive tech, a screen reader — must still be able to set and read an
  exact bearing without dragging. The dial is an enhancement over an accessible numeric value, never
  a replacement that locks anyone out.

## Requirements *(mandatory)*

### Functional Requirements

**The dial as an instrument**

- **FR-001**: Bearing entry MUST present the heading as a compass dial — a rotating rose showing
  north, the cardinal points, and degree graduations, read under a fixed index at the top of the dial
  ("toward the fox") — that a hunter familiar with a physical compass recognizes as one, in place of a
  bare changing number as the primary control. The current bearing is the value under the fixed index.
- **FR-002**: The dial MUST show the heading relative to north as a magnetic heading, and MUST NOT
  ask the reporter to convert to or reason about true north. The system's existing true-north
  conversion and dual recording (FR-009 of feature 001) MUST remain unchanged and invisible.
- **FR-003**: A numeric heading value MUST remain visible alongside the dial and MUST remain a way to
  read and set the exact bearing, so that the exact number is never hidden and the dial is never the
  only way to set a heading (accessibility; SC-001a's one-handed budget).
- **FR-003a**: The dial MUST open with no submittable bearing. A value the report can carry exists
  only once the hunter freezes a live reading or twists the dial, and Send MUST stay disabled until
  then. The dial MUST NOT offer north — or any other heading — as a submittable default, so no bearing
  is filed that the hunter did not set (feature 001's no-default-heading rule, FR-006c of 001). A live
  compass streaming under the fixed index is not yet a submittable value; only a freeze or a twist
  commits one.

**Live and frozen (compass devices)**

- **FR-004**: On a device that reports orientation, the live compass MUST begin automatically when
  Bearing entry opens where the platform requires no permission gesture (e.g. Android); where a
  permission gesture is required (as on iOS), the reporter MUST be able to start it with one explicit
  action. Once live, the rose rotates in step with the device and the fixed top index reads the
  heading the device is pointed at.
- **FR-005**: The live dial MUST be visually damped so that it reads like a settling compass card
  rather than a number redrawn on every raw sensor sample. It MUST remain legible while the device is
  in motion — the readability the old bare-number readout lacked is the point of this feature.
- **FR-006**: The reporter MUST be able to freeze the live dial in one action, capturing the current
  heading as the report's draft. A frozen dial MUST hold still and MUST be visibly distinct from a
  live one, so the reporter can tell a captured reading from a moving one at a glance.
- **FR-007**: The reporter MUST be able to leave the frozen state and go live again to re-take a
  reading. A frozen value MUST NOT be submitted without the reporter's explicit send; freezing drafts,
  it does not report.

**Twist to correct or customize**

- **FR-008**: The reporter MUST be able to twist the rose directly — rotating it under the fixed top
  index — to change the heading, with the bearing under the index following the twist in real time,
  both to correct a frozen reading and to set a bearing from scratch.
- **FR-009**: Twisting the dial MUST take the reporter's hand over from the sensor: once twisted, the
  compass MUST stop applying sensor updates to the drafted heading, so a live reading cannot silently
  overwrite a value the reporter has just set. This is a UX guarantee about which value is sent, not a
  fact the log records.
- **FR-010**: The log MUST NOT record where a bearing came from. A bearing frozen from the compass,
  one twisted onto the dial, and one typed in are the same fact — a bearing the reporter vouched for —
  and MUST be indistinguishable in the log. This removes the heading-source and sensor-accuracy fields
  the bearing report carries today, which are written but never read: no rendering consults them and
  the on-air mapping does not carry them.

**Every device**

- **FR-011**: A device that cannot report orientation MUST still present the dial, set entirely by
  twisting, with no live-compass affordance that cannot function. The by-hand dial MUST be the same
  instrument as the frozen dial on a compass device.
- **FR-012**: The by-hand dial MUST be available on the relay/by-voice entry path, where there is
  nothing to point at the fox, and MUST NOT offer a live compass there.
- **FR-013**: The reporter MUST be able to set and submit a bearing without a physical or on-screen
  keyboard, using the dial alone — while the numeric value (FR-003) remains available for those who
  prefer or require it.

**What does not change**

- **FR-014**: The recorded bearing report MUST be unchanged by this feature except for shedding the
  unused heading-source and sensor-accuracy fields (FR-010). Every field the map draws or the on-air
  mapping carries — the magnetic and true headings, the declination and model epoch, the stated
  confidence and range — MUST be identical to a bearing entered today, and the on-air mapping
  (Principle V) is untouched because it never carried the dropped fields. A bearing set on the dial
  MUST round-trip identically to one typed by hand.
- **FR-015**: Stated confidence and stated range MUST remain required and unchanged (FR-006/FR-006a/
  FR-006c of feature 001). This feature changes only how the heading is set, not what else a bearing
  report must carry.
- **FR-016**: The dial MUST NOT introduce a declination adjustment, a true-north bezel, or any control
  that asks the hunter to reason about the magnetic model. Declination stays a system concern
  (FR-002).
- **FR-017**: The feature MUST require no network: the compass, the dial, the freeze, and the twist
  MUST all work with no connectivity, for the duration of a hunt (Principle III). It introduces no
  server round-trip.

**Accessibility and interaction**

- **FR-018**: The bearing set on the dial MUST be readable and settable by a participant who cannot
  perform a twist gesture — via the numeric value (FR-003) and standard input semantics — so the dial
  enhances rather than gates bearing entry. The always-visible numeric field is the accessible path;
  the dial itself need not be operable by keyboard or assistive technology.
- **FR-019**: The twist gesture and the entry sheet's own scrolling MUST NOT capture each other: the
  reporter can spin the dial without scrolling the sheet, and scroll the sheet without spinning the
  dial.
- **FR-020**: Under a reduced-motion preference, the live dial MUST still function as the reading,
  while non-essential animation (settle, freeze flourish) is dropped.

### Key Entities *(include if feature involves data)*

This feature **adds no persisted entity** and, other than dropping two unused fields (FR-010),
changes no stored value. The honest fact the log records about a bearing is a bearing — the direction,
and nothing about how the number was arrived at.

- **Bearing report** *(one field group removed)*: Carries a magnetic heading, a true heading, the
  declination and model epoch, and the stated confidence and range — all unchanged. It no longer
  carries a heading source or a sensor-accuracy figure: those recorded where the number came from, and
  a bearing is a bearing regardless. Dropping them is safe because nothing consumed them — no rendering
  and no on-air mapping — so no participant-facing behaviour changes.
- **Dial interaction state** *(ephemeral, never persisted)*: Live (tracking the device), frozen
  (holding a captured heading), or by-hand (set by twisting, never live). These describe the control
  in the moment of entry and leave no trace in the log — only the resulting bearing does.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A hunter can start the compass, point, freeze, and submit a bearing in under 10 seconds,
  one-handed, outdoors, on a screen they can barely see — the same budget the bearing report has held
  since feature 001 (SC-001a), not loosened by the richer control.
- **SC-002**: Once frozen, the displayed bearing is stable: it does not change on its own, so the
  value the reporter reads at freeze is the value that is sent (0 sensor-driven changes to a frozen
  heading).
- **SC-003**: A hunter who owns a physical compass recognizes the on-screen control as a compass and
  finds the freeze without instruction — measured by field observation of unprompted use.
- **SC-004**: A hunter can correct a frozen bearing onto an intended heading by twisting, landing
  within a few degrees one-handed, without opening a keyboard — measured in test and in the field.
- **SC-005**: A device with no compass can set and submit a bearing using the dial alone, with 0
  keystrokes required.
- **SC-006**: A bearing is recorded the same way no matter how it was set: a frozen reading, a
  twisted one, and a typed one produce byte-identical bearing reports (aside from the heading value
  itself), and the log carries no field naming their source. Verified mechanically.
- **SC-007**: 0 headings are recorded that the reporter did not see before submission — the frozen or
  twisted value on the dial is always what is sent (carries SC-010 of feature 001 forward through the
  new control).
- **SC-008**: The only change to the recorded bearing schema is the removal of the unused heading-
  source and sensor-accuracy fields; every remaining field round-trips losslessly and maps to the
  on-air formats exactly as before, which is unaffected because it never carried the removed fields
  (Principle IV, Principle V).
- **SC-009**: The bearing dial functions end-to-end with no network connection, verified with
  connectivity disabled for an entire entry.
- **SC-010**: A participant who cannot perform the twist gesture can still read and set an exact
  bearing, verified against the numeric value and standard input semantics — the dial locks no one
  out.

## Assumptions

- **A bearing is a bearing; the log records no provenance.** The bearing report carries a heading
  source (`compass` / `manual`) and a sensor-accuracy figure today. Neither is read anywhere — no
  rendering branches on them and the on-air mapping does not carry them — and the freeze-and-twist
  interaction blends sensor and hand so thoroughly that the distinction stops meaning anything. So the
  log stops recording where a bearing came from and these two fields are removed (FR-010). The honesty
  the product needs lives in the *interaction* — the reporter always sees and vouches for the number
  before it is sent (feature 001's FR-008b, SC-007) — not in a source label after the fact.
- **This edits the living log-format documentation, not the closed feature-001 spec.** The bearing
  payload is documented in `docs/log-format.md` and its contract; those are updated to drop the two
  fields. Feature 001's spec and data-model are historical record and stay as written (the constitution
  does not rewrite closed specs). Old reports that still carry the fields remain valid — readers already
  ignore them, so the union merge and the append-only guarantee (Principle IV) are unaffected.
- **Starting is automatic where allowed; freezing is always explicit.** The live compass begins on
  its own when Bearing entry opens on a platform that needs no permission gesture, and behind an
  explicit tap where one is required (iOS) — see Clarifications. But *freezing* is always a deliberate
  action: the hunter taps to freeze at the moment they choose, rather than the dial guessing they have
  held still. A real compass is read when the reader decides; auto-freezing on stillness would capture
  the wrong moment near a swinging antenna.
- **The dial shows magnetic, and declination stays a system concern.** Like a physical compass, the
  dial is a magnetic instrument. The reporter never sees or adjusts declination; the system converts
  and records true north as it does now.
- **The editable numeric value stays.** The dial is the primary control, but the exact number remains
  visible and settable — for precision, for accessibility, and so the ten-second budget is never held
  hostage to a fiddly drag. Removing the number is out of scope.
- **The compass sensor's platform quirks are already handled.** The device's magnetic heading, its
  screen-orientation correction, and its permission model are existing, working concerns of feature
  001. This feature consumes that heading and does not re-solve it.
- **Participants carry a phone with a browser and have not been trained on this tool.** The dial must
  be recognizable and operable cold, the same standing assumption feature 001 makes.
- **This is a refinement of one existing interaction, not a new report path.** No new report kind, no
  new field, no server behaviour. If any part of this feature would change what the log stores or how
  it maps to the air, that part is out of scope until raised as its own decision.
