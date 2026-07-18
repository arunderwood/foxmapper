# Quickstart: Validating the Visual Compass Dial

How to prove the dial meets its success criteria. Each section maps to the spec's SC numbers.
Interaction rules are in [contracts/bearing-entry.md](contracts/bearing-entry.md); the payload change
is in [contracts/log-format-delta.md](contracts/log-format-delta.md) and [data-model.md](data-model.md).

## Prerequisites

```bash
cd web
npm install          # no new runtime dependency is added by this feature
npm run build        # tsc --noEmit && vite build
```

The full stack (relay + Postgres) runs via `docker compose up` from the repo root when a live session
is needed; UI-only checks work against `npm run dev`. Playwright emulates device orientation, so the
compass paths are exercised without real hardware.

## SC-001 — Under 10 s, one-handed (semi-automated)

```bash
npm run test:e2e -- compass-dial
```

The story spec drives auto-live (Android emulation) → freeze → pick confidence + range → send, and
asserts the report appears. The ≤ 10 s budget is the same one feature 001 measures; the e2e proves
the path has no extra blocking step. The lived confirmation is a Field Validation item (deferred).

## SC-002 — A frozen bearing is stable (automated)

`compass-dial.spec.ts`: after freeze, emulate further orientation change and assert the displayed and
submitted heading do **not** move (0 sensor-driven changes to a frozen value — contract invariant 2).

## SC-003 — Recognized as a compass (field)

Deferred milestone: a hunter who owns a physical compass finds the freeze unprompted. Not automatable;
recorded as Field Validation.

## SC-004 — Twist to correct (automated)

`compass-dial.spec.ts`: freeze a known heading, drag the rose by a known angle, assert the committed
heading moved by that angle (within tolerance) and that the report carries the twisted value.

## SC-005 — No-compass, 0 keystrokes (automated)

`compass-dial.spec.ts` with orientation events unavailable: assert no start control is shown, set a
bearing by twisting alone, submit, and assert **0** keyboard input events occurred (dial-only entry).

## SC-006 / SC-008 — A bearing is a bearing (automated)

```bash
npm run test:unit -- report
npm run test:unit -- aprs
```

`report.test.ts`: a frozen, a twisted, and a typed bearing produce byte-identical payloads aside from
`heading_magnetic`, and the payload has exactly the retained keys — no `heading_source`,
no `compass_accuracy_deg`. A back-compat case feeds a legacy payload carrying the fields and asserts
it is accepted and the extra keys ignored. `aprs.test.ts` passes unchanged — proof the wire mapping
never depended on the removed fields (Principle V).

## SC-007 — Nothing sent unseen (automated)

Contract invariant 1: on open, `committed === undefined` and Send is disabled; `compass-dial.spec.ts`
asserts a freshly opened sheet cannot submit until a freeze or a twist, so no due-north default and no
unvouched value can be sent.

## SC-009 — Offline (automated)

```bash
npm run test:e2e -- network-audit
```

Extend the existing runtime-network audit to cover a full bearing entry (start/live, freeze, twist,
send-to-queue) with connectivity disabled; assert 0 network requests during the interaction.

## SC-010 — Accessible without the gesture (automated)

`compass-dial.spec.ts`: set a bearing via the numeric field alone (keyboard), submit, and assert the
report carries that value — the dial is an enhancement, the numeric field the accessible path.

## Reduced motion & touch targets (regression)

```bash
npm run test:e2e -- reduced-motion
npm run test:e2e -- targets
```

`reduced-motion`: the live dial still tracks and reads with flourishes suppressed (FR-020).
`targets`: the start/freeze control and the dial affordance are ≥ 56×56 px.

## Manual smoke (real device)

```bash
npm run dev   # open on a phone on the same network
```

Android: open Bearing entry — the rose should already be live. Point, freeze, twist a few degrees,
send. iOS: tap the start control first (permission prompt), then the same. On any phone, open and try
to send without touching the dial — Send stays disabled.
