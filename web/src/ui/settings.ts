/**
 * Settings: the pane for the switches that are about THIS DEVICE, not the hunt.
 *
 * One resident so far — relay mode. Relay is net control's tool; for every other hunter its
 * affordances are clutter on a screen that should read as an instrument, so it ships off and
 * is switched on here, per device (the meta store is device-scoped, deliberately not keyed by
 * hunt: net control at the club's desk is net control for every hunt they open).
 */
import type { FoxmapperDb } from '../log/store.js';
import { getMeta, setMeta } from '../log/store.js';
import {
  analyticsConfigured,
  analyticsEnabled,
  analyticsForcedOff,
  feedbackAvailable,
  openFeedback,
  setAnalyticsEnabled,
} from '../analytics/posthog.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { dismissSheet } from './report-entry.js';

const RELAY_MODE_KEY = 'relay_mode';

export async function loadRelayMode(db: FoxmapperDb): Promise<boolean> {
  return (await getMeta<boolean>(db, RELAY_MODE_KEY)) === true;
}

export interface SettingsOptions {
  relayMode: boolean;
  /** Fired on every toggle; the caller owns app state and re-render. Persistence happens here. */
  onRelayMode: (enabled: boolean) => void;
  /** Relaunch the first-visit tour on demand (FR-003). Settings closes first, then the tour runs. */
  onReplayTour: () => void;
  db: FoxmapperDb;
}

export function settingsSheet(options: SettingsOptions, onClose: () => void): HTMLElement {
  const toggle = el(
    'button',
    {
      type: 'button',
      'aria-pressed': String(options.relayMode),
      'data-testid': 'relay-mode-toggle',
    },
    icon('record_voice_over', { label: 'Relay mode' }),
    el('span', {}, 'Relay mode'),
  );
  toggle.addEventListener('click', () => {
    const enabled = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(enabled));
    void setMeta(options.db, RELAY_MODE_KEY, enabled);
    options.onRelayMode(enabled);
  });

  // The relaunch affordance (FR-003): the tour is never a one-time thing. Closing settings first
  // means the tour runs over the live hunt view, not over the settings sheet.
  const replayTour = el(
    'button',
    { type: 'button', 'data-testid': 'replay-tour' },
    icon('explore', { label: 'Take the tour' }),
    el('span', {}, 'Take the tour'),
  );
  replayTour.addEventListener('click', () => {
    onClose();
    options.onReplayTour();
  });

  const close = el(
    'button',
    { type: 'button', class: 'icon-button', 'data-testid': 'close-settings' },
    icon('close'),
  );
  close.addEventListener('click', onClose);

  const backdrop = el('div', { class: 'sheet-backdrop', 'data-testid': 'settings-sheet' });
  const panel = el(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': 'Settings' },
    el(
      'header',
      { class: 'sheet-header' },
      icon('settings', { label: 'Settings' }),
      el('h2', {}, 'Settings'),
      close,
    ),
    toggle,
    el(
      'p',
      { class: 'small dim' },
      'Relay mode is for net control: it adds a way to file reports for hunters calling theirs ' +
        'in over the radio.',
    ),
    replayTour,
  );

  // The analytics section exists only in a build that was given a PostHog key — a keyless dev or CI
  // build has no analytics to control, so it shows nothing rather than a dead switch. Within a keyed
  // build, `forcedOff` means exactly one thing: the browser sent Do Not Track / GPC.
  if (analyticsConfigured()) {
    const forcedOff = analyticsForcedOff();

    // Feedback rides the same vendor as analytics, so it is only offered while analytics is live.
    const feedback = el(
      'button',
      {
        type: 'button',
        'data-testid': 'send-feedback',
        ...(feedbackAvailable() ? {} : { hidden: 'true' }),
      },
      icon('send', { label: 'Send feedback' }),
      el('span', {}, 'Send feedback'),
    );
    feedback.addEventListener('click', () => {
      onClose();
      openFeedback();
    });

    // Anonymous, opt-out usage and error analytics. Shown disabled under Do Not Track / GPC so the
    // control never lies about what it can do. Nothing here carries a callsign, position, hunt code,
    // or frequency — see docs/analytics.md.
    const analyticsToggle = el('button', {
      type: 'button',
      'aria-pressed': String(analyticsEnabled()),
      'data-testid': 'analytics-toggle',
      ...(forcedOff ? { disabled: 'true' } : {}),
    });
    analyticsToggle.append(
      icon('cell_tower', { label: 'Anonymous analytics' }),
      el('span', {}, 'Anonymous analytics'),
    );
    analyticsToggle.addEventListener('click', () => {
      if (forcedOff) return;
      const on = analyticsToggle.getAttribute('aria-pressed') !== 'true';
      analyticsToggle.setAttribute('aria-pressed', String(on));
      setAnalyticsEnabled(on);
      // When analytics goes off, feedback goes with it.
      feedback.toggleAttribute('hidden', !feedbackAvailable());
    });

    const analyticsNote = el(
      'p',
      { class: 'small dim' },
      forcedOff
        ? 'Your browser has asked apps not to track it, so this stays off.'
        : 'Anonymous counts of what gets used and what breaks. No callsign, position, hunt code, ' +
            'or frequency is ever sent. Off honours Do Not Track automatically.',
    );

    panel.append(analyticsToggle, analyticsNote, feedback);
  }

  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose();
  });
  return backdrop;
}

/** Opens settings over whatever is showing; exits through the shared sheet motion. */
export function openSettings(options: SettingsOptions): void {
  const node = settingsSheet(options, () => dismissSheet(node));
  document.body.append(node);
}
