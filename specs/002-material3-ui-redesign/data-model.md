# Data Model: Material 3 Expressive UI Redesign

**Date**: 2026-07-16 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

This feature has no persistence or wire-format changes. Its "data" is the design system:
four entities that every surface consumes. Names here are binding on implementation; exact
colour values are indicative pending the generation script, and are enforced by the
contrast-audit test rather than by this document.

## 1. Design token set (`web/src/ui/tokens.css`)

Single source of styling truth (FR-001). Three tiers:

**Reference tier** (generated from seed `#E2633C`, not consumed directly by components):
tonal palettes `--md-ref-palette-{primary,secondary,neutral,neutral-variant,error}-{0..100}`.
Only the steps actually referenced by the system tier are emitted (~30 values).

**System tier** (what components consume):

| Group | Tokens | Notes |
|---|---|---|
| Colour | `--md-sys-color-{surface, surface-container, surface-container-high, on-surface, on-surface-variant, outline, outline-variant, primary, on-primary, primary-container, on-primary-container, error, on-error-container, error-container}` | Dark scheme only; `color-scheme: dark` retained |
| Semantic extensions | `--fx-color-{warn, on-warn-container, warn-container, ok}` | FoxMapper statuses M3 doesn't name; same tonal method, `--fx-` prefix marks them as project extensions |
| Type scale | `--md-sys-typescale-{display, headline, title, body, label}-{size, weight, line-height, tracking}` | System font stack; body ≥ 16px; label ≥ 13px at 7:1 |
| Shape | `--md-sys-shape-corner-{none, small(8), medium(12), large(16), extra-large(28), full(999)}` | Sheet: extra-large top corners; chips: full; buttons: full; inputs: small |
| Motion | `--md-sys-motion-easing-{emphasized-decelerate, emphasized-accelerate, standard}`, `--md-sys-motion-duration-{short(150ms), medium(300ms), exit(200ms)}` | R7 |
| State | `--md-sys-state-{hover(8%), focus(10%), pressed(16%)}-opacity` | Pressed boosted for sunlight (R8) |
| Field constants | `--fx-touch: 56px`, `--fx-input-font: 16px` | Carried over verbatim; the invariants FR-013/FR-003 audit |

**Validation rules** (enforced by `web/tests/unit/contrast.test.ts` and review):

- Glanceable pairs (chip text, report-bar labels, warning/error text on their containers,
  button labels on filled buttons) ≥ 7:1; all other text ≥ 4.5:1; non-text UI ≥ 3:1.
- No component CSS may contain a raw colour, radius, duration, or easing — tokens only
  (SC-008). Legacy variables (`--bg`, `--surface`, `--surface-raised`, `--line`, `--text`,
  `--text-dim`, `--accent`, `--warn`, `--danger`, `--radius`) are deleted, not aliased.
- `--fx-touch` may only be consumed as a *minimum* (`min-height`/`min-width`).

## 2. Report-kind identity

The stable icon + colour + label triple per kind (FR-006), used identically in the report
bar, entry sheet headers, and map popups. Kind ids and label meanings are frozen
(spec assumption); label *phrasing* may be tuned under the microcopy clarification.

| Kind id | Label (current) | Icon (Material Symbols) | Hue token | Shape cue |
|---|---|---|---|---|
| `bearing` | Bearing | `explore` (compass needle) | `--fx-kind-bearing` (#FFB598) | needle/arrow |
| `omni` | Signal | `cell_tower` (radiating tower) | `--fx-kind-signal` (#88CCEE) | radiating arcs |
| `null` | Nothing here | `signal_disconnected` / crossed waves | `--fx-kind-null` (#DDCC77) | strike-through |
| `fix` | Found it | `flag` (planted flag) | `--fx-kind-fix` (#44AA99) | flag |

**Rules**: all four render at identical size and prominence (constitution II); shape is
the primary distinguisher, hue is reinforcement (FR-015); each button shows icon *above*
label — never icon-only (FR-007). Popups reuse the same triple so a marker's kind matches
the bar (US3 scenario 3).

## 3. Status vocabulary

The states the primary view must make glanceable (FR-010, FR-011), mapped from the chips
`map-view.ts` renders today. Each state is an icon + colour + shape triple; wording shown
is *indicative* short-label copy (microcopy is in scope).

| State | Today's text | Icon | Colour role | Container shape |
|---|---|---|---|---|
| `live` | "Showing everyone's reports" | `cloud_done` | `ok` on `surface-container` | full (pill) |
| `offline` | "No signal — showing only what this phone has" | `cloud_off` | `warn` on `warn-container` | medium (squarer = louder) |
| `queued(n)` | queue chip with count | `upload` + count | `warn` | pill with count badge |
| `draining(n)` | (same chip, decreasing) | `upload` + count + progress hairline | `primary` | pill; count visibly ticks down |
| `synced` | (chip disappears) | `cloud_done` flash then remove | `ok` | pill, brief confirmation before removal |
| `gps-ok` | position text | `my_location` | `on-surface` | pill |
| `gps-lost` | danger chip | `location_disabled` | `error` on `error-container` | medium |
| `tiles-off` | "Map background unavailable out here…" | `map` + strike | `on-surface-variant` | pill |
| `clock-skew` | clock warning | `schedule` | `warn` | medium |

**State transitions** (drive the peripheral-noticeability requirement, US2 scenario 2):

```
live ──connection lost──▶ offline ──reports filed──▶ offline+queued(n)
offline+queued(n) ──connection returns──▶ draining(n) ──n reaches 0──▶ synced ──2s──▶ live
gps-ok ◀──fix acquired/lost──▶ gps-lost        (independent axis)
tiles-off / clock-skew: independent, appear only when true
```

Every transition changes icon AND colour AND shape (never colour alone — FR-010);
`draining` must read as progress: count decreasing + determinate hairline, no spinner
(FR-011). Warnings keep full-wrap behavior — never truncated.

## 4. App identity mark

One source geometry (the bounded bearing wedge, evolved per R3) with derived renders:

| Derivation | Constraints |
|---|---|
| `icon.svg` | Master; wedge in primary family on `surface` ground; legible at 16 px |
| `icon-192.png` / `icon-512.png` | Maskable: mark within the 80% safe zone, `surface` bleed to edges |
| `apple-touch-icon.png` | 180×180, opaque, no transparency, slightly larger mark (iOS rounds corners itself) |
| `manifest.webmanifest` | `theme_color` = `background_color` = final `surface` value |
| `index.html` | `<link rel="icon" href="/icon.svg">`, `<link rel="apple-touch-icon" …>`, `<meta name="theme-color">` matching |

**Relationships**: mark colours are the token values (the mark may not introduce hues the
token set doesn't have); manifest colours must equal `--md-sys-color-surface` exactly
(SC-010's home-screen coherence).

## Frozen (explicitly not modelled here)

- **Per-callsign hunter palette** — Paul Tol "muted" 9-swatch table in
  `docs/log-format.md`. Wire-contract data, not a UI token. Any change is a log-format
  amendment, out of scope for this feature.
- Report/log schema, queue records, session model — untouched.
