/**
 * Arming a relay: net control's flow, restructured (feedback round 2).
 *
 * The old design buried "whose report is this?" inside every report sheet. Now it works like
 * hand-placement: say who and where FIRST — a pin drops at their position — then file the
 * report exactly as normal. One report per arming, so each relayed report is a deliberate act,
 * and the half-filled middle state that used to threaten SC-011 is unrepresentable: a target
 * either armed with complete, validated details, or does not exist.
 *
 * Only reachable in relay mode (settings.ts) — for everyone else this flow, and every relay
 * affordance, simply does not exist.
 */
import type { RelayDetails } from '../report/relay.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { dismissSheet } from './report-entry.js';

/** A coordinate the operator actually typed, or undefined. Never a number they did not.
 *
 * `Number('')` is 0, not NaN — which is how a blank field once became a report at Null Island.
 * The emptiness check comes first and the range check is real. */
function coordinate(input: HTMLInputElement, limit: number): number | undefined {
  const raw = input.value.trim();
  if (raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return undefined;
  return value;
}

/**
 * The arming sheet: their callsign, where they were, how stale the call is. "Ready" stays
 * disabled until every claim is complete and sane — the button being dead IS the validation
 * message, in the same place the thumb already is.
 */
export function relaySheet(
  onReady: (details: RelayDetails) => void,
  onClose: () => void,
): HTMLElement {
  const callsign = el('input', {
    type: 'text',
    autocapitalize: 'characters',
    placeholder: 'KI7XYZ',
    'data-testid': 'relay-callsign',
    'aria-label': 'Their callsign',
  });
  const lat = el('input', {
    type: 'number',
    step: 'any',
    placeholder: 'Latitude',
    'data-testid': 'relay-lat',
    'aria-label': 'Their latitude',
  });
  const lon = el('input', {
    type: 'number',
    step: 'any',
    placeholder: 'Longitude',
    'data-testid': 'relay-lon',
    'aria-label': 'Their longitude',
  });

  // FR-007: the log records when the observation was *taken*, not when it was typed. On the
  // relay path those are never the same moment. Zero — "just now" — is a claim the operator
  // makes, not a default standing in for an answer nobody gave.
  const minutesAgo = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: '0',
    step: '1',
    value: '0',
    'data-testid': 'relay-minutes-ago',
    'aria-label': 'How many minutes ago they heard it',
  });

  const ready = el(
    'button',
    { type: 'button', class: 'primary', disabled: true, 'data-testid': 'relay-ready' },
    'Report for them',
  );

  const complete = (): RelayDetails | undefined => {
    const cs = callsign.value.trim();
    const latitude = coordinate(lat, 90);
    const longitude = coordinate(lon, 180);
    if (!cs || latitude === undefined || longitude === undefined) return undefined;
    const minutes = Math.max(0, Number(minutesAgo.value) || 0);
    return {
      observerCallsign: cs,
      observerPosition: { lat: latitude, lon: longitude },
      observedAt: Date.now() - minutes * 60_000,
    };
  };

  for (const input of [callsign, lat, lon, minutesAgo]) {
    input.addEventListener('input', () => ready.toggleAttribute('disabled', !complete()));
  }

  ready.addEventListener('click', () => {
    const details = complete();
    if (!details) return;
    onReady(details);
    onClose();
  });

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', onClose);

  const backdrop = el('div', { class: 'sheet-backdrop', 'data-testid': 'relay-sheet' });
  const close = el(
    'button',
    { type: 'button', class: 'icon-button', 'data-testid': 'close-relay-sheet' },
    icon('close'),
  );
  close.addEventListener('click', onClose);

  const title = 'Report for someone else';
  const panel = el(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': title },
    el(
      'header',
      { class: 'sheet-header relay-header' },
      icon('record_voice_over', { label: title }),
      el('h2', {}, title),
      close,
    ),
    el(
      'p',
      { class: 'small dim' },
      'For a report heard over the radio: it files under their callsign, from where they were. ' +
        'A pin marks their spot until you send it.',
    ),
    el('label', {}, 'Their callsign'),
    callsign,
    // Set by hand: net control is not standing where the observer is, and their GPS says
    // nothing about where the observation was taken from.
    el('label', {}, 'Where they were'),
    lat,
    lon,
    el('label', {}, 'How long ago did they hear it? (minutes)'),
    minutesAgo,
    el('div', { class: 'sheet-actions' }, cancel, ready),
  );

  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose();
  });
  return backdrop;
}

/** Convenience: open the arming sheet, resolving through dismissSheet for the exit motion. */
export function openRelaySheet(onReady: (details: RelayDetails) => void): void {
  const node = relaySheet(onReady, () => dismissSheet(node));
  document.body.append(node);
}
