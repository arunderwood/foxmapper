/**
 * Report entry.
 *
 * **All four kinds are reachable from one place and none is presented as lesser** (FR-005d). That
 * is Principle II as a layout decision: a hunter with a stock antenna filing "I hear nothing here"
 * is not making a second-class contribution, and a UI that buried it under a menu would say they
 * were.
 *
 * **Under ten seconds is the requirement, not an aspiration** (SC-001a/b). Every flow below is:
 * tap the kind, tap two buttons, send. No typing, no scrolling, no confirmation step.
 */
import { composeBearing, CONFIDENCE_CHOICES, RANGE_CHOICES } from '../report/bearing.js';
import { composeOmni, STRENGTH_CHOICES } from '../report/omni.js';
import { composeHeardNothing } from '../report/heard_nothing.js';
import { composeFix } from '../report/fix.js';
import type { AuthorContext } from '../report/author.js';
import { relayContext, type RelayDetails } from '../report/relay.js';
import type { ConfidenceQ, MaxRangeR, Report, StrengthS } from '../log/types.js';
import { watchHeading, needsPermission, requestPermission } from '../sensors/heading.js';
import { el } from './dom.js';

export type ReportKind = 'bearing' | 'omni' | 'null' | 'fix';

export interface EntryOptions {
  /** Rebuilt at submit time so the position and time are the observation's, not the sheet's. */
  context: () => AuthorContext;
  onSubmit: (report: Report) => void;
}

/**
 * Net control's flow: entering an observation heard over the radio, on behalf of someone else.
 *
 * Folded into the ordinary sheets rather than given its own button, because a relayed report is
 * not a fifth kind — it is any kind whose observer is not the person typing. The observer need not
 * be a participant: a voice-only operator with a radio and no phone appears on the map here.
 */
function relayFields(): {
  node: HTMLElement;
  details: () => RelayDetails | undefined;
} {
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

  const fields = el(
    'div',
    { class: 'stack', hidden: true, 'data-testid': 'relay-fields' },
    el('label', {}, 'Their callsign'),
    callsign,
    // Set by hand: net control is not standing where the observer is, and their GPS says nothing
    // about where the observation was taken from.
    el('label', {}, 'Where they were'),
    lat,
    lon,
  );

  const toggle = el(
    'button',
    { type: 'button', 'aria-pressed': 'false', 'data-testid': 'relay-toggle' },
    'This is someone else’s report',
  );
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') === 'true';
    toggle.setAttribute('aria-pressed', String(!on));
    fields.toggleAttribute('hidden', on);
  });

  return {
    node: el('div', { class: 'stack' }, toggle, fields),
    details: () => {
      if (toggle.getAttribute('aria-pressed') !== 'true') return undefined;
      const cs = callsign.value.trim();
      const latitude = Number(lat.value);
      const longitude = Number(lon.value);
      if (!cs || Number.isNaN(latitude) || Number.isNaN(longitude)) return undefined;
      return {
        observerCallsign: cs,
        observerPosition: { lat: latitude, lon: longitude },
        // The observation happened before it was read out on the air, but nobody knows exactly
        // when. Now is the honest floor, and the log records the entering operator separately so
        // a reader can see the hop.
        observedAt: Date.now(),
      };
    },
  };
}

/** Applies the relay details if net control filled them in; otherwise the context is unchanged. */
function withRelay(context: AuthorContext, details: RelayDetails | undefined): AuthorContext {
  return details ? relayContext(context, details) : context;
}

/**
 * The four buttons. Equal size, equal prominence, side by side — the layout is the claim.
 *
 * The labels are what a hunter says on the repeater. No protocol vocabulary reaches this file.
 */
export const KIND_BUTTONS: readonly { kind: ReportKind; label: string }[] = [
  { kind: 'bearing', label: 'Bearing' },
  { kind: 'omni', label: 'Signal' },
  { kind: 'null', label: 'Nothing here' },
  { kind: 'fix', label: 'Found it' },
];

export function reportBar(open: (kind: ReportKind) => void): HTMLElement {
  const bar = el('div', { class: 'report-bar', 'data-testid': 'report-bar' });
  for (const { kind, label } of KIND_BUTTONS) {
    const button = el('button', { type: 'button', 'data-testid': `report-${kind}` }, label);
    button.addEventListener('click', () => open(kind));
    bar.append(button);
  }
  return bar;
}

/** A row of large single-choice buttons. Three is the number a gloved thumb can hit. */
function choiceRow<T>(
  name: string,
  choices: readonly { label: string; value: T }[],
  onPick: (value: T) => void,
): { node: HTMLElement; value: () => T | undefined } {
  let picked: T | undefined;
  const row = el('div', { class: 'choices', role: 'radiogroup', 'aria-label': name });

  const buttons = choices.map((choice, index) => {
    const button = el(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'data-testid': `${name}-${index}`,
      },
      choice.label,
    );
    button.addEventListener('click', () => {
      picked = choice.value;
      for (const b of buttons) b.setAttribute('aria-checked', 'false');
      button.setAttribute('aria-checked', 'true');
      onPick(choice.value);
    });
    return button;
  });

  row.append(...buttons);
  return { node: row, value: () => picked };
}

function sheet(title: string, body: HTMLElement[], onClose: () => void): HTMLElement {
  const backdrop = el('div', { class: 'sheet-backdrop', 'data-testid': 'sheet' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title });
  panel.append(el('h2', {}, title), ...body);
  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose();
  });
  return backdrop;
}

/**
 * Bearing entry.
 *
 * The compass **drafts** the heading and the reporter can adjust it before submitting. A heading
 * they never saw would be a number the log attributes to them that they never claimed — and with
 * 10–30° of compass error near a vehicle, that number is often wrong.
 */
export function bearingSheet(options: EntryOptions, onClose: () => void): HTMLElement {
  let magnetic = 0;
  let source: 'compass' | 'manual' = 'manual';
  let accuracy: number | undefined;
  let stopWatching: (() => void) | undefined;

  const readout = el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: '0',
    max: '359.9',
    step: '0.1',
    value: '0',
    'data-testid': 'heading-input',
    'aria-label': 'Heading in degrees',
  });

  // Typing overrides the compass permanently: the reporter has made a claim, and a sensor update
  // that silently overwrote it would replace their number with the phone's.
  readout.addEventListener('input', () => {
    stopWatching?.();
    stopWatching = undefined;
    source = 'manual';
    accuracy = undefined;
    magnetic = Number(readout.value);
    status.textContent = 'Using the heading you typed';
  });

  const status = el('p', { class: 'small dim', 'data-testid': 'heading-status' }, 'Point the phone at the fox');

  const useCompass = el(
    'button',
    { type: 'button', 'data-testid': 'use-compass' },
    'Use the compass',
  );
  useCompass.addEventListener('click', () => {
    // Must be inside a gesture handler on iOS or requestPermission rejects.
    void (async () => {
      if (needsPermission() && !(await requestPermission())) {
        status.textContent = 'No compass access — type the heading instead';
        return;
      }
      source = 'compass';
      status.textContent = 'Compass live — check it, then adjust if it looks wrong';
      stopWatching = watchHeading((heading) => {
        magnetic = heading.magnetic;
        accuracy = heading.accuracyDegrees;
        readout.value = heading.magnetic.toFixed(1);
      });
    })();
  });

  const confidence = choiceRow<ConfidenceQ>(
    'confidence',
    CONFIDENCE_CHOICES.map((c) => ({ label: c.label, value: c.q })),
    () => refresh(),
  );
  const range = choiceRow<MaxRangeR>(
    'range',
    RANGE_CHOICES.map((c) => ({ label: c.label, value: c.r })),
    () => refresh(),
  );

  const send = el('button', { type: 'button', class: 'primary', 'data-testid': 'send-bearing' }, 'Send');

  // Both are required. This is what makes an unbounded or zero-width wedge unrepresentable rather
  // than merely discouraged — there is no default to fall back to and no way to skip past them.
  function refresh(): void {
    send.toggleAttribute(
      'disabled',
      confidence.value() === undefined || range.value() === undefined,
    );
  }
  refresh();

  const relay = relayFields();

  send.addEventListener('click', () => {
    const q = confidence.value();
    const r = range.value();
    if (q === undefined || r === undefined) return;
    stopWatching?.();
    options.onSubmit(
      composeBearing({
        ...withRelay(options.context(), relay.details()),
        draft: {
          heading_magnetic: magnetic,
          heading_source: source,
          ...(accuracy !== undefined ? { compass_accuracy_deg: accuracy } : {}),
        },
        confidence_q: q,
        max_range_r: r,
      }),
    );
    onClose();
  });

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', () => {
    stopWatching?.();
    onClose();
  });

  return sheet(
    'Which way is the fox?',
    [
      el('label', { for: 'heading' }, 'Heading (degrees)'),
      readout,
      useCompass,
      status,
      el('h2', {}, 'How sure are you?'),
      confidence.node,
      el('h2', {}, 'How far could it be?'),
      range.node,
      relay.node,
      el('div', { class: 'sheet-actions' }, cancel, send),
    ],
    () => {
      stopWatching?.();
      onClose();
    },
  );
}

/** Signal strength: three buttons, no antenna, no training. */
export function omniSheet(options: EntryOptions, onClose: () => void): HTMLElement {
  const strength = choiceRow<StrengthS>(
    'strength',
    STRENGTH_CHOICES.map((c) => ({ label: c.label, value: c.s })),
    (s) => {
      // One tap sends. Nothing else is required, so a confirmation step would only add time to a
      // ten-second budget.
      options.onSubmit(composeOmni({ ...options.context(), strength_s: s }));
      onClose();
    },
  );

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', onClose);

  return sheet('How strong is the signal here?', [strength.node, cancel], onClose);
}

/**
 * The two kinds that are complete without a payload. Kind + position + time is the whole claim,
 * so both are a single confirming tap.
 */
export function simpleSheet(
  kind: 'null' | 'fix',
  options: EntryOptions,
  onClose: () => void,
): HTMLElement {
  const title = kind === 'null' ? 'You hear nothing here?' : 'You found the fox?';
  const explain =
    kind === 'null'
      ? 'Knowing where the fox is not heard rules out ground for everyone. This is a real report.'
      : 'This marks the fox as found. It does not close the hunt — people can keep reporting.';

  const confirm = el(
    'button',
    { type: 'button', class: 'primary', 'data-testid': `send-${kind}` },
    kind === 'null' ? 'I hear nothing here' : 'I found it',
  );
  confirm.addEventListener('click', () => {
    const context = options.context();
    options.onSubmit(kind === 'null' ? composeHeardNothing(context) : composeFix(context));
    onClose();
  });

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', onClose);

  return sheet(title, [
    el('p', { class: 'small dim' }, explain),
    el('div', { class: 'sheet-actions' }, cancel, confirm),
  ], onClose);
}
