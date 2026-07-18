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
import type { ConfidenceQ, MaxRangeR, Report, StrengthS } from '../log/types.js';
import { compassDial, type DialMode } from './compass-dial.js';
import { el } from './dom.js';
import { icon, type IconName } from './icons.js';

export type ReportKind = 'bearing' | 'omni' | 'null' | 'fix';

/**
 * The report-kind identity (data-model.md §2): the icon that names each kind, used identically
 * in the bar, the sheet header, and the map popup. Shape distinguishes; the `--fx-kind-*` hue
 * reinforces — never colour alone (FR-015).
 */
export const KIND_ICONS: Record<ReportKind, IconName> = {
  bearing: 'explore',
  omni: 'cell_tower',
  null: 'signal_disconnected',
  fix: 'flag',
};

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
    // Icon above label, never icon alone: the glyph is recognition, the words are the meaning
    // (FR-007). The label names the icon, so the glyph hides from the accessibility tree.
    const button = el(
      'button',
      { type: 'button', class: `kind-button kind-${kind}`, 'data-testid': `report-${kind}` },
      icon(KIND_ICONS[kind], { label }),
      el('span', { class: 'kind-label' }, label),
    );
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

/**
 * Dismisses a sheet the way it arrived: back down, on the emphasized-accelerate exit curve.
 * Under reduced motion the removal is immediate — the state change happens, undecorated.
 * Exported for main.ts, whose close callback owns the actual removal.
 */
export function dismissSheet(backdrop: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    backdrop.remove();
    return;
  }
  backdrop.classList.add('closing');
  backdrop.addEventListener('animationend', () => backdrop.remove(), { once: true });
  // Belt to the animationend braces: if the animation never runs (display quirk, interrupted
  // style), the sheet must still leave — a stuck backdrop is a blocked report bar.
  setTimeout(() => backdrop.remove(), 350);
}

function sheet(
  kind: ReportKind,
  title: string,
  body: HTMLElement[],
  onClose: () => void,
): HTMLElement {
  const backdrop = el('div', { class: 'sheet-backdrop', 'data-testid': 'sheet' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title });

  // The header carries the same icon + colour + words as the button that opened it: the sheet
  // visibly belongs to the tap. Close is one of the three sanctioned icon-only affordances
  // (contracts/iconography.md §1) — and still a 56px target.
  const close = el(
    'button',
    { type: 'button', class: 'icon-button', 'data-testid': 'close-sheet' },
    icon('close'),
  );
  close.addEventListener('click', onClose);
  panel.append(
    el(
      'header',
      { class: `sheet-header kind-${kind}` },
      icon(KIND_ICONS[kind], { label: title }),
      el('h2', {}, title),
      close,
    ),
    ...body,
  );

  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose();
  });
  return backdrop;
}

/**
 * Bearing entry.
 *
 * The heading is set on a compass dial (compass-dial.ts): a device with a compass goes live and the
 * hunter freezes it; any device can twist the rose to set or correct the bearing. Nothing is
 * committed until a freeze or a twist — no due-north default is ever filed (FR-003a) — and the log
 * records only the number, never where it came from (FR-010). Relay entry uses the by-hand dial
 * (`mode: 'by-hand'`): net control has nothing to point at the fox.
 */
export function bearingSheet(
  options: EntryOptions,
  onClose: () => void,
  mode: DialMode = 'auto',
): HTMLElement {
  const dial = compassDial({ mode, onChange: () => refresh() });

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
      dial.committedHeading() === undefined ||
        confidence.value() === undefined ||
        range.value() === undefined,
    );
  }
  refresh();

  const problem = problemLine();

  send.addEventListener('click', () => {
    const q = confidence.value();
    const r = range.value();
    const magnetic = dial.committedHeading();
    if (q === undefined || r === undefined || magnetic === undefined) return;

    // Own or relayed is the caller's concern: main.ts injects the armed relay target into
    // this context, so the sheet neither knows nor cares whose observation it is filing.
    const context = options.context();
    if (!context) {
      problem.say(NO_POSITION);
      return;
    }

    dial.destroy();
    options.onSubmit(
      composeBearing({
        ...context,
        draft: { heading_magnetic: magnetic },
        confidence_q: q,
        max_range_r: r,
      }),
    );
    onClose();
  });

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', () => {
    dial.destroy();
    onClose();
  });

  return sheet(
    'bearing',
    'Which way is the fox?',
    [
      dial.node,
      el('h2', {}, 'How sure are you?'),
      confidence.node,
      el('h2', {}, 'How far could it be?'),
      range.node,
      problem.node,
      el('div', { class: 'sheet-actions' }, cancel, send),
    ],
    () => {
      dial.destroy();
      onClose();
    },
  );
}

/**
 * Signal strength: three buttons, no antenna, no training.
 *
 * Relayable like every other kind (FR-007a/b) — but relaying lives in its own flow now
 * (relay-entry.ts): net control arms a target first, and this sheet files whatever context the
 * caller injects. The hunter most likely to be calling their report in over voice is the one
 * with a handheld and a rubber duck — the exact person Principle II exists for.
 */
export function omniSheet(options: EntryOptions, onClose: () => void): HTMLElement {
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
      const context = options.context();
      if (!context) {
        problem.say(NO_POSITION);
        return;
      }

      options.onSubmit(composeOmni({ ...context, strength_s: s }));
      onClose();
    },
  );

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', onClose);

  return sheet(
    'omni',
    'How strong is the signal here?',
    [strength.node, problem.node, cancel],
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

  const problem = problemLine();

  const confirm = el(
    'button',
    { type: 'button', class: 'primary', 'data-testid': `send-${kind}` },
    kind === 'null' ? 'I hear nothing here' : 'I found it',
  );
  confirm.addEventListener('click', () => {
    const context = options.context();
    if (!context) {
      problem.say(NO_POSITION);
      return;
    }

    options.onSubmit(kind === 'null' ? composeHeardNothing(context) : composeFix(context));
    onClose();
  });

  const cancel = el('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', onClose);

  return sheet(
    kind,
    title,
    [
      el('p', { class: 'small dim' }, explain),
      problem.node,
      el('div', { class: 'sheet-actions' }, cancel, confirm),
    ],
    onClose,
  );
}
