# Phase 0 Research: Visual Compass Dial for Bearing Entry

All decisions are client-side and add no runtime dependency. Each resolves a design unknown the spec
left to planning; none reopens a settled requirement.

## R1 — How the dial is rendered and rotated

**Decision**: One inline SVG rose (a `<g>` containing N/E/S/W, 5°/30° tick marks, and degree
numerals) rotated with a CSS `transform: rotate(θ)`. A fixed HTML index sits above the SVG at the
12-o'clock position and does not move. The bearing shown is the value that lands under that index; the
rose is rotated by `-heading` so that "the direction the device points" reads at the top.

**Rationale**: `transform: rotate` is compositor-driven — 60 fps with no layout or paint per frame,
which matters because the live rose updates on every sensor tick. SVG keeps the rose crisp at any
size and is trivially themed from the existing `tokens.css` roles (no raster assets, so nothing to
fetch — SC-009). The rose is one static drawing rotated as a whole; there is no per-tick DOM churn.

**Alternatives considered**: Canvas 2D redraw per frame (more code, manual DPR handling, no free
theming, harder to test than a transform value); a CSS conic-gradient rose (cannot carry legible
cardinal letters or numerals); a WebGL dial (absurd for a 2-D rose, and a dependency).

## R2 — Damping the live rose so it reads like a settling card

**Decision**: Low-pass the heading in the **angle domain** to avoid the 359°→0° wrap discontinuity:
keep a smoothed unit vector `(x, y)`, and on each sensor sample update it toward
`(cos h, sin h)` with an exponential factor `α` derived from the elapsed time and a time constant
`τ ≈ 150–250 ms`; the displayed heading is `atan2(y, x)`. Freeze captures the **displayed, smoothed**
value — what the hunter actually saw — not the latest raw sample.

**Rationale**: The raw sensor jumps several degrees between samples; that jitter is the entire reason
the bare number is unreadable. Smoothing sin/cos rather than the angle itself keeps a heading near
north from flickering between 359 and 1. Capturing the smoothed value is the honesty point: the
reporter vouches for the number on screen, so that is the number the report must carry (SC-007). τ is
tuned to settle visibly yet not lag the freeze; it is a single constant, unit-tested for wrap
behavior and step response.

**Alternatives considered**: A critically-damped spring (nicer overshoot feel, more state and tuning
for no requirement here); median-of-N (adds latency, still wraps badly near north); no damping (fails
FR-005 and the readability premise of the feature).

## R3 — The twist gesture, and keeping it distinct from sheet scroll

**Decision**: Pointer Events on the rose. On `pointerdown` capture the pointer and record the angle
from the dial center to the touch; each `pointermove` rotates the rose by the angular delta, so the
point under the finger stays under the finger (a real "grab and spin"). The dial element sets
`touch-action: none` so the browser does not claim the drag for scrolling; the sheet scrolls only via
gestures that begin **outside** the dial. No angle snapping — the numeric field carries the exact
value (FR-003).

**Rationale**: Center-relative angle tracking is the gesture a physical bezel affords and matches
"twist the dial." `touch-action: none` scoped to the dial is the standard, reliable way to stop
scroll/twist from stealing each other (FR-019) without disabling scroll for the rest of the sheet.
Pointer capture makes the drag survive the finger leaving the rose's bounds mid-twist. Free (unsnapped)
rotation keeps correction precise; a hunter landing "within a few degrees" one-handed is the bar
(SC-004), and the numeric field is there when an exact figure is wanted.

**Alternatives considered**: Touch/mouse events separately (Pointer Events unify them and are
well-supported on both targets); a drag-anywhere delta model (breaks the grab-the-rim mental model);
snap-to-5° (would round away corrections the hunter deliberately made).

## R4 — Unset state and the freeze/commit lifecycle

**Decision**: The dial exposes a committed heading that is **undefined until the first freeze or
twist**, mirroring today's `magnetic: number | undefined` guard in `report-entry.ts`. Send stays
disabled while it is undefined (FR-003a). Freezing commits the current smoothed heading; twisting
commits (and detaches from the sensor — FR-009); going live again clears the commit until the next
freeze so a stale value can never be sent behind the hunter's back (Story 1 scenario 4).

**Rationale**: This is the exact honesty guard feature 001 already enforces for heading and range —
"undefined, not zero," no due-north default (FR-006c of 001). Reusing the same shape keeps the send-
enable logic a single predicate and makes the unset case testable directly (open sheet → Send
disabled).

**Alternatives considered**: Default the committed value to the live heading on open (would let a
hunter send an unvouched, still-moving reading); default to 0/N (the precise trap 001 forbids).

## R5 — Auto-start where the platform allows

**Decision**: On sheet open, branch on the existing `needsPermission()` from `sensors/heading.ts`.
Where it returns false (Android — no permission model), call `watchHeading()` immediately so the rose
is live on open. Where it returns true (iOS), show a "start the compass" control that calls
`requestPermission()` inside the tap handler, then `watchHeading()`. No-compass devices and the relay
path never enter live mode (FR-011, FR-012).

**Rationale**: This is the clarified behavior (auto-start where allowed, explicit tap where a gesture
is required) and it falls straight out of the existing feature-detection — iOS *cannot* auto-start
because `requestPermission()` rejects outside a user gesture, so the explicit control is mandatory
there and merely skipped elsewhere. Reusing `needsPermission()` means no new platform sniffing.

**Alternatives considered**: Explicit start on every platform (uniform, but slower on Android for no
benefit and not what was chosen in clarification); auto-start everywhere (impossible on iOS by
platform rule).

## R6 — Accessibility and reduced motion

**Decision**: The always-visible numeric field is the accessible, keyboard/AT path (typed exact
bearing, standard `input` semantics); the SVG rose is decorative to assistive tech (`aria-hidden`)
and need not be operable by keyboard (clarified). Under `prefers-reduced-motion`, the rose still
tracks and reads (rotation is the content), but non-essential flourishes — a settle bounce, a freeze
pulse — are not played (FR-020), matching the existing reduced-motion audit.

**Rationale**: The numeric field already exists and is fully operable; making it the AT path keeps
the dial a progressive enhancement rather than a gate (FR-018) and avoids building an ARIA-slider the
clarification explicitly said is not required. Reduced-motion parity follows feature 002's
established pattern (functional content survives, garnish drops), so it slots into the existing
`reduced-motion.spec.ts`.

**Alternatives considered**: A keyboard-steppable ARIA slider on the dial (more surface to build and
test; the clarification declined it); hiding the numeric field once the dial exists (removes the
accessible path and the precise-entry escape hatch).

## R7 — Removing `heading_source` and `compass_accuracy_deg`

**Decision**: Delete both fields from `BearingPayload` (and the `HeadingSource` type) in
`log/types.ts`, from `BearingDraft`/`BearingEntry`/`composeBearing` in `report/bearing.ts`, and from
the `bearing` payload table + example in `docs/log-format.md`. Ingest stays tolerant — an incoming
report that still carries them is accepted and the extra keys ignored. Update the unit fixtures that
generate them (`arbitraries.ts`, `report.test.ts`, `layers.test.ts`, `wedge.test.ts`).

**Rationale**: Grep confirms the fields are **write-only**: no renderer, wedge, layer, or fusion path
reads them, and the APRS mapping (`aprs/mapping.ts`) carries only `heading_true`, Q, and R — so the
lossless wire round-trip is unaffected (Principle V) and the union merge is unaffected because these
keys are never identity (Principle IV). This is the maintainer's settled call: a bearing is a
bearing; the log should not record how the number was arrived at. Tolerant ingest keeps old and
foreign logs valid with no migration.

**Alternatives considered**: Keep the fields and always write `manual` (dishonest and pointless once
nothing reads them); a schema migration to strip them from stored reports (violates append-only
immutability for zero benefit — readers already ignore them).

## Resolved unknowns

No `NEEDS CLARIFICATION` remain. The four spec-level ambiguities were settled in the
[spec Clarifications](spec.md#clarifications) (unset initial state, rotating-rose metaphor,
auto-start where allowed, numeric-field accessibility); the design unknowns above (rendering,
damping, gesture, lifecycle, field removal) are resolved here.
