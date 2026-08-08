# Research: True North Bearings Without Declination Math

**Feature**: 005-true-north-bearings | **Date**: 2026-08-07

Every Technical Context unknown resolved. Each entry: Decision / Rationale / Alternatives
considered.

## R1 — The reference model: one active reference per entry surface

**Decision**: A bearing-entry surface (the dial + numeric field as a unit) has exactly one **active
north reference** at a time. The rose, the numeric field, the twist gesture, and the committed
value all express the heading in that reference; a chip beside the field names it. Switching
reference converts the displayed number; it never changes the physical direction being claimed.

**Rationale**: The reported confusion was two surfaces silently speaking two references (dial
magnetic, map true). Per-widget references inside one sheet would recreate that seam one level
down. One reference per surface makes FR-003 ("no silent reference change between entry and
display") structural: there is nowhere for a second frame to hide.

**Alternatives considered**:
- *Show both values everywhere simultaneously* (CalTopo measure-tool style) — rejected in
  clarification (2026-08-07, Q1): clutter on a gloved-thumb interface.
- *Reference as a per-keystroke property of the numeric field only* — rejected: the rose and the
  field would disagree mid-entry, and twist would need its own rule anyway.

## R2 — Where conversion happens: at the dial boundary, declination fixed at sheet-open

**Decision**: Sensor samples are converted magnetic→true **as they enter the dial** (before the
smoother). The declination used is computed once when the bearing sheet opens, from the report's
origin position (own position for the hunter's sheet; the armed target's position for relay), via
the existing `declinationAt`. The same declination value drives the switch preview and the
compose step for that sheet instance.

**Rationale**: Converting at the boundary keeps the whole dial — smoother, twist, freeze, numeric
field — in display space, so no downstream code ever asks "which frame am I in". Computing
declination once per sheet-open is correct to well under 0.01°: declination varies by fractions of
a degree over tens of kilometres, and a sheet is open for seconds. It also guarantees the preview
the user saw and the conversion that is stored use the same number (no open-vs-submit drift).
Bearing sheets already cannot open without a position (report-entry.ts `NO_POSITION` guard), so
the declination is always computable.

**Alternatives considered**:
- *Convert at submit only (status quo)* — the bug: display and log disagree by the declination.
- *Recompute declination per sensor sample from the live fix* — pointless precision (the smoother
  damps harder than declination varies) and risks the preview differing from the stored
  conversion by a recompute.
- *Smooth in magnetic, convert for display* — two frames alive inside one component; the exact
  seam R1 exists to remove.

## R3 — Exactness: the entered value is stored verbatim in its own field

**Decision**: `composeBearing` accepts a draft of `{ heading, reference }`. If reference is
`true`, `heading_true` **is** the entered value (normalized) and `heading_magnetic` is derived; if
`magnetic`, vice versa. The derived counterpart uses the sheet's declination.

**Rationale**: FR-003 and SC-001 demand the number the user vouched for and the number the log
carries be identical — by construction, not by round-trip luck. Converting the entered value out
and back (`true → magnetic → true`) can drift in the last decimal; storing it verbatim cannot.
This also preserves feature 004's "a bearing is a bearing": the log still records no provenance —
`reference` is a draft-time input that determines which field is verbatim, and it is not stored
(both fields land in the payload either way, indistinguishable from today's reports).

**Alternatives considered**:
- *Keep magnetic-only drafts and convert in the sheet before compose* — pushes reference handling
  into every caller and stores a derived value as if entered.
- *Store the entered reference in the payload* — write-only metadata nothing renders or computes
  on; rejected on the same ground 004 dropped `heading_source` (and the maintainer's standing
  "no write-only log fields" rule).

## R4 — The reference switch: a chip that shows the converted number

**Decision**: The reference control is a single chip-button adjacent to the numeric field with two
faces: the active reference as the field's unit label ("° true" / "° magnetic"), and the switch
itself reading the **converted value it would switch to** — e.g. field `220.0 ° magnetic`, switch
`= 235.0° true`. Tapping swaps them. One control, 56 px target, present whenever the surface
accepts hand entry.

**Rationale**: Clarified explicitly (2026-08-07, Q3): the switch must show the converted number,
so the consequence of switching is visible before the tap. It also doubles as a free sanity check
— net control hears "220 magnetic", sees "= 235° true", and a wrong origin position or a garbled
call-in shows up as a wrong-looking delta before anything is logged.

**Alternatives considered**:
- *Bare "true/magnetic" toggle* — rejected by the same clarification: the user learns what the
  switch did only after taking it.
- *Segmented two-button control showing both numbers as selectable options* — two targets where
  one suffices; more visual weight than the default flow is allowed to carry (FR-011).

## R5 — Where the on-demand detail lives: settings sheet + report popup

**Decision**: Two homes, both existing surfaces. (a) The **settings sheet** (the "Fox hunt" chip →
Settings) gains a declination line: "Magnetic north is about 15° east of true north here — using
the 2025 magnetic model", with "— that model is out of date" appended when `stale` (FR-009).
(b) The **report popup** for a bearing gains a heading line showing both values, each labeled:
"Bearing 235° true (220° on a magnetic compass)". No new screen, no new icon.

**Rationale**: FR-010 wants the detail reachable but never in the way. Settings is two taps from
the hunt screen (SC-005's 15-second budget with margin) and already the home of
participant-facing meta-information. The popup is where a specific report is already inspected —
the natural place to see a specific bearing both ways (spec Story 3, scenario 2). The map's ⓘ
control is maplibre attribution and not ours to overload.

**Alternatives considered**:
- *A dedicated declination screen or map overlay* — a new concept for a P3 story; nothing else in
  the app warrants a screen for one number.
- *Declination inside the bearing sheet* — puts the detail in the default flow FR-011 keeps clean;
  the chip already carries the actionable part (the conversion).

## R6 — FR-004's "whichever reference the device reports": a boundary contract, not runtime detection

**Decision**: `sensors/heading.ts` keeps its documented invariant — the `Heading` it emits is
**magnetic, always** (`heading.magnetic`); both platform paths (`webkitCompassHeading`, Android
`deviceorientationabsolute`) report magnetic-referenced headings and the module's header says so.
The magnetic→true conversion is applied **exactly once**, at the dial boundary (R2). If a future
platform API ever supplies true headings, the change lands inside heading.ts (normalizing to the
module's magnetic contract or renaming the field), behind the same interface.

**Rationale**: There is no web API today that reports true headings or that identifies its
reference; runtime "detection" would be fiction, and a speculative `reference` field on every
sample would be data nothing can ever disagree with. FR-004's no-double-correction requirement is
satisfied structurally: one conversion site, one documented boundary. The unit contract to pin it:
heading.ts emits magnetic; declination.ts owns both conversion directions; compass-dial converts
on ingest and nowhere else.

**Alternatives considered**:
- *Add `reference: 'magnetic' | 'true'` to `Heading` now* — YAGNI plus a constant field readers
  must branch on for a case that cannot occur; noise in every test fixture.
- *Convert inside heading.ts so it emits true* — heading.ts has no position and must not grow a
  dependency on one; the sensor module stays a sensor module.

## R7 — Supersession of 004's "magnetic-only on screen"

**Decision**: Feature 004's display constraint — "magnetic-only on screen, the true-north
conversion stays invisible" (004 plan Technical Context; compass-dial.ts header; 004's FR-016
"declination is never shown") — is **superseded** by this feature. The parts of 001/004 that
survive untouched: true north in the log and on the wire, no due-north default, commit-on-freeze-
or-twist, no provenance in the payload, the numeric field as the accessible path.

**Rationale**: 004 implemented "the user shouldn't think about declination" as "never show the
conversion". Field feedback (2026-08 round, the spec's origin) showed the invisible conversion
*creates* the thinking: users see 0° become a 15°-east wedge and lose trust in every wedge. The
constitution's own hierarchy applies — when feedback exists it is prized and reprioritizes
(Development Workflow, field validation). 004's closed spec is left as historical record, per the
precedent 004 itself set with 001; the living statements (code comments, docs) are updated.

**Alternatives considered**:
- *Amend 004's spec retroactively* — rejected; closed specs are records, and 004 did not rewrite
  001 when it dropped fields.

## R8 — Zero log-format delta

**Decision**: No change to `BearingPayload`, the wire mapping, `docs/log-format.md` semantics, or
any fixture's shape. Old reports render under the new display rules with no migration: both
headings are already present on every bearing ever logged.

**Rationale**: The format was designed for this — 001 recorded both headings plus declination and
epoch precisely so display policy could change without touching the log. This feature is the
payoff. APRS mapping reads `heading_true` only and is unaffected.

**Alternatives considered**: none serious; any payload addition would need a justification this
feature does not have.

## R9 — Precision and rounding of displayed conversions

**Decision**: The dial's field and switch preview keep the field's existing 0.1° precision, both
values rounded independently from the exact stored values. The popup and settings lines round to
whole degrees ("235° true (220° magnetic)", "about 15° east") — matching the honest precision of
compass work (10–30° sensor error; ~1° hand-compass reading error).

**Rationale**: Principle I forbids implying precision inputs don't support; a settings line
reading "15.43° east" would. The entry field keeps 0.1° only because it already has it (004) and
reducing it here would be scope creep. Rounding for display never feeds back into stored values
(R3 keeps entered values verbatim).

**Alternatives considered**:
- *Whole degrees everywhere including entry* — a behavior change to 004's field outside this
  feature's motivation.
