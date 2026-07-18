# Feature Specification: Material 3 Expressive UI Redesign

**Feature Branch**: `002-material3-ui-redesign`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "UI beautification — FoxMapper does its job, but it looks like a debug build. Every surface — the join screen, the map with its status chips, the four-button report bar, the report entry sheet, report popups, banners and notices — is functional and utilitarian: flat gray boxes, uniform spacing, no visual hierarchy beyond font size, no feedback beyond a color swap. And it is wordy: every affordance is a sentence, every status a phrase, so the screen reads like a form when it should read like an instrument. Redesign the look and feel of the existing interface using the Material 3 Expressive design language for web, applied through a coherent set of design tokens that replaces today's ad-hoc CSS variables. Reduce the interface's reliance on text by making deliberate use of iconography. This is a re-skin and interaction polish, not a feature change. Everything the current stylesheet defends survives. The app must remain a lightweight, no-install web page that loads fast on a phone with one bar of coverage."

## Overview

FoxMapper's interface is functional but reads like a debug build: flat gray boxes, uniform
spacing, no hierarchy beyond font size, no interaction feedback beyond a color swap, and a
sentence of text where a glance should do. This feature redesigns the look and feel of every
existing surface using the Material 3 Expressive design language — tonal color, expressive
type scale, shape system, state layers, and motion — applied through one coherent set of
design tokens that replaces today's ad-hoc styling values. Text gives way to iconography
where an icon is genuinely clearer, guarded by the constitution's plain-language principle.
The branding push also delivers the app's identity mark and the favicon and home-screen
icons derived from it, designed alongside the palette.

This is a re-skin and interaction polish, **not** a feature change: no capability is added or
removed, and the information architecture stays where it is. Every rule the current
stylesheet defends survives, because each answers a field condition rather than a taste:
gloved-thumb touch targets, sunlight-readable dark scheme, always-visible sync status,
four equal report kinds, colour-blind-distinguishable palette, no pull-to-refresh, clear map
attribution, and reduced-motion support.

## Clarifications

### Session 2026-07-16

- Q: Is rewriting existing interface text (microcopy) in scope for this redesign? → A:
  Yes, rewrite freely — wording may be shortened or replaced anywhere an icon + short
  label carries the same meaning; meaning is frozen, phrasing is not, and the
  plain-language principle still governs every label.
- Q: What should anchor the new tonal palette — FoxMapper's brand color? → A: Deferred to
  the plan phase: the spec stays hue-agnostic; the plan proposes a seed color with contrast
  and colour-blind evidence, decided at plan review.
- Q: What intensity of Material 3 Expressive should the redesign aim for? → A: Calm
  instrument, expressive moments — a restrained baseline (quiet surfaces, quick functional
  motion) with expressiveness concentrated at communicative moments: press states, sheet
  entry/exit, status changes, and the join screen.
- Q: Should the branding push include a designed site icon and favicon? → A: Yes (user
  directive) — the app's identity mark is designed alongside the palette seed color; the
  plan phase proposes it (evolving the existing bearing-wedge mark or replacing it),
  decided at plan review.
- Q: Which icon deliverables are in scope for the branding push? → A: Browser +
  home-screen set — favicon (SVG plus a fallback), maskable manifest icons, and
  apple-touch-icon, all derived from the one identity mark and shipped in the bundle. A
  social share preview image is out of scope.
- Q: Is the basemap style in scope for the redesign, or only the app's own surfaces? → A:
  Chrome only — the third-party street style stays as-is. The redesign covers everything
  FoxMapper draws itself (chips, bars, sheets, popups, map markers and bearing wedges) plus
  the blank offline fallback style, which gets token-set styling as a designed empty state.
- Q: How should "readable in direct sunlight" be made measurable for the new palette? → A:
  Always-visible glanceable elements — status chips, report bar labels, uncertainty
  warnings — must reach 7:1 contrast; all other text meets WCAG AA (4.5:1). Both bars are
  verified by the automated contrast audit.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reporting reads as an instrument (Priority: P1)

A hunter on a live hunt has the map open. The four report kinds are presented as four
buttons whose icon and color identify them at a glance — no reading required once seen
once. Pressing one gives immediate tactile-feeling visual feedback; the report entry sheet
enters with a motion that makes clear where it came from and how to dismiss it. The sheet's
controls have obvious hierarchy: the primary action is unmistakable, secondary actions are
visibly secondary. A first-time hunter handed a phone mid-hunt finds and completes the
report flow without being told how.

**Why this priority**: Reporting is the product. If the redesign improves only one journey,
it must be the one a hunter performs dozens of times per hunt with gloves on and a radio in
the other hand. Every other surface exists to support this one.

**Independent Test**: Can be fully tested by opening the map view in a hunt session and
exercising the report bar and entry sheet on a phone-sized viewport — verifying icon +
label presentation of all four report kinds, press feedback on every control, sheet
entry/exit motion, and completion of a report of each kind — while every other surface
still carries the old styling.

**Field Validation** *(deferred milestone — not a gate)*: Hand a phone to a hunter who has
never seen the app, mid-hunt, and ask them to report a bearing. Success is observed, not
asked: they find the report flow and submit without a prompt from the person handing them
the phone. Watch for hesitation at the four report buttons — hesitation means the icons
failed and the labels carried the load.

**Acceptance Scenarios**:

1. **Given** the map view in an active session, **When** a hunter looks at the report bar,
   **Then** all four report kinds appear as visual equals (same size, same prominence), each
   identified by a distinct icon and color plus a short plain-language label.
2. **Given** any button or tappable control in the report flow, **When** the hunter presses
   it, **Then** a visible pressed state appears within the press itself (not after release).
3. **Given** the report bar, **When** a report kind is tapped, **Then** the entry sheet
   enters with a directional motion that communicates where it lives, and can be dismissed
   the way it arrived.
4. **Given** the report entry sheet, **When** a hunter scans it, **Then** the submit action
   is visually dominant over every secondary control, and every text input renders at 16px
   or larger.
5. **Given** a device with reduced motion enabled, **When** the sheet opens or closes,
   **Then** the state change is immediate or near-immediate with no decorative animation,
   and nothing about the flow is lost.
6. **Given** a hunter mid-report, **When** any transition or animation plays, **Then** input
   is never blocked waiting for it to finish.

---

### User Story 2 - Status readable from the periphery (Priority: P2)

A hunter glances at the phone mounted on the dash. Sync state, queue depth, and session
status are visible in the primary view as compact chips whose shape, icon, and color carry
the meaning — a phrase no longer required. When connectivity drops, the change is
noticeable peripherally without being alarming; when coverage returns and the queue drains,
the interface visibly looks like the app *working*, not the app broken. Banners and notices
share the same visual language, and empty, loading, and error states are designed with the
same attention as the happy path.

**Why this priority**: Offline is the normal case (constitution, Principle III), and sync
and queue status are the hunter's only evidence the system is holding their reports. Today
that evidence is wordy and easy to miss; after the redesign it should be legible at arm's
length. It follows P1 because status supports reporting, not the reverse.

**Independent Test**: Can be fully tested by driving the app through its connectivity
states (online, offline with queued reports, reconnecting and draining) in a browser with
network throttling, and verifying each state is identifiable from the primary view at a
glance — distinct icon, color, and shape per state, no tap required — and that each banner,
empty, loading, and error state renders in the new visual language.

**Field Validation** *(deferred milestone — not a gate)*: On a hunt route that passes
through a known dead zone, observe whether the hunter notices the offline transition
without prompting, and whether anyone expresses worry while the queue drains on reconnect.
The redesign succeeds if the drain reads as progress rather than malfunction.

**Acceptance Scenarios**:

1. **Given** an active session, **When** the hunter views the map, **Then** sync and queue
   status are visible in the primary view without any tap, scroll, or gesture — same
   guarantee as today, restyled.
2. **Given** a change in sync state (online → offline, offline → draining, draining →
   synced), **When** it occurs, **Then** the status chip changes in icon, color, and shape
   — never color alone — such that the change is noticeable in peripheral vision.
3. **Given** queued reports draining after coverage returns, **When** the hunter watches
   the status area, **Then** the interface communicates active progress (e.g., a visible
   count or progress affordance), not a frozen or error-like state.
4. **Given** any banner, notice, empty state, loading state, or error state in the app,
   **When** it renders, **Then** it uses the shared token set and visual language — no
   surface retains the old debug-build styling.
5. **Given** a hunter with a common color-vision deficiency, **When** any status changes,
   **Then** the states remain distinguishable by icon and shape alone.

---

### User Story 3 - The app reads as one designed thing (Priority: P3)

A hunter receives a share link and opens it. The join screen makes a designed first
impression: clear hierarchy, one obvious action, expressive but restrained. Joining flows
into the map, and everything encountered from there — report popups on the map, the share
surface, warnings and notices — visibly belongs to the same family: same shapes, same
tones, same type, same motion. Nothing looks like a leftover from before the redesign.

**Why this priority**: First impressions decide whether a club adopts the tool, but the
join screen is seen once per hunt while the map is seen for hours. Coherence and polish
matter; they matter after the instrument works and the status reads.

**Independent Test**: Can be fully tested by walking every remaining surface — join screen,
map popups, share, warnings and notices — on a phone-sized viewport and verifying each
consumes the shared token set, no legacy ad-hoc styling values remain in use anywhere, and
a visual sweep finds no surface that reads as unstyled or inconsistent with the rest.

**Field Validation** *(deferred milestone — not a gate)*: At a club meeting, hand the join
link to someone who has never seen the app and watch the first thirty seconds. Success is
an unprompted "this looks nice" or equivalent — the feature exists to make somebody enjoy
opening it, and that is only ever observed in the wild.

**Acceptance Scenarios**:

1. **Given** a share link opened on a phone, **When** the join screen renders, **Then** it
   presents a single visually dominant join action with clear type hierarchy, and every
   interactive element meets the touch-target floor.
2. **Given** any two surfaces in the app viewed side by side, **When** compared, **Then**
   they share the same color tones, type scale, corner shapes, and interaction feedback —
   drawn from one token set.
3. **Given** a report popup opened from a map marker, **When** it renders, **Then** its
   report-kind identity uses the same icon and color as the report bar, and it stays clear
   of the map attribution.
4. **Given** the complete stylesheet after the redesign, **When** audited, **Then** every
   styling value on every surface traces to the shared token set, and the superseded ad-hoc
   values are gone.
5. **Given** the app open in a browser tab or added to a home screen, **When** its icon
   renders, **Then** it is the app's identity mark — consistent with the new palette and
   served from the bundle — in the tab (favicon), on the home screen (manifest and touch
   icons), and in the manifest's theme colors.

---

### Edge Cases

- What happens when the OS reports reduced-motion preference? Every animation and
  transition in the app degrades to an immediate or near-immediate state change; no
  affordance or information is motion-only.
- How does the new palette behave in direct sunlight? The sunlight bar is quantified:
  always-visible glanceable elements (status chips, report bar labels, uncertainty
  warnings) reach 7:1 contrast, everything else at least WCAG AA — so the elements a
  hunter reads at a glance outdoors carry the strongest contrast on the screen.
- What about a hunter with a common color-vision deficiency? The recent palette work made
  report kinds and statuses distinguishable for colour-blind hunters; the new tonal palette
  must preserve that — icon and shape carry meaning alongside color, never color alone.
- What does this do with no network for the whole hunt, and on reconnect with a divergent
  log? Behavior is unchanged by design (re-skin only) — but the offline and
  queue-draining *presentations* are designed states, and the redesign must not introduce
  any asset fetched from the network at runtime, or the styling itself breaks offline.
- What does this show when report geometry is poor (<3 reports, narrow angular spread,
  multi-modal posterior)? The uncertainty warnings stay in the primary view (constitution,
  Principle I) and get the same design attention as every other notice — restyled, never
  demoted to a tooltip, footer, or dismissible layer.
- What does a participant who only has a stock handheld — signal-strength and "I hear
  nothing here" reports, no bearings — get out of this? Their two report kinds remain
  visual equals of the bearing and hunch kinds: same button size, same prominence, same
  icon treatment (constitution, Principle II).
- What happens on a very small or unusually narrow viewport? The report bar keeps all four
  kinds visible as equals and every target keeps the 56px floor — labels may compress
  before targets or icons do.
- What happens the first time a hunter sees an icon they don't recognize? Any icon whose
  meaning a first-time hunter would have to guess carries a plain-language label beside
  it; icon-only affordances are reserved for the genuinely universal (close, share,
  locate me).
- What happens if the device is mid-gesture on the map when a status change animates?
  Peripheral status motion must not intercept or delay map gestures or report taps.

## Requirements *(mandatory)*

### Functional Requirements

**Design system**

- **FR-001**: The interface MUST be styled through a single coherent set of design tokens —
  color, typography, shape, spacing, elevation, and motion — expressed in the Material 3
  Expressive design language, and this token set MUST replace the existing ad-hoc styling
  values entirely; no surface may consume a styling value that bypasses the token set.
- **FR-002**: The color system MUST be a tonal dark scheme readable in direct sunlight,
  quantified as: always-visible glanceable elements (status chips, report bar labels,
  uncertainty warnings) MUST reach 7:1 contrast against their backgrounds, and all other
  text MUST meet or exceed WCAG AA (4.5:1).
- **FR-003**: The type system MUST establish visible hierarchy (display/title/label/body
  distinctions) on every surface, and every text input MUST render at 16px or larger.
- **FR-004**: Every interactive element MUST present state layers: a visible pressed state
  that appears during the press, plus hover and focus states where the input method
  supports them.
- **FR-005**: Motion MUST be used where it clarifies a state change (sheet entry/exit,
  status transitions) and MUST NOT delay, block, or gate any input; when the OS reports a
  reduced-motion preference, all nonessential animation MUST be suppressed with no loss of
  information or affordance. The overall posture is a calm instrument with expressive
  moments: a restrained baseline (quiet surfaces, quick functional motion), with
  expressiveness concentrated at communicative moments — press states, sheet entry/exit,
  status changes, and the join screen — never as ambient decoration.

**Iconography**

- **FR-006**: Each of the four report kinds MUST be identified by a distinct icon in the
  Material Symbols style, distinguishable by shape as well as color, and all four MUST be
  presented as visual equals.
- **FR-007**: Any icon whose meaning a first-time hunter could not confidently guess MUST
  carry a plain-language label beside it; icon-only affordances are permitted only for
  genuinely universal actions (close, share, locate me). Labels MUST use hunter language
  per the constitution's plain-language principle.
- **FR-008**: All icons and every other visual asset MUST ship in the application bundle;
  the interface MUST NOT fetch any font, icon, stylesheet, or image from a network origin
  at runtime beyond what the app already fetches (map tiles).

**Surfaces**

- **FR-009**: Every existing surface MUST be restyled under the token set: the join screen,
  the map view and its status chips, the four-button report bar, the report entry sheet,
  report popups, banners, warnings, and notices — plus everything FoxMapper draws on the
  map itself (report markers, bearing wedges) and the blank offline fallback map style,
  which is a designed empty state. The third-party basemap street style is explicitly out
  of scope and stays as-is. No FoxMapper-drawn surface may remain on the old styling.
- **FR-010**: Sync and queue status MUST remain always visible in the primary view, never
  behind a tap or gesture, and a sync-state change MUST be noticeable peripherally through
  a change of icon, color, and shape — never color alone.
- **FR-011**: Empty, loading, and error states MUST be explicitly designed under the token
  set; in particular, a queue draining after coverage returns MUST present as visible
  progress, not as a stalled or error-like state.

**Preservation (invariants of the current stylesheet)**

- **FR-012**: The redesign MUST NOT add or remove any capability, and MUST NOT move any
  function to a different location in the interface (information architecture unchanged).
  Rewriting interface text IS in scope: wording may be shortened or replaced wherever an
  icon plus a short label carries the same meaning — the meaning of every affordance and
  status is frozen, its phrasing is not, and all new wording remains hunter language under
  the constitution's plain-language principle.
- **FR-013**: Every interactive target MUST meet or exceed the 56px touch-target floor.
- **FR-014**: The interface MUST NOT enable pull-to-refresh, and map attribution MUST
  remain legible and clear of controls and popups.
- **FR-015**: Report kinds and status states MUST remain distinguishable under common
  color-vision deficiencies; color MUST never be the sole channel of meaning.
- **FR-016**: Uncertainty warnings MUST remain in the primary view with undiminished
  prominence — restyling MUST NOT demote them to a footer, tooltip, or dismissible layer.
- **FR-017**: The app MUST remain a lightweight, no-install web page: the redesign MUST NOT
  introduce a heavyweight UI framework, and first load MUST stay within the load-time and
  transfer-size budget the plan phase sets for a throttled 3G connection.

**Branding**

- **FR-018**: The branding work MUST deliver an app identity mark and the icon set derived
  from it — a favicon (SVG plus a fallback for browsers that need one), maskable manifest
  icons, and an apple-touch-icon — visually consistent with the new palette and the
  manifest's theme colors, and shipped in the bundle per FR-008. A social share preview
  image is out of scope for this feature.

### Key Entities

- **Design token set**: The single source of styling truth — named values for color roles,
  type scale, shape scale, spacing, elevation, and motion durations/easings. Every surface
  consumes tokens; no surface defines its own values.
- **Report-kind identity**: The stable pairing of icon, color role, and plain-language
  label for each of the four report kinds, used identically in the report bar, the entry
  sheet, and map popups.
- **Status vocabulary**: The set of sync/queue/session states and the icon + color + shape
  triple that identifies each, used in chips, banners, and notices.
- **App identity mark**: The single brand mark from which the favicon, manifest icons, and
  touch icon all derive; visually consistent with the palette seed and the manifest theme
  colors, and designed (or evolved from the existing mark) alongside the palette.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of text elements meet or exceed WCAG AA contrast against the new
  palette, and 100% of always-visible glanceable elements (status chips, report bar
  labels, uncertainty warnings) reach 7:1 — both verified by automated audit across every
  surface and state.
- **SC-002**: 100% of interactive targets measure 56px or larger in both dimensions,
  verified by automated audit across every surface and state.
- **SC-003**: First load on a throttled 3G connection completes within the budget the plan
  phase sets, and in no case regresses more than 20% over the pre-redesign build's first
  load on the same throttled connection.
- **SC-004**: A first-time user handed a phone with an active session open submits a report
  without instruction — at least 4 of 5 first-time testers succeed unaided within 60
  seconds of taking the phone.
- **SC-005**: At least 4 of 5 first-time users correctly state what each of the four report
  buttons does from its icon and label alone, without tapping it.
- **SC-006**: With the OS reduced-motion preference enabled, an audit of every surface and
  transition finds zero nonessential animation.
- **SC-007**: Each sync/queue state (online, offline, queued, draining) is identifiable
  from the primary view without any interaction, and each pair of states is distinguishable
  with color removed (icon and shape alone) — verified across all states.
- **SC-008**: A stylesheet audit after the redesign finds zero styling values in use that
  bypass the design token set, and zero of the superseded ad-hoc values remaining.
- **SC-009**: A runtime network audit of a full session (join → report → offline → drain)
  shows zero requests for fonts, icons, stylesheets, or images beyond map tiles.
- **SC-010**: The browser tab shows the identity mark as its favicon, and adding the app
  to a phone home screen produces the identity mark as the launch icon — verified on at
  least one major mobile browser per platform (iOS and Android).

## Assumptions

- The four report kinds referenced throughout are the existing ones as labeled in the
  current report bar — Bearing, Signal, Nothing here, Found it; the redesign treats this
  set and its plain-language labels' meanings as fixed.
- Material 3 Expressive is the mandated design *language* (a user-facing requirement about
  how the product looks and behaves); whether it is realized with a third-party component
  library, adapted token stylesheets, or hand-built equivalents is a plan-phase decision.
  The user's stated posture — tokens globally, library components à la carte only where they
  clearly beat the hand-rolled equivalents, and anything adopted must be easy to freeze or
  fork given the candidate library's thin maintenance record — is input to that decision,
  not a requirement of this spec.
- The exact 3G load budget (seconds and transfer size) is set in the plan phase, where the
  current build can be measured to establish the baseline; this spec fixes only the
  regression ceiling (SC-003).
- "First-time hunter" testing (SC-004, SC-005) is performed with convenience testers
  (club members, friends) on a phone-sized device; it does not require a real hunt and is
  distinct from the deferred field-validation milestones.
- The recent colour-blind palette work defines the accessibility bar for report-kind and
  status colors; the new tonal palette must meet or exceed it, and may change the specific
  hues so long as distinguishability and contrast criteria hold. The brand seed color that
  anchors the tonal palette is deliberately unspecified here: the plan phase proposes it
  with contrast and colour-blind evidence, and it is decided at plan review.
- An identity mark already exists (a bearing-wedge symbol used as the manifest icon, with
  no favicon declared); whether the new mark evolves it or replaces it is proposed by the
  plan phase alongside the palette seed and decided at plan review. The icon deliverables
  are the browser + home-screen set only (favicon with fallback, maskable manifest icons,
  apple-touch-icon); a social share preview image is out of scope.
- Dark scheme remains the only scheme; a light theme is out of scope for this feature.
- Existing behavior, data, and wire formats are untouched; this feature changes
  presentation and interaction feedback only.
