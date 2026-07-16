/**
 * The target, in the primary view (FR-004b).
 *
 * `found` is not fetched — it is a fold over the log on this device. The server does not know
 * whether the fox has been found and has no way to find out.
 */
import { el } from './dom.js';

export interface Target {
  frequency: string;
  label: string;
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
      el('span', { class: 'chip', 'data-testid': 'target-unknown' }, 'Target not loaded yet'),
    );
    if (found) chips.push(el('span', { class: 'chip', 'data-testid': 'found' }, 'Someone found it'));
    return chips;
  }

  chips.push(el('span', { class: 'chip', 'data-testid': 'target-label' }, target.label));

  // A free-text string, shown exactly as the organiser typed it. "146.52", "two meters", "the 440
  // machine" are all things a hunter says, and none of them is a number.
  if (target.frequency.trim()) {
    chips.push(el('span', { class: 'chip', 'data-testid': 'target-frequency' }, target.frequency));
  }

  if (found) {
    // A find does not close the hunt or stop reports — it is a fact on the map like any other.
    chips.push(el('span', { class: 'chip', 'data-testid': 'found' }, 'Someone found it'));
  }

  return chips;
}
