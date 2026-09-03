/**
 * The hunt menu: reached from the hunt-name chip, home to the per-device switches AND the one action
 * that is about the hunt — leaving it to start another.
 *
 * The switches are device-scoped and outlive any one hunt. Relay is the first — net control's tool;
 * for every other hunter its affordances are clutter on a screen that should read as an instrument,
 * so it ships off and is switched on here, per device (the meta store is device-scoped, deliberately
 * not keyed by hunt: net control at the club's desk is net control for every hunt they open).
 *
 * "Start a new hunt" is the exception that earns its place here: a hunter is in one hunt at a time,
 * and this is the clean handoff out of the current one — the only path from inside a hunt back to the
 * create screen.
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
import { declinationAt, describeDeclination } from '../sensors/declination.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { huntLink } from './last-hunt.js';
import { dismissSheet } from './report-entry.js';
import { copyHuntLink } from './share.js';

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
  /** Leave the current hunt and go to the create screen. Confirmed here; the caller tears down. */
  onStartNewHunt: () => void;
  /** The current hunt's code, so the confirmation can hand back its link before you leave. */
  huntCode: string;
  /** The current hunt's name, for the confirmation copy. Undefined until the target has loaded. */
  huntLabel?: string | undefined;
  /**
   * Where this device is — hand-placed outranking measured, the same rule a report uses — for the
   * local true/magnetic detail (005 FR-010). Undefined when there is no position, and the section
   * says so rather than disappearing: an absent section is a mystery, an explained one is not.
   */
  position?: { lat: number; lon: number } | undefined;
  db: FoxmapperDb;
}

/**
 * The on-demand corner of 005: the one place declination is spoken about, in plain words,
 * computed on-device at sheet-open. Never in the way of any reporting flow (FR-010/FR-011).
 */
function northSection(position: { lat: number; lon: number } | undefined): HTMLElement {
  if (!position) {
    return el(
      'p',
      { class: 'small dim', 'data-testid': 'north-note' },
      'Set where you are to see the local difference between true and magnetic north.',
    );
  }
  const declination = declinationAt(position.lat, position.lon);
  return el(
    'div',
    { class: 'north-note', 'data-testid': 'north-note' },
    el('p', {}, describeDeclination(declination)),
    el(
      'p',
      { class: 'small dim' },
      'Bearings on the map are true north; a handheld compass reads magnetic.',
    ),
  );
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

  // The one action here that acts on the hunt rather than the device. Settings closes first, then the
  // confirmation goes up over the live map — leaving is a decision, and it names what you leave.
  const startNewHunt = el(
    'button',
    { type: 'button', 'data-testid': 'start-new-hunt' },
    icon('add', { label: 'Start a new hunt' }),
    el('span', {}, 'Start a new hunt'),
  );
  startNewHunt.addEventListener('click', () => {
    onClose();
    confirmStartNewHunt(options);
  });
  const startNewHuntSection = el(
    'div',
    { class: 'sheet-leave' },
    startNewHunt,
    el(
      'p',
      { class: 'small dim' },
      'Leaves this hunt for the create screen. This hunt keeps running — come back with its link.',
    ),
  );

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
    northSection(options.position),
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

  // Last, and set apart: leaving the hunt is a different kind of act from the device switches above.
  panel.append(startNewHuntSection);

  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose();
  });
  return backdrop;
}

/**
 * The confirmation before leaving: leaving forgets the hunt on this device, so it names the hunt and
 * hands back its link first. The hunt is not destroyed — its log stays here and it stays live on the
 * server — but a hunter who has not saved the link needs it now, not after they have gone.
 */
function confirmStartNewHunt(options: SettingsOptions): void {
  const label = options.huntLabel ?? 'this hunt';
  const backdrop = el('div', { class: 'sheet-backdrop', 'data-testid': 'new-hunt-confirm' });
  const dismiss = (): void => dismissSheet(backdrop);

  const linkText = el(
    'code',
    { class: 'link-copyable', 'data-testid': 'leave-hunt-link' },
    huntLink(options.huntCode),
  );
  const status = el('span', {
    class: 'small dim',
    'data-testid': 'copy-link-status',
    role: 'status',
  });
  const copyLink = el(
    'button',
    { type: 'button', 'data-testid': 'copy-link' },
    icon('share', { label: 'Copy link' }),
    el('span', {}, 'Copy link'),
  );
  copyLink.addEventListener('click', () => {
    void copyHuntLink(options.huntCode, status);
  });

  const close = el(
    'button',
    { type: 'button', class: 'icon-button', 'data-testid': 'close-new-hunt-confirm' },
    icon('close'),
  );
  close.addEventListener('click', dismiss);

  const cancel = el('button', { type: 'button', 'data-testid': 'cancel-new-hunt' }, 'Cancel');
  cancel.addEventListener('click', dismiss);

  const confirm = el(
    'button',
    { type: 'button', class: 'primary', 'data-testid': 'confirm-new-hunt' },
    'Start a new hunt',
  );
  confirm.addEventListener('click', () => {
    dismiss();
    options.onStartNewHunt();
  });

  const panel = el(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': 'Start a new hunt' },
    el(
      'header',
      { class: 'sheet-header' },
      icon('add', { label: 'Start a new hunt' }),
      el('h2', {}, 'Start a new hunt'),
      close,
    ),
    el('p', {}, `Leave “${label}” and start a new one?`),
    el('p', { class: 'small dim' }, 'It keeps running — come back to it with its link:'),
    linkText,
    copyLink,
    status,
    el('div', { class: 'sheet-actions' }, cancel, confirm),
  );

  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) dismiss();
  });
  document.body.append(backdrop);
}

/** Opens settings over whatever is showing; exits through the shared sheet motion. */
export function openSettings(options: SettingsOptions): void {
  const node = settingsSheet(options, () => dismissSheet(node));
  document.body.append(node);
}
