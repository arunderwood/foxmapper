# Quickstart: Validating the Material 3 Expressive UI Redesign

How to prove the redesign meets its measured success criteria. Each section maps to the
spec's SC numbers; contracts and role names are in
[contracts/design-tokens.md](contracts/design-tokens.md) and
[data-model.md](data-model.md).

## Prerequisites

```bash
cd web
npm install          # adds @material/material-color-utilities (dev only)
npm run build        # tsc --noEmit && vite build
```

The full stack (relay + Postgres) runs via `docker compose up` from the repo root when a
live session is needed; UI-only checks work against `npm run dev`.

## SC-001 — Contrast (automated)

```bash
npm run test:unit -- contrast
```

`tests/unit/contrast.test.ts` parses `src/ui/tokens.css` and asserts every pair in the
token contract: glanceable ≥ 7:1, body ≥ 4.5:1, non-text ≥ 3:1. Expected: all pass; the
tightest pair (`on-primary`/`primary`) has < 0.8 margin, so palette tweaks show up here
first.

## SC-002 — Touch targets (automated)

```bash
npm run test:e2e -- targets
```

Walks join screen, map view, all four report sheets, a popup, and each banner/notice;
asserts every element matching the interactive selector set has a bounding box ≥ 56×56 px.

## SC-006 — Reduced motion (automated)

```bash
npm run test:e2e -- reduced-motion
```

Runs the same walk with `prefers-reduced-motion: reduce` emulated; asserts no element
reports a running animation/transition longer than 50 ms and that every sheet/chip state
change still completes.

## SC-009 — No runtime asset fetches (automated)

```bash
npm run test:e2e -- network-audit
```

Drives join → report → offline (context.setOffline) → reconnect → drain while recording
every request; asserts nothing but the app origin's bundle files and
`tiles.openfreemap.org` appears, and specifically zero font/icon/image requests to any
other origin.

## SC-003 / FR-017 — Bundle and load budget

```bash
npm run build
for f in dist/assets/*; do printf "%s gzip=%sB\n" "$f" "$(gzip -c "$f" | wc -c)"; done
```

Pass: total gzip (JS + CSS + index.html) ≤ **330 KB** (baseline 2026-07-16: ~304 KB;
redesign delta ≤ 20 KB). Load time: `npm run preview`, then in Chrome DevTools apply
"Slow 3G" + 4× CPU throttle, hard-reload, confirm join screen interactive ≤ **10 s** and
≤ 120% of the same measurement on `main`.

## SC-007 — Status vocabulary glanceability

With the dev server and a joined session:

1. DevTools → Network → Offline. The sync chip must change icon + colour + shape
   (pill → squarer warn container) without any tap.
2. File two reports offline; the queued chip shows `upload` + count.
3. Network → Online. The chip becomes draining (primary colour, count ticking down,
   progress hairline), then flashes synced and returns to live. It must read as progress —
   no spinner, no error styling.
4. Re-run the walk with DevTools "Emulate vision deficiencies" → achromatopsia: every pair
   of states must remain distinguishable (icon and shape carry it).

## SC-010 — Identity mark on tab and home screen

1. Browser tab shows the evolved wedge favicon (`icon.svg`).
2. iOS Safari → Share → Add to Home Screen: opaque 180×180 wedge, `surface` ground.
3. Android Chrome → Add to Home screen: maskable wedge survives circular masking (mark
   inside the 80% safe zone). Manifest `theme_color` matches the app's `surface`.

## SC-004 / SC-005 — First-time hunter tests (manual, convenience testers)

Hand a phone with an active session to someone who has never seen the app:

- **SC-004**: "File a report of what you're hearing." Pass: 4 of 5 testers submit within
  60 s, unaided.
- **SC-005**: point at the four report buttons before any tap: "what does each do?" Pass:
  4 of 5 name all four meanings from icon + label.

Record results in `findings.md` (they also feed the deferred field-validation milestones).

## SC-008 — Token audit

```bash
grep -rn --include='*.css' -E '#[0-9a-fA-F]{3,8}\b' web/src | grep -v tokens.css
grep -rn -E 'var\(--(bg|surface|surface-raised|line|text|text-dim|accent|warn|danger|radius|touch|mono)\)' web/src
```

Both greps must return nothing: no raw colours outside `tokens.css`, no legacy variables
anywhere.
