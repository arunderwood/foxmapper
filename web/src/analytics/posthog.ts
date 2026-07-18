/**
 * Analytics: a thin, deliberately quiet wrapper around PostHog.
 *
 * The constitution treats a hunter's position and identity as the sensitive core of this app, and
 * this module is written so none of it can leak into an analytics vendor even by accident:
 *
 * - **Opt-out with teeth.** PostHog is never even loaded when the device says no. "No" means Do Not
 *   Track, Global Privacy Control, or the in-app switch in Settings — any one of them keeps the
 *   network silent and nothing is written to storage. There is no key in dev, so dev is silent too.
 * - **No PII, ever.** We author every event by hand with a fixed, reviewed property set — no
 *   callsign, coordinate, hunt code, frequency, or hunt label. Autocapture and session recording
 *   are off precisely because they would hoover up on-screen text and inputs we never vetted.
 * - **The hunt code cannot ride along.** The one place it sneaks in is the URL (`/h/<code>`), which
 *   PostHog attaches to events as `$current_url` and friends. `sanitizeProperties` redacts it to
 *   `/h/:code` before anything is sent — see {@link redactHuntCode}, which the unit tests pin.
 *
 * **The SDK is loaded lazily** — a dynamic `import()` inside {@link initAnalytics}, which only runs
 * when every gate is open. So the ~60 KB of PostHog is fetched only by a consenting device on a
 * keyed build; an opted-out hunter, and every keyless dev/CI build, never downloads it at all. That
 * matters for a PWA whose whole point is working with no coverage: the lean path stays lean.
 *
 * Every exported call is a no-op until the gate is open, so callers never have to guard. The app
 * depends on this silence: nothing here may block startup, a report, or the map — analytics is a
 * bystander to the local-first path, never a step in it.
 */
import type { PostHog } from 'posthog-js';

import { redactHuntCode } from './redact.js';

export { redactHuntCode } from './redact.js';

/** Baked in at build time by Vite. Absent in dev and CI → analytics stays off. */
const KEY = import.meta.env['VITE_PUBLIC_POSTHOG_KEY'] as string | undefined;
const HOST =
  (import.meta.env['VITE_PUBLIC_POSTHOG_HOST'] as string | undefined) ?? 'https://us.i.posthog.com';

/** Device-scoped opt-out, mirroring how Settings stores the relay switch — but synchronous, so the
 *  gate can be read before the IndexedDB log is open and early errors are still capturable. */
const OPT_OUT_KEY = 'foxmapper.analytics';

/** The loaded SDK, or undefined until the dynamic import resolves (or forever, if the gate is shut). */
let client: PostHog | undefined;
/** True from the moment we decide to load until an opt-out. Gates our own callers and the load race. */
let intended = false;
/** Events raised in the window between {@link initAnalytics} and the SDK finishing its load. */
const pending: Array<(ph: PostHog) => void> = [];

/** Redacts the hunt code out of every URL-shaped property PostHog attaches to an event. */
function sanitizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  for (const key of [
    '$current_url',
    '$pathname',
    '$referrer',
    '$referring_domain',
    '$initial_current_url',
    '$initial_pathname',
  ]) {
    const value = properties[key];
    if (typeof value === 'string') properties[key] = redactHuntCode(value);
  }
  return properties;
}

/**
 * True when the browser itself has asked not to be tracked.
 *
 * Do Not Track (in its several vendor spellings) and Global Privacy Control are honoured as a hard
 * no: no init, no toggle can override them. A device that signals this is never counted.
 */
function browserOptedOut(): boolean {
  const nav = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  const dnt =
    nav.doNotTrack ?? (window as Window & { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes') return true;
  return nav.globalPrivacyControl === true;
}

/** The device's own preference: on unless the switch was flipped off. Defaults to on. */
function userPreferenceOn(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== 'off';
  } catch {
    // No storage (private mode, storage disabled) → treat as no consent rather than guess yes.
    return false;
  }
}

/** Whether this build has analytics at all. A keyless build (dev, CI) has nothing to offer or show. */
export function analyticsConfigured(): boolean {
  return Boolean(KEY);
}

/** The switch is forced off and cannot be turned on here: no key configured, or the browser said no. */
export function analyticsForcedOff(): boolean {
  return !KEY || browserOptedOut();
}

/** What the Settings toggle should show as its current state. */
export function analyticsEnabled(): boolean {
  return !analyticsForcedOff() && userPreferenceOn();
}

/** Runs a call against the SDK now if it is loaded, or buffers it until it is — while consent holds. */
function withClient(fn: (ph: PostHog) => void): void {
  if (!intended) return;
  if (client) fn(client);
  else pending.push(fn);
}

/**
 * Loads PostHog — lazily, and only if every gate is open. Safe to call more than once.
 *
 * The config is a privacy posture, not tuning: autocapture and session recording off so nothing
 * on screen is scooped up unreviewed; automatic pageviews off because the URL carries the hunt
 * code; anonymous only (`person_profiles: 'identified_only'` with no `identify` call, ever).
 */
export function initAnalytics(): void {
  if (intended || analyticsForcedOff() || !userPreferenceOn()) return;
  intended = true;

  void import('posthog-js')
    .then(({ default: posthog }) => {
      // The switch may have been flipped off while the chunk was in flight — honour that, and load
      // nothing into a device that just said no.
      if (!intended) return;
      posthog.init(KEY as string, {
        api_host: HOST,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        respect_dnt: true,
        person_profiles: 'identified_only',
        // Error tracking (usage's other half): unhandled exceptions and rejections, captured as
        // $exception. The same sanitize pass runs over these, so a stack frame's URL is redacted too.
        capture_exceptions: true,
        persistence: 'localStorage',
        sanitize_properties: sanitizeProperties,
      });
      client = posthog;
      for (const fn of pending.splice(0)) fn(posthog);
    })
    .catch(() => {
      // A failed load is not a failed app. Give up quietly and stay silent for the session.
      intended = false;
      pending.length = 0;
    });
}

/** Records a usage event. No-op unless analytics is live. Props must be PII-free by construction. */
export function track(event: string, props?: Record<string, unknown>): void {
  withClient((ph) => ph.capture(event, props));
}

/** Records a handled error alongside the autocaptured unhandled ones. No-op unless analytics is live. */
export function captureError(error: unknown, props?: Record<string, unknown>): void {
  withClient((ph) => ph.captureException(error, props));
}

/**
 * Applies the Settings toggle. Persists the preference, then starts or stops the flow of events.
 *
 * Turning on when the browser has said no (DNT/GPC) or no key is configured does nothing — the
 * device signal and the deploy both outrank the switch. That is why the Settings UI shows the
 * control disabled in those cases rather than letting it lie.
 */
export function setAnalyticsEnabled(on: boolean): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, on ? 'on' : 'off');
  } catch {
    // Nothing persisted means nothing will init on the next load either — consistent, if lossy.
  }
  if (on) {
    if (!intended) initAnalytics();
    else client?.opt_in_capturing();
  } else {
    // Stop sending, drop any queued batch, and gate our own callers off for the rest of the session.
    // Setting `intended` false also aborts an in-flight load before it can init.
    intended = false;
    pending.length = 0;
    client?.opt_out_capturing();
  }
}

/**
 * Opens in-app feedback, collected through PostHog Surveys (docs/analytics.md: the survey is
 * configured in the PostHog dashboard to activate on this event, so its wording lives there, not
 * in the bundle). No-op unless analytics is live — a feedback channel that runs on the analytics
 * vendor honours the same opt-out.
 */
export function openFeedback(): void {
  track('feedback_opened');
}

/** Whether the feedback affordance can do anything — i.e. the SDK is loaded and consent holds. */
export function feedbackAvailable(): boolean {
  return client !== undefined && intended;
}
