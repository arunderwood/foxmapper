# The design system, briefly

FoxMapper's interface is styled by one file: [`web/src/ui/tokens.css`](../web/src/ui/tokens.css)
— a Material 3 Expressive token set (dark scheme only) seeded from fox rust `#E2633C`, the
colour of the bearing wedge in the identity mark. Everything else consumes
`var(--md-sys-*)` / `var(--fx-*)`; no other file may define a colour, radius, duration, or
easing. TypeScript that paints outside CSS (map labels, the blank basemap ground) reads
tokens at runtime through `cssToken()` in `web/src/ui/dom.ts`.

The rules, floors, and change discipline live in
[`specs/002-material3-ui-redesign/contracts/design-tokens.md`](../specs/002-material3-ui-redesign/contracts/design-tokens.md);
the icon inventory and the icon-labeling policy in
[`contracts/iconography.md`](../specs/002-material3-ui-redesign/contracts/iconography.md).
Read both before touching a token or adding an icon.

What keeps it honest:

- `web/tests/unit/contrast.test.ts` parses tokens.css and enforces the floors — 7:1 for
  glanceable elements (the sunlight tier), 4.5:1 body, 3:1 non-text. A palette tweak answers
  to it before it answers to taste.
- `web/tests/e2e/targets.spec.ts`, `reduced-motion.spec.ts`, `network-audit.spec.ts` enforce
  the field invariants: 56 px touch targets at two viewports, zero animation under
  `prefers-reduced-motion`, zero runtime asset fetches beyond map tiles, no pull-to-refresh,
  attribution clear of the report bar.

Regenerating: `node web/scripts/generate-tokens.mjs && npx prettier --write web/src/ui/tokens.css`
rebuilds the reference tier from the seed; the marked HAND-TUNED block survives verbatim and
the prettier pass keeps the file byte-stable across regenerations. The output is committed —
the script is a convenience, not a dependency.

**Never restyled here**: the per-callsign hunter palette in `web/src/log/colour.ts`. It is
wire format ([`docs/log-format.md`](log-format.md)), guaranteed identical on every device,
and the map's blank fallback ground stays light specifically so those swatches remain
legible when the streets never arrive.
