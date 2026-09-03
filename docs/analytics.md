# Analytics & feedback

FoxMapper sends **anonymous, opt-out** usage and error analytics to [PostHog](https://posthog.com),
and collects optional feedback through the same platform. This page is the whole of what leaves a
device and what never does. If the code and this page disagree, that is a defect in one of them —
please say so. The implementation is a single, small module: [`web/src/analytics/posthog.ts`](../web/src/analytics/posthog.ts).

The app is local-first and offline-first by constitution. Analytics is a **bystander** to that: it
never blocks startup, a report, or the map, and a device with no coverage loses nothing by it.

---

## What is never sent

By construction — not by policy that could quietly change — an event never carries:

- a **callsign** or participant id (the app never calls PostHog's `identify`; users are anonymous),
- a **position** or coordinate of any kind,
- a **hunt code**, including the `/h/<code>` in the URL, which is redacted to `/h/:code` before any
  event leaves the device (`redactHuntCode`, pinned by a unit test),
- a hunt's **frequency** or **label**,
- the **content** of any report or text field.

This is why **autocapture and session replay are switched off**: both would scoop up on-screen text
and inputs that were never reviewed against the list above.

## What is sent

Anonymous counts, hand-authored one event at a time, with a fixed and reviewed property set:

| Event | Properties | Meaning |
|---|---|---|
| `app_opened` | `screen` = `start` \| `join` \| `hunt` | Where a load landed. |
| `hunt_created` | — | A hunt was started. |
| `hunt_joined` | — | A device joined a hunt. |
| `report_submitted` | `kind`, `source` (`own`/`relayed`), `position_source` (`measured`/`placed`) | A report was filed — its shape, never its place or content. |
| `report_retracted` | — | A report was withdrawn. |
| `position_placed` | — | A hunter set their position by hand (that they did, never where). |
| `relay_mode_toggled` | `enabled` | Net-control relay mode switched. |
| `tiles_unavailable` | — | The basemap could not load (a degradation signal). |
| `tour_offered` / `tour_accepted` / `tour_declined` / `tour_completed` / `tour_exited` | `from_offer` (on exit) | First-visit tour funnel. |
| `feedback_opened` | — | The feedback affordance was used (see below). |
| `$exception` | stack, message (URL-redacted) | Unhandled and handled errors, via PostHog error tracking. |

## Consent, and how to say no

Analytics is **on by default but always refusable**, and three independent gates can each keep it
fully off — no PostHog code even loads, no network call is made, nothing is written to storage:

1. **Do Not Track / Global Privacy Control.** If the browser sends either signal, analytics is off
   and the Settings toggle is shown disabled. The browser's word is final.
2. **The Settings toggle.** **Settings → Anonymous analytics** turns it off (and back on) per device.
   Turning it off stops sending immediately and drops any queued batch.
3. **No key configured.** A build without `VITE_PUBLIC_POSTHOG_KEY` — every local dev build and CI
   run by default — has analytics off. See [Configuration](#configuration).

## Feedback

Feedback is collected through **PostHog Surveys**, so its questions live in the PostHog dashboard,
not in the app bundle. **Settings → Send feedback** captures a `feedback_opened` event; a survey
configured in PostHog to activate on that event then shows in-app. Because it runs on the analytics
vendor, the feedback affordance is hidden whenever analytics is off — it honours the same opt-out.

To wire it up in PostHog: create a survey, set its display condition to activate when the event
`feedback_opened` is received, and publish it.

## Analytics under the Content-Security-Policy

The app is served with a restrictive CSP (`server/src/security.rs`), and PostHog's default
behaviour does not fit inside it: the SDK lazy-loads error tracking and surveys as `<script>` tags
from `us-assets.i.posthog.com` at runtime, and `script-src` names no origin but our own. PostHog's
own answer is to bundle them, which is what [`web/src/analytics/posthog.ts`](../web/src/analytics/posthog.ts)
does — `posthog-js/dist/module.no-external` plus explicit imports of the two extensions in use.

Three consequences worth knowing before changing anything here:

- **A new PostHog feature usually needs a new import.** Session replay, the toolbar and dead-click
  autocapture each arrive as their own remote script. Enabling one in the config without importing
  it fails silently in production and in no test — analytics is off in dev and CI.
- **The policy names the US hosts.** `connect-src` allows `us.i.posthog.com` (events, feature flags)
  and `us-assets.i.posthog.com` (project config, fetched as JSON). Pointing
  `VITE_PUBLIC_POSTHOG_HOST` at the EU region means editing the policy in `server/src/security.rs`
  **and** `web/vite.config.ts` to match, or every analytics request is blocked.
- **A survey renders unstyled.** PostHog builds its survey UI with a `<style>` element, which
  `style-src 'self'` blocks; the survey still works, but arrives without its CSS. Fixing it properly
  needs a per-response nonce, which a static `index.html` served straight off disk cannot mint.

## Configuration

Two build-time Vite variables (see [`web/.env.example`](../web/.env.example)):

| Variable | Required | Default | Notes |
|---|---|---|---|
| `VITE_PUBLIC_POSTHOG_KEY` | no | _(unset → off)_ | Project API key (`phc_…`), safe to ship in a browser bundle. |
| `VITE_PUBLIC_POSTHOG_HOST` | no | `https://us.i.posthog.com` | Set to `https://eu.i.posthog.com` for the EU region. |

Because Vite bakes env at build time, these are set for the production image via Render — the
[`Dockerfile`](../Dockerfile) declares matching build `ARG`s and [`render.yaml`](../render.yaml)
supplies the key as a dashboard secret. Local development picks them up from a git-ignored
`web/.env.local`.
