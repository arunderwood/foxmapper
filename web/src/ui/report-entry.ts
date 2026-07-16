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
  /**
   * Rebuilt at submit time so the position and time are the observation's, not the sheet's.
   *
   * **Undefined when this phone has no position** — no fix and nothing placed by hand. There is no
   * position to fall back on, and inventing one would file a report from ground the hunter has
   * never stood on. The caller refuses to open a sheet without one; this is the belt to that
   * braces, because a fix can be lost between opening and sending.
   */
  context: () => AuthorContext | undefined;
  onSubmit: (report: Report) => void;
}

/**
 * What the relay fields currently say.
 *
 * **`incomplete` is a state, not a nothing.** It used to collapse into `undefined` along with
 * "not a relay at all", and the two are opposites: one means "this report is mine", the other means
 * "this report is someone else's and I have not finished saying whose". Treating them alike filed
 * the second as the first.
 */
type RelayState =
  | { status: 'off' }
  | { status: 'ready'; details: RelayDetails }
  | { status: 'incomplete'; missing: string };

/** "a", "a and b", "a, b and c" — the message is read by a person, under time pressure. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A coordinate the operator actually typed, or undefined. Never a number they did not. */
function coordinate(input: HTMLInputElement, limit: number): number | undefined {
  // `Number('')` is 0, not NaN — which is how a blank field became a report at Null Island. An
  // empty number input reads '' for anything the browser cannot parse, so the emptiness check has
  // to come first and the range check has to be real.
  const raw = input.value.trim();
  if (raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return undefined;
  return value;
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
  state: () => RelayState;
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

  // FR-007: the log records when the observation was *taken*, not when it was typed. On the relay
  // path those are never the same moment — the operator heard it, called it, and somebody typed it
  // afterwards. Defaulting to now and saying nothing would file every relayed report late by
  // however long the voice traffic took, which is exactly the error FR-007 names.
  const minutesAgo = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: '0',
    step: '1',
    value: '0',
    'data-testid': 'relay-minutes-ago',
    'aria-label': 'How many minutes ago they heard it',
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
    el('label', {}, 'How long ago did they hear it? (minutes)'),
    minutesAgo,
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
    state: () => {
      if (toggle.getAttribute('aria-pressed') !== 'true') return { status: 'off' };

      const cs = callsign.value.trim();
      const latitude = coordinate(lat, 90);
      const longitude = coordinate(lon, 180);

      // Named individually because the operator is looking at four fields with a radio in their
      // other hand, and "something is wrong" is not an answer they can act on.
      const missing: string[] = [];
      if (!cs) missing.push('their callsign');
      if (latitude === undefined) missing.push('their latitude');
      if (longitude === undefined) missing.push('their longitude');
      if (!cs || latitude === undefined || longitude === undefined) {
        return { status: 'incomplete', missing: andList(missing) };
      }

      // The operator is the only one who knows how stale the call is, so they are asked rather
      // than guessed at. Zero — "just now" — is a claim they made, not a default standing in for
      // an answer nobody gave.
      const minutes = Math.max(0, Number(minutesAgo.value) || 0);
      return {
        status: 'ready',
        details: {
          observerCallsign: cs,
          observerPosition: { lat: latitude, lon: longitude },
          observedAt: Date.now() - minutes * 60_000,
        },
      };
    },
  };
}

/**
 * The context to author under, or **undefined when the operator said this is someone else's report
 * and has not finished saying whose**.
 *
 * The old version returned the entering operator's own context in that case, so a half-filled relay
 * form filed the report as net control's own observation, from net control's position, with the
 * toggle visibly on. SC-011 puts the acceptable number of those at zero, and a silent fallback is
 * how you get all of them.
 */
function withRelay(context: AuthorContext, state: RelayState): AuthorContext | undefined {
  if (state.status === 'off') return context;
  if (state.status === 'ready') return relayContext(context, state.details);
  return undefined;
}

/** Why nothing happened, said where the thumb already is. */
function problemLine(): { node: HTMLElement; say: (message: string) => void } {
  const node = el('p', {
    class: 'small danger',
    'data-testid': 'sheet-problem',
    role: 'status',
    hidden: true,
  });
  return {
    node,
    say: (message) => {
      node.textContent = message;
      node.toggleAttribute('hidden', false);
    },
  };
}

/** No position, no report — and the reason, rather than a Send button that does nothing. */
const NO_POSITION = 'This phone has no position — close this and set where you are on the map.';

const relayProblem = (missing: string): string =>
  `This is someone else’s report, so it needs ${missing} before it can be sent.`;

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
  // Undefined, not zero. A heading of 0 is due north — a real claim — and starting there means a
  // reporter who never touches this control files a due-north bearing under their own callsign.
  // Range is guarded exactly this way (FR-006c); a wedge's direction deserves it at least as much.
  let magnetic: number | undefined;
  let source: 'compass' | 'manual' = 'manual';
  let accuracy: number | undefined;
  let stopWatching: (() => void) | undefined;

  const readout = el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: '0',
    max: '359.9',
    step: '0.1',
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
    magnetic = readout.value.trim() === '' ? undefined : Number(readout.value);
    status.textContent = 'Using the heading you typed';
    refresh();
  });

  const status = el(
    'p',
    { class: 'small dim', 'data-testid': 'heading-status' },
    'Point the phone at the fox',
  );

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
        refresh();
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

  const send = el(
    'button',
    { type: 'button', class: 'primary', 'data-testid': 'send-bearing' },
    'Send',
  );

  // All three are required. This is what makes an unbounded wedge, a zero-width one, or one
  // pointing at a north nobody claimed unrepresentable rather than merely discouraged — there is
  // no default to fall back to and no way to skip past them.
  function refresh(): void {
    send.toggleAttribute(
      'disabled',
      magnetic === undefined || confidence.value() === undefined || range.value() === undefined,
    );
  }
  refresh();

  const relay = relayFields();
  const problem = problemLine();

  send.addEventListener('click', () => {
    const q = confidence.value();
    const r = range.value();
    if (q === undefined || r === undefined || magnetic === undefined) return;

    const base = options.context();
    if (!base) {
      problem.say(NO_POSITION);
      return;
    }

    const relayed = relay.state();
    const context = withRelay(base, relayed);
    if (!context) {
      problem.say(relayProblem(relayed.status === 'incomplete' ? relayed.missing : ''));
      return;
    }

    stopWatching?.();
    options.onSubmit(
      composeBearing({
        ...context,
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
      problem.node,
      el('div', { class: 'sheet-actions' }, cancel, send),
    ],
    () => {
      stopWatching?.();
      onClose();
    },
  );
}

/**
 * Signal strength: three buttons, no antenna, no training.
 *
 * Relayable like every other kind. FR-007a/b are not scoped to bearings, and the hunter most likely
 * to be calling their report in over voice rather than typing it is the one with a handheld and a
 * rubber duck — the exact person Principle II exists for. Net control being unable to enter their
 * signal report is Principle II failing at the last inch.
 */
export function omniSheet(options: EntryOptions, onClose: () => void): HTMLElement {
  const relay = relayFields();
  const problem = problemLine();

  const strength = choiceRow<StrengthS>(
    'strength',
    STRENGTH_CHOICES.map((c) => ({ label: c.label, value: c.s })),
    (s) => {
      // One tap sends. Nothing else is required, so a confirmation step would only add time to a
      // ten-second budget.
      //
      // Which is exactly why a refusal has to speak: the tapped button has already flipped to
      // checked, so silence here reads as sent.
      const base = options.context();
      if (!base) {
        problem.say(NO_POSITION);
        return;
      }

      const relayed = relay.state();
      const context = withRelay(base, relayed);
      if (!context) {
        problem.say(relayProblem(relayed.status === 'incomplete' ? relayed.missing : ''));
        return;
      }

      options.onSubmit(composeOmni({ ...context, strength_s: s }));
      onClose();
    },
  );

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', onClose);

  return sheet(
    'How strong is the signal here?',
    [strength.node, relay.node, problem.node, cancel],
    onClose,
  );
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

  const relay = relayFields();
  const problem = problemLine();

  const confirm = el(
    'button',
    { type: 'button', class: 'primary', 'data-testid': `send-${kind}` },
    kind === 'null' ? 'I hear nothing here' : 'I found it',
  );
  confirm.addEventListener('click', () => {
    const base = options.context();
    if (!base) {
      problem.say(NO_POSITION);
      return;
    }

    const relayed = relay.state();
    const context = withRelay(base, relayed);
    if (!context) {
      problem.say(relayProblem(relayed.status === 'incomplete' ? relayed.missing : ''));
      return;
    }

    options.onSubmit(kind === 'null' ? composeHeardNothing(context) : composeFix(context));
    onClose();
  });

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', onClose);

  return sheet(
    title,
    [
      el('p', { class: 'small dim' }, explain),
      relay.node,
      problem.node,
      el('div', { class: 'sheet-actions' }, cancel, confirm),
    ],
    onClose,
  );
}
