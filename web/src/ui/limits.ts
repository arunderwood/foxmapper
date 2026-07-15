/**
 * The limits notice (FR-022, FR-027).
 *
 * **In the interface, not in terms of service.** The constitution is explicit: the product must
 * express its limits where a participant will actually meet them. A hunter who never opens a terms
 * page has still been told.
 *
 * Not dismissible on the join screen — it is part of joining, not a modal to get past.
 */
import { el } from './dom.js';

export const LIMITS = [
  // Liability: not certified for life-safety search, and it must not imply otherwise.
  'This is a hobby tool for fox hunting. It is not certified for search and rescue, and must not be used for life-safety search.',
  // Principle I, in plain language: the map is only its inputs.
  'The picture is only as good as the reports people enter. Nothing here is verified, and no location is calculated for you.',
  // FR-027: the code is the whole of auth, and hunters should know that.
  'Anyone with the hunt link can join, report, and say the fox has been found.',
];

export function limitsNotice(): HTMLElement {
  return el(
    'div',
    { class: 'notice', 'data-testid': 'limits' },
    ...LIMITS.map((text) => el('p', { style: 'margin:0 0 .5rem' }, text)),
  );
}
