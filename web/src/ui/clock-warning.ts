/**
 * The clock warning (FR-009c).
 *
 * **Warn, never silently correct.** Correcting would mutate a reported fact: the report says what
 * the reporter's device said, forever. Telling them is the honest move; rewriting it behind their
 * back is the confident-looking wrongness Principle I exists to prevent.
 */
import { isSkewed, type ClockOffset } from '../log/clock.js';
import { el } from './dom.js';

export function clockWarning(offset: ClockOffset): HTMLElement | undefined {
  if (!isSkewed(offset)) return undefined;

  const minutes = Math.round(Math.abs(offset ?? 0) / 60_000);
  const direction = (offset ?? 0) > 0 ? 'ahead of' : 'behind';

  return el(
    'div',
    { class: 'chip warn', 'data-testid': 'clock-warning' },
    `Your clock is about ${minutes} min ${direction} real time — your report times will look wrong to others`,
  );
}
