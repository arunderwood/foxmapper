# Implementation Plan: Material 3 Expressive UI Redesign

**Branch**: `002-material3-ui-redesign` | **Date**: 2026-07-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-material3-ui-redesign/spec.md`

## Summary

Re-skin every surface FoxMapper draws — join screen, map chrome (status chips, report bar),
report entry sheet, popups, banners, notices, map markers and bearing wedges, and the blank
offline fallback — in the Material 3 Expressive design language, replacing the nine ad-hoc
CSS variables in `app.css` with a coherent M3 token set. Reduce text reliance with a bundled
Material Symbols icon subset. Deliver the branding push: a fox-rust tonal palette seeded
from the existing wedge colour, and the identity mark (evolved bearing wedge) rendered as
favicon, maskable manifest icons, and apple-touch-icon.

Technical approach (full rationale in [research.md](research.md)): **no runtime library**.
The M3 Expressive system is realized as a hand-authored token stylesheet using M3 token
names, generated once at development time with `@material/material-color-utilities` (dev
dependency; output committed). `@material/web` v2.5.0's expressive stylesheets serve as
reference material only. Type is the system font stack sized to the M3 Expressive scale
(zero webfont bytes); icons are inline SVGs in a TypeScript module; motion is CSS-only with
M3 easing/duration tokens. First-load budget: **≤ 330 KB gzipped critical path** against a
measured 304 KB baseline.

## Technical Context

**Language/Version**: TypeScript 5.7, ES2022 modules, no UI framework (hand-rolled DOM via
`el()` helpers in `web/src/ui/dom.ts`)

**Primary Dependencies**: Vite 8 (build), maplibre-gl 5 (map), idb (queue storage).
New: `@material/material-color-utilities` (**devDependency only** — build-time token
generation, output committed to the repo)

**Storage**: N/A (no data-layer changes; IndexedDB queue untouched)

**Testing**: Vitest 4 (unit — including a new contrast-audit test that parses the token
stylesheet), Playwright (e2e — touch-target audit, reduced-motion audit, runtime network
audit, visual walkthrough)

**Target Platform**: Mobile-first web; evergreen browsers (iOS Safari ≥ 16, Android Chrome
current); dark scheme only

**Project Type**: Web SPA, existing single-project layout under `web/`

**Performance Goals**: First-load critical path ≤ 330 KB gzipped (baseline measured
2026-07-16: 292.4 KB JS + 11.4 KB CSS ≈ 304 KB); usable map view ≤ 10 s on Chrome
DevTools "Slow 3G" profile and never > 120% of the pre-redesign build on the same profile
(SC-003); redesign's own additions ≤ 20 KB gzipped

**Constraints**: Offline-first (no runtime fetch of any font, icon, stylesheet, or image
beyond map tiles — SC-009); 56 px touch floor; 16 px input minimum; 7:1 contrast on
glanceable elements, 4.5:1 elsewhere (FR-002); `prefers-reduced-motion` honored; no
pull-to-refresh; map attribution clear of controls; the per-callsign hunter colour palette
(Paul Tol "muted", 9 swatches) is part of the documented log format and MUST NOT change

**Scale/Scope**: ~10 UI source files, ~400 lines of CSS today → token stylesheet +
rewritten component CSS (~700 lines), ~16 bundled icons, 5 icon/brand assets, no
server-side changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Honest Uncertainty**: No estimate logic changes. Uncertainty warnings are
      restyled but keep primary-view placement with *increased* prominence: they sit in the
      glanceable tier and therefore carry the 7:1 contrast floor (FR-002, FR-016). Nothing
      moves to a footer, tooltip, or dismissible layer; the `.chip.warn`/`.chip.danger`
      full-wrap behavior (warnings never truncate) is preserved in the new chip design.
- [x] **II. Every Radio Contributes**: The four report kinds remain visual equals — same
      button size, same prominence, same icon treatment (FR-006). Signal and Nothing-here
      keep first-class placement in the report bar. Icon + short label lowers the
      first-time barrier for the stock-handheld hunter rather than raising it.
- [x] **III. Offline Is the Normal Case**: Every styling asset (tokens, icons, fonts via
      system stack, brand images) ships in the bundle; the runtime network audit (SC-009)
      proves zero new requests. The blank offline fallback map style is upgraded to a
      designed empty state. Motion and state layers are CSS-only — no server round-trip is
      involved in any interaction.
- [x] **IV. Append-Only Log, Derived State**: No log, report, or fusion code is touched.
      The per-callsign colour palette is documented in `docs/log-format.md` as a
      cross-device guarantee and is explicitly frozen by this plan.
- [x] **V. Interop Over Invention, Plain Language**: No new report kinds, no wire changes.
      All rewritten microcopy stays hunter language (FR-012); no protocol vocabulary
      reaches any surface. Icon labels follow the plain-language guardrail (FR-007).
- [x] **Operating Constraints**: Join still needs no account, install, or payment — the
      redesign explicitly defends the lightweight no-install posture (FR-017). No tracking,
      RF, or liability surface is touched; the manifest description and interface copy make
      no certification claims.
- [x] **Fusion discipline**: No location-estimate mathematics is touched. Bearing wedges
      and markers are recolored/restyled only; their geometry and semantics are unchanged.

**Post-Phase-1 re-check (2026-07-16)**: design artifacts introduce no violations — the
token contract forbids palette changes to the callsign swatches, the iconography contract
enforces the plain-language labeling rule, and the quickstart's audits operationalize the
offline and contrast gates. All gates still pass.

## Project Structure

### Documentation (this feature)

```text
specs/002-material3-ui-redesign/
├── plan.md              # This file
├── research.md          # Phase 0: library posture, seed colour, mark, budget, type, icons, motion
├── data-model.md        # Phase 1: token roles, report-kind identities, status vocabulary, mark derivations
├── quickstart.md        # Phase 1: build + audit walkthrough proving the SCs
├── contracts/
│   ├── design-tokens.md # Token contract: names, tiers, floors, generation, prohibitions
│   └── iconography.md   # Icon inventory, label policy, CVD rules, bundling contract
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
web/
├── public/
│   ├── icon.svg                  # UPDATED: identity mark recolored to the new palette
│   ├── icon-192.png              # NEW: maskable PNG (Android launcher reliability)
│   ├── icon-512.png              # NEW: maskable PNG
│   ├── apple-touch-icon.png      # NEW: 180×180 opaque PNG
│   └── manifest.webmanifest      # UPDATED: icon entries, theme/background colours
├── index.html                    # UPDATED: favicon + touch-icon links, theme-color meta
├── scripts/
│   └── generate-tokens.mjs       # NEW: dev-time token generation from seed (output committed)
├── src/
│   ├── ui/
│   │   ├── tokens.css            # NEW: the M3 token set — single source of styling truth
│   │   ├── app.css               # REWRITTEN: components consume tokens only
│   │   ├── icons.ts              # NEW: bundled Material Symbols SVG subset + icon() helper
│   │   ├── join.ts               # UPDATED: markup for restyled join screen
│   │   ├── map-view.ts           # UPDATED: chips get icon + short label structure
│   │   ├── report-entry.ts       # UPDATED: sheet structure, kind icons, motion classes
│   │   ├── share.ts              # UPDATED: chip/icon structure
│   │   ├── target.ts             # UPDATED: chip/icon structure
│   │   ├── clock-warning.ts      # UPDATED: chip/icon structure
│   │   └── last-hunt.ts          # UPDATED: restyled notice
│   └── map/
│       ├── basemap.ts            # UPDATED: blank fallback style uses token colours
│       ├── layers.ts             # UPDATED: marker/wedge colours from the new palette
│       └── wedge.ts              # (geometry untouched)
└── tests/
    ├── unit/
    │   └── contrast.test.ts      # NEW: parses tokens.css, asserts 7:1/4.5:1/3:1 floors
    └── e2e/
        ├── targets.spec.ts       # NEW: every interactive element ≥ 56px, two viewports (SC-002)
        ├── reduced-motion.spec.ts# NEW: zero nonessential animation under the preference (SC-006)
        ├── network-audit.spec.ts # NEW: no runtime asset fetches beyond tiles (SC-009) + FR-014 invariants
        ├── report-redesign.spec.ts # NEW: US1 story spec — kind buttons, press states, sheet motion
        └── status-states.spec.ts # NEW: US2 story spec — transition graph, shape/icon distinguishability
```

**Structure Decision**: Existing single-project layout under `web/` is kept; the feature
adds one stylesheet, one icon module, one dev script, four brand assets, and four audit
tests. No new packages, no directory restructuring.

## Complexity Tracking

No constitution violations to justify. The one decision that *adds* anything —
`@material/material-color-utilities` — is confined to a dev-time script whose output is
committed, so the shipped app gains zero dependencies.
