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
 * `target` is undefined until this device has learned what the hunt is for.
 *
 * **An unknown target says so.** Falling back to a plausible-looking stand-in would put a label on
 * the primary view that nobody typed, indistinguishable from one the organiser did — which is the
 * same failure as drawing a wedge from a position nobody stood on.
 */
export function targetChips(target: Target | undefined, found: boolean): HTMLElement[] {
  const chips: HTMLElement[] = [];

  if (!target) {
    chips.push(
      el(
        'span',
        { class: 'chip dim', 'data-testid': 'target-unknown' },
        el('span', { class: 'chip-label' }, 'Target not loaded yet'),
      ),
    );
    if (found) chips.push(foundChip());
    return chips;
  }

  chips.push(
    el(
      'span',
      { class: 'chip', 'data-testid': 'target-label' },
      el('span', { class: 'chip-label' }, target.label),
    ),
  );

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
