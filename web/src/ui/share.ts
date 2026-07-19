/**
 * Sharing the hunt (FR-001).
 *
 * A hunt *is* its code: the code is what gets read aloud over the repeater, and the link is what
 * gets pasted into a group chat. A creator who has to read the code out of their address bar has
 * been handed a hunt they cannot invite anyone to.
 *
 * FR-027's warning belongs with it — the code is semi-public the moment it goes out on the air, and
 * a hunter should know that before they key up rather than after.
 */
import { huntLink } from './last-hunt.js';
import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * The code, always readable; the whole chip is the tap target — a gloved thumb gets the full
 * 56px, not a nested 24px pill (SC-002). Share is one of the three sanctioned icon-first
 * affordances, and the code beside it is its own label.
 */
export function shareChip(huntCode: string): HTMLElement {
  const button = el(
    'button',
    {
      type: 'button',
      class: 'chip-action',
      'data-testid': 'share-hunt',
      'aria-label': `Hunt code ${huntCode} — tap to share`,
    },
    icon('share', { label: huntCode }),
    el('span', { class: 'chip-label mono' }, huntCode),
  );

  const status = el('span', { class: 'small dim', 'data-testid': 'share-status' });

  button.addEventListener('click', () => {
    void share(huntCode, status);
  });

  return el('span', { class: 'chip chip-with-action', 'data-testid': 'hunt-code' }, button, status);
}

/**
 * FR-027, said at the moment FR-027 is about.
 *
 * The notice on the start and join screens is read once, before anything has happened. This is the
 * second the hunter is actually deciding to put the code on an open repeater, and it is the second
 * the warning is worth anything.
 */
const OPEN_TO_ANYONE = 'Anyone with it can join and report.';

/**
 * The share sheet if the platform has one, the clipboard if not, and the bare link if neither.
 *
 * Every branch ends with the link visible: the point is that the hunter leaves with something they
 * can say out loud, not that a particular API worked.
 */
async function share(huntCode: string, status: HTMLElement): Promise<void> {
  const link = huntLink(huntCode);

  if (navigator.share) {
    try {
      await navigator.share({ title: 'FoxMapper', text: `Join the hunt: ${huntCode}`, url: link });
      return;
    } catch (error) {
      // **A dismissal is an answer, not a failure.** The platform rejects with `AbortError` when
      // the hunter backs out of the share sheet; falling through would copy the link they just
      // declined to send, and tell them it was copied.
      if (error instanceof Error && error.name === 'AbortError') return;
      // Anything else means the share sheet was not really there. Fall through to the clipboard.
    }
  }

  await copyHuntLink(huntCode, status);
}

/**
 * Copy the hunt link to the clipboard, and say so; if the clipboard is denied, show the bare link
 * to read out or copy by hand. Either way the hunter leaves with the thing they came for.
 *
 * Shared by the share chip (its no-`navigator.share` branch) and the leave-hunt confirmation, so
 * "come back with its link" copies exactly the way sharing does.
 */
export async function copyHuntLink(huntCode: string, status: HTMLElement): Promise<void> {
  const link = huntLink(huntCode);
  try {
    await navigator.clipboard.writeText(link);
    status.textContent = `Link copied. ${OPEN_TO_ANYONE}`;
  } catch {
    status.textContent = `${link} — ${OPEN_TO_ANYONE}`;
  }
}
