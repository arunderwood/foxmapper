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
  );

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
