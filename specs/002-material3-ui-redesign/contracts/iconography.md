# Contract: Iconography

**Producer**: `web/src/ui/icons.ts` — SVG path data for a hand-picked Material Symbols
(Rounded, filled) subset, Apache 2.0, attributed in the module header. **Consumers**: all
UI modules. Icons ship in the JS bundle; adding an icon is a code change, never a fetch
(FR-008, SC-009).

## Inventory (~16)

| Icon | Used for | Label policy |
|---|---|---|
| `explore` | Bearing report kind | Labeled ("Bearing") |
| `cell_tower` | Signal report kind | Labeled ("Signal") |
| `signal_disconnected` | Nothing-here report kind | Labeled ("Nothing here") |
| `flag` | Found-it report kind | Labeled ("Found it") |
| `cloud_done` | live / synced status | **Icon-only allowed** (scope in `aria-label`) |
| `cloud_off` | offline status | **Icon-only allowed** (scope in `aria-label`) |
| `upload` | queued / draining status | Labeled (count) |
| `my_location` | GPS fix ok; locate-me action | **Icon-only allowed** (universal) |
| `location_disabled` | GPS lost | Labeled |
| `map` (with strike) | tiles unavailable | Labeled |
| `schedule` | clock skew warning | Labeled |
| `share` | share hunt action | **Icon-only allowed** (universal) |
| `close` | dismiss sheet/popup | **Icon-only allowed** (universal) |
| `warning` | uncertainty / generic warnings | Labeled (the warning text) |
| `send` | submit report | Labeled ("Send") — primary action never icon-only |
| `edit_location` | set-position-by-hand; the placed-position pin | Labeled (pin decorative — the chip carries the words) |
| `record_voice_over` | relay: mode toggle, arming flow, armed chip, observer pin | Labeled (pin decorative — the armed chip carries the words) |
| `settings` | the hunt menu (settings + start a new hunt), reached from the hunt-name chip | Labeled by the hunt name it sits beside; **icon-only allowed** (universal) elsewhere |
| `add` | start a new hunt (from the hunt menu) | Labeled ("Start a new hunt") |

## Rules

1. **Label policy is the constitution's plain-language principle operationalized**
   (FR-007): only `close`, `share`, `my_location`, `settings`, and the two sync-status glyphs
   (`cloud_done`, `cloud_off`) may ever appear without a visible text label. Everything else pairs
   icon + short hunter-language label. A new icon enters the icon-only list only by demonstrating
   universality (a first-time hunter names its meaning unprompted — same 4-of-5 bar as SC-005).
   The sync pair is admitted on a different basis: the cloud-with-check / cloud-with-slash contrast
   is the universally-read online/offline idiom, and carrying the *scope* it stands for
   ("everyone's reports" vs "this phone only", FR-018) is the job of the chip's `aria-label`, not a
   visible caption that repeated in words what the icon and its colour already say.
2. **Shape before colour** (FR-015): the four report-kind icons must be distinguishable as
   silhouettes. Hue (from `--fx-kind-*`) is reinforcement. The contract test for this is
   SC-007's "distinguishable with colour removed" check applied to the report bar.
3. **Accessibility**: the `icon()` helper renders `aria-hidden="true"` whenever a visible
   label is present (the label carries the name); icon-only affordances carry
   `aria-label`. Icon glyphs never shrink the 56 px target: the *button* is the target,
   the glyph is ≥ 24 px within it.
4. **No icon fonts, no sprite fetches, no CDN** — inline SVG only (FR-008). The e2e
   network audit (SC-009) is the enforcement.
5. **Size discipline**: the subset must stay hand-picked; the module has a soft ceiling of
   ~5 KB gzipped, checked in the bundle-budget step of the quickstart. Importing a
   generated full icon set is a contract violation.
