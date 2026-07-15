/**
 * Joining: open the link, pick a callsign, report.
 *
 * **No account, no install, no payment, and no round-trip.** There is no join endpoint to call —
 * the device mints its own id and keeps it. Everything below works with the network already gone,
 * which is why a participant who loaded the link in the car park can still join on the hilltop.
 */
import { join } from '../log/identity.js';
import type { FoxmapperDb } from '../log/store.js';
import { el } from './dom.js';
import { limitsNotice } from './limits.js';
import type { Target } from './target.js';

export interface JoinOptions {
  db: FoxmapperDb;
  huntCode: string;
  /** Undefined when the hunt could not be fetched — offline, or a dead code. */
  target: Target | undefined;
  onJoined: (callsign: string) => void;
}

export function joinScreen(options: JoinOptions): HTMLElement {
  const input = el('input', {
    id: 'callsign',
    name: 'callsign',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: 'KI7XYZ',
    'data-testid': 'callsign-input',
  });

  const submit = el(
    'button',
    { type: 'submit', class: 'primary', 'data-testid': 'join-button' },
    'Start reporting',
  );

  const form = el(
    'form',
    { class: 'stack', 'data-testid': 'join-form' },
    el('label', { for: 'callsign' }, 'Your callsign'),
    input,
    submit,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const callsign = input.value.trim();
    if (!callsign) {
      input.focus();
      return;
    }
    // Nothing here awaits the network. Joining is a purely local act.
    void join(options.db, callsign).then((identity) => options.onJoined(identity.callsign));
  });

  return el(
    'div',
    { class: 'screen', 'data-testid': 'join-screen' },
    el('h1', {}, 'FoxMapper'),
    // The target is shown before any report arrives, so a joining hunter knows what they are
    // chasing. Offline, it is simply absent — which does not block joining.
    options.target
      ? el(
          'p',
          { class: 'dim', 'data-testid': 'join-target' },
          `${options.target.label}${options.target.frequency ? ` · ${options.target.frequency}` : ''}`,
        )
      : el('p', { class: 'dim' }, `Hunt ${options.huntCode}`),
    form,
    el('p', { class: 'small dim' }, 'No account. No app to install. Your callsign stays on your phone.'),
    limitsNotice(),
  );
}
