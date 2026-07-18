# Phase 0 Research: Material 3 Expressive UI Redesign

**Date**: 2026-07-16 | **Spec**: [spec.md](spec.md)

This document resolves the four decisions the spec explicitly deferred to the plan phase
(component-library posture, palette seed colour, identity mark, 3G budget) plus the
supporting technical choices (typography, icons, motion, state layers).

---

## R1. Component-library posture: tokens only, no runtime dependency

**Decision**: Do **not** adopt `@material/web` at runtime. Realize M3 Expressive as a
hand-authored token stylesheet (`web/src/ui/tokens.css`) using M3 system-token names
(`--md-sys-color-*`, `--md-sys-shape-*`, `--md-sys-motion-*`, `--md-sys-typescale-*`),
generated once at development time by a script using `@material/material-color-utilities`
(devDependency; generated output committed). `@material/web` v2.5.0's expressive system
stylesheets are consulted as reference for token values and component anatomy, but nothing
from the package ships.

**Rationale**:

- **Verified state of the library** (npm + GitHub, checked 2026-07-16): v2.5.0 published
  2026-07-15 and does ship "expressive system stylesheets", "expressive token versions",
  and expressive variants for button/FAB/icon/list/menu/split-button. It is real and
  usable. But its runtime deps are `lit` + `tslib` + `@lit/context` — roughly 20 KB
  gzipped of web-components runtime before the first component — against a redesign
  budget of ≤ 20 KB gzipped *total*.
- **The component inventory doesn't earn it.** FoxMapper's entire widget set is buttons,
  chips, text inputs, a bottom sheet, banners, and notices — today ~150 lines of CSS on
  hand-rolled DOM. None is complex enough (no menus, no data tables, no date pickers) for
  a component library to beat a styled element. The spec's own posture was "components à
  la carte where they clearly beat the hand-rolled equivalents"; nothing clears that bar.
- **Freeze-or-fork is trivially satisfied**: committed CSS has no upstream to break. The
  generation script is a convenience, not a dependency — if `material-color-utilities`
  dies, the committed tokens remain and can be edited by hand.
- **Interop with MapLibre chrome**: chips and popups style MapLibre-rendered DOM via CSS
  selectors (`.maplibregl-popup-content` etc.); web components' shadow DOM would make this
  harder, not easier.

**Alternatives considered**:

| Alternative | Rejected because |
|---|---|
| Full `@material/web` adoption (components + tokens) | ~20 KB lit runtime + per-component weight busts the budget for widgets we already have; shadow DOM complicates MapLibre chrome styling; thin maintenance record makes a fork of a lit component tree expensive |
| Import `@material/web` token stylesheets, hand-roll components | Ships ~2,000 CSS custom properties (light + dark, every role) when FoxMapper needs ~40 (dark only); still a runtime dependency to freeze; naming is the only part worth taking, and names are free |
| Hand-pick colours with no generation step | Loses the HCT tonal consistency that makes M3 palettes cohere; the script costs one dev-time file and buys correct tonal relationships |

## R2. Palette seed colour: fox rust `#E2633C`

**Decision**: Seed the tonal palette from **fox rust `#E2633C`** — the colour the existing
identity mark's bearing wedge already uses (`web/public/icon.svg` draws the wedge in
`#e5533d`; the seed is a slight warm correction of it). Neutrals come out warm-tinted;
primary in the dark scheme lands near tone 80 (`#FFB598`).

**Proposed dark-scheme roles** (indicative — final values come from the generation script,
then are verified by the contrast-audit test):

| Role | Value | Role | Value |
|---|---|---|---|
| `surface` | `#171310` | `primary` | `#FFB598` |
| `surface-container` | `#1E1915` | `on-primary` | `#55200D` |
| `surface-container-high` | `#2A231D` | `primary-container` | `#723523` |
| `on-surface` | `#EDE0D8` | `on-primary-container` | `#FFDBCE` |
| `on-surface-variant` | `#D0C4BC` | `warn` | `#FFCB69` |
| `outline` | `#9A8D83` | `error` | `#FFB4AB` |
| | | `ok` | `#8CD5B0` |

**Contrast evidence** (WCAG relative-luminance audit, all 16 role pairs, run 2026-07-16):
every glanceable pair ≥ 7:1, every text pair ≥ 4.5:1, every non-text pair ≥ 3:1. Worst
case is the filled-button label (`on-primary` on `primary`) at **7.70:1** against the 7:1
floor. Full pairs:

| Pair | Ratio | Floor |
|---|---|---|
| on-surface / surface | 14.30 | 7.0 |
| on-surface / surface-container (chip & report-bar labels) | 13.49 | 7.0 |
| on-surface / surface-container-high (sheet text) | 11.98 | 7.0 |
| on-surface-variant / surface (dim text) | 10.82 | 4.5 |
| on-surface-variant / surface-container | 10.21 | 4.5 |
| primary / surface-container (accent chip text) | 10.22 | 7.0 |
| warn / surface-container (warning chips) | 11.62 | 7.0 |
| error / surface-container (danger chips, uncertainty warnings) | 10.26 | 7.0 |
| ok / surface-container (synced status) | 10.17 | 7.0 |
| on-primary / primary (Send button label) | 7.70 | 7.0 |
| on-primary-container / primary-container (tonal buttons) | 7.24 | 7.0 |
| outline / surface (borders) | 5.73 | 3.0 |
| four report-kind icon hues / surface-container | 6.19–10.77 | 3.0 |

The audit script becomes a permanent unit test (`web/tests/unit/contrast.test.ts`) that
parses `tokens.css`, so the evidence can never drift from the shipped values (SC-001).

**Colour-blind constraint (hard)**: the per-callsign hunter palette — Paul Tol's "muted",
9 swatches, adopted in PR #32 — is documented in `docs/log-format.md` as a cross-device
guarantee ("one callsign is one colour, on every device, forever"). It is part of the wire
contract, **not** a UI token, and this feature MUST NOT alter it. The new report-kind icon
hues (R6) are chosen from the same CVD-safe family and are never the sole channel — shape
carries the kind (FR-006, FR-015).

**Alternatives considered**: keeping the blue (`#4B9FFF` reads generic and collides with
the "cool neutral" of every default dark theme — the debug-build look the spec names);
neutral-plus-minimal-accent (spends the whole redesign and still has no identity); any
green/red seed (crowds the ok/error semantic hues and the CVD-safe range).

## R3. Identity mark: evolve the bearing wedge

**Decision**: **Evolve, don't replace.** The existing mark — a bounded bearing wedge from
an observer point — is the product in one image and was deliberately drawn ("bounded,
never a ray"). The evolution: keep the geometry, recolour to the new palette (wedge in the
primary/fox-rust family on the new `surface` ground; observer dot in a tonal neutral
instead of today's accent blue), and tune stroke weights so the mark survives 16 px
favicon rendering.

**Deliverables** (all committed, all bundled — FR-018, SC-010):

| Asset | Purpose |
|---|---|
| `web/public/icon.svg` (updated) | Favicon (`<link rel="icon">`) and SVG manifest icon |
| `web/public/icon-192.png`, `icon-512.png` | Maskable PNG manifest icons (Android launcher reliability; SVG-only manifest icons are inconsistently honored) |
| `web/public/apple-touch-icon.png` | 180×180 opaque PNG, `surface`-coloured ground |
| `web/index.html` (updated) | `rel="icon"`, `rel="apple-touch-icon"`, `theme-color` meta |
| `manifest.webmanifest` (updated) | Icon list, `theme_color`/`background_color` = new `surface` |

**Alternatives considered**: a literal fox mark (charming, but says "fox" the animal
rather than "DF hunt", and a recognisable fox at 16 px is a harder drawing problem than a
wedge); a wordmark-derived monogram ("F" says nothing).

## R4. 3G first-load budget: ≤ 330 KB gzipped, ≤ 10 s to usable map on Slow 3G

**Decision** (fills the number SC-003 and FR-017 delegate here):

- **Transfer budget**: total compressed critical-path payload (HTML + CSS + JS + favicon
  + manifest) **≤ 330 KB gzipped**.
- **Baseline measured 2026-07-16** from `web/dist`: JS 292.4 KB gzip (1.09 MB raw, dominated
  by maplibre-gl) + CSS 11.4 KB gzip ≈ **304 KB**. The budget grants the redesign ~26 KB
  of headroom (≈ 8.5% growth) — far inside the spec's 20% regression ceiling.
- **Redesign's own additions ≤ 20 KB gzipped**: tokens.css ≈ 3–4 KB, icon module ≈ 3–5 KB,
  rewritten component CSS ≈ 5–8 KB net, motion/state-layer rules ≈ 2 KB. Brand PNGs are
  not on the critical path (fetched only on install/bookmark).
- **Time budget**: usable map view (join screen interactive, or map rendered for a
  rejoining hunter) **≤ 10 s** on Chrome DevTools "Slow 3G" (≈ 400 kbps / 400 ms RTT,
  4× CPU throttle), and **≤ 120%** of the pre-redesign build measured in the same run
  (SC-003's ceiling). Measured via the Playwright walkthrough in quickstart.md.

**Rationale**: the JS bundle dwarfs everything this feature touches; policing the *delta*
(≤ 20 KB) plus an absolute roof (330 KB) keeps the redesign honest without making it
responsible for MapLibre's weight. **Consequence already visible**: webfonts are
unaffordable (R5) and the icon subset must stay hand-picked (R6).

## R5. Typography: system font stack, M3 Expressive scale

**Decision**: Keep `system-ui` (SF Pro on iOS, Roboto on Android — both already excellent
M3-adjacent faces). Realize the M3 Expressive type scale as size/weight/line-height/
tracking tokens only: display/headline for the join screen, title for sheet headers, label
for buttons and chips, body for content. Expressive personality comes from scale contrast
(large display vs. compact labels) and weight, not from a shipped face.

**Rationale**: Roboto Flex is 100–300 KB even subset — over the entire redesign budget —
and a runtime font fetch is forbidden outright (FR-008). The 16 px input floor and 1.5
body line-height survive from the current stylesheet.

**Alternatives considered**: bundling a subset WOFF2 (budget); `@font-face` with
`font-display: swap` from origin (extra request on the critical path, flash of fallback on
one bar of coverage — worst on exactly the connection the app is for).

## R6. Icons: hand-picked Material Symbols subset, inline SVG, bundled

**Decision**: ~16 icons from Material Symbols (Rounded style, filled), committed as SVG
path data in `web/src/ui/icons.ts` with an `icon(name, {label})` helper that stamps
`aria-hidden` on decorative uses and pairs visible labels per the FR-007 policy. Apache
2.0 licensed — attribution note in the module header. Estimated 3–5 KB gzipped total.

Report-kind icon hues (icons are drawn in these; shape is the primary distinguisher, hue
is reinforcement — FR-006/FR-015): bearing `#FFB598` (primary family), signal `#88CCEE`,
nothing-here `#DDCC77`, found-it `#44AA99` — the latter three drawn from the same Tol
CVD-safe family as the hunter palette. Inventory, meanings, and label policy are contracted
in [contracts/iconography.md](contracts/iconography.md).

**Alternatives considered**: Material Symbols font (CDN forbidden; self-hosted subset
still ~30–60 KB and text-rendering-dependent); an SVG sprite sheet (extra fetch; inline
module tree-shakes better).

## R7. Motion: CSS-only, M3 easing/duration tokens

**Decision**: M3 motion tokens as CSS custom properties — `emphasized-decelerate
cubic-bezier(0.05, 0.7, 0.1, 1)` for entries (sheet up: 300 ms), `emphasized-accelerate
cubic-bezier(0.3, 0, 0.8, 0.15)` for exits (200 ms), `standard` for small state changes
(chip colour/icon swap: 150 ms). Sheet enters translate from the bottom edge (it lives
there — US1 scenario 3); backdrop fades. Status chips cross-fade icon+colour on state
change; the queue-draining chip gets a subtle determinate progress affordance (count
ticking down plus a progress hairline), not a spinner (US2 scenario 3).

The existing global `prefers-reduced-motion` kill (`animation: none; transition: none`)
survives as the last rule in the cascade — it is the SC-006 guarantee. Nothing animates
position on the map layer during gestures; chip transitions are compositor-only
(opacity/transform) so they cannot intercept or delay input (FR-005).

**Alternatives considered**: Web Animations API (no benefit over CSS for these idioms;
more JS); spring physics per full-fat Expressive (rejected with the "calm instrument"
clarification — springy overshoot on a mid-report sheet costs time a hunter feels).

## R8. State layers: pseudo-element overlays

**Decision**: M3 state layers via `::after` overlays using `currentColor` at M3 opacities
(hover 8%, focus 10%, pressed 12% — tuned up to ~16% pressed because a sunlit screen hides
subtle deltas), with `transform: scale(0.97)` on `:active` for buttons so the press reads
even when colour doesn't. `:focus-visible` keeps the existing 3 px outline, recoloured to
`primary`. `touch-action: manipulation` and the no-double-tap-zoom behavior survive.

---

## Resolved-unknowns register

| Deferred by spec | Resolution |
|---|---|
| Component-library posture | R1: tokens only; no runtime dependency; `@material/web` as reference |
| Palette seed colour + evidence | R2: fox rust `#E2633C`; 16-pair contrast audit, worst 7.70:1 vs 7:1 floor |
| Identity mark concept | R3: evolve the bearing wedge; 5 committed assets |
| Absolute 3G budget | R4: ≤ 330 KB gzip critical path; ≤ 10 s Slow-3G; redesign delta ≤ 20 KB |
| (implicit) type without webfonts | R5: system stack + M3 Expressive scale tokens |
| (implicit) icon delivery | R6: bundled inline-SVG Material Symbols subset |
| (implicit) motion idioms | R7: CSS-only M3 easings; reduced-motion kill preserved |
| (implicit) state layers | R8: pseudo-element overlays, pressed state boosted for sunlight |
