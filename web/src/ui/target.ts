/**
 * The target, in the primary view (FR-004b).
 *
 * `found` is not fetched — it is a fold over the log on this device. The server does not know
 * whether the fox has been found and has no way to find out.
 */
import { el } from './dom.js';
import { icon } from './icons.js';

export interface Target {
  frequency: string;
  label: string;
}

/** "Someone found it": the fix kind's own triple — same flag, same hue as the report bar. */
function foundChip(): HTMLElement {
  return el(
    'span',
    { class: 'chip ok kind-fix', 'data-testid': 'found' },
    icon('flag', { label: 'Someone found it' }),
    el('span', { class: 'chip-label' }, 'Someone found it'),
  );
}

/**
 * The hunt-name chip, which is also the way into the hunt menu (settings + start a new hunt).
 *
 * The name is the obvious thing to reach for when you want to act on *this hunt*, so it carries the
 * gear and the tap rather than a second icon-only button competing with it in the bar. Labeled by
 * the name it sits beside — WCAG label-in-name — with the gear naming the action for a screen reader.
 */
function huntMenuChip(
  label: string,
  labelTestid: string,
  onOpenMenu: () => void,
  extraClass = '',
): HTMLElement {
  const button = el(
    'button',
    {
      type: 'button',
      class: 'chip-action',
      'data-testid': 'open-settings',
      'aria-label': `${label} — hunt menu`,
    },
    icon('settings', { label }),
    el('span', { class: 'chip-label', 'data-testid': labelTestid }, label),
  );
  button.addEventListener('click', onOpenMenu);
  return el(
    'span',
    { class: `chip chip-with-action${extraClass ? ` ${extraClass}` : ''}` },
    button,
  );
}

/**
 * `target` is undefined until this device has learned what the hunt is for.
 *
 * **An unknown target says so.** Falling back to a plausible-looking stand-in would put a label on
 * the primary view that nobody typed, indistinguishable from one the organiser did — which is the
 * same failure as drawing a wedge from a position nobody stood on.
 */
export function targetChips(
  target: Target | undefined,
  found: boolean,
  onOpenMenu: () => void,
): HTMLElement[] {
  const chips: HTMLElement[] = [];

  if (!target) {
    // The menu must be reachable before the target loads — offline, or on a slow first fetch — so
    // the placeholder is the button too, not dead text with the gear hidden until a name arrives.
    chips.push(huntMenuChip('Target not loaded yet', 'target-unknown', onOpenMenu, 'dim'));
    if (found) chips.push(foundChip());
    return chips;
  }

  chips.push(huntMenuChip(target.label, 'target-label', onOpenMenu));

  // A free-text string, shown exactly as the organiser typed it. "146.52", "two meters", "the 440
  // machine" are all things a hunter says, and none of them is a number.
  if (target.frequency.trim()) {
    chips.push(
      el(
        'span',
        { class: 'chip', 'data-testid': 'target-frequency' },
        el('span', { class: 'chip-label mono' }, target.frequency),
      ),
    );
  }

  // A find does not close the hunt or stop reports — it is a fact on the map like any other.
  if (found) chips.push(foundChip());

  return chips;
}
