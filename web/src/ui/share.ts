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

/** The code, always readable, tapping to share or copy the link. */
export function shareChip(huntCode: string): HTMLElement {
  const button = el(
    'button',
    {
      type: 'button',
      'data-testid': 'share-hunt',
      'aria-label': `Hunt code ${huntCode} — tap to share`,
    },
    huntCode,
  );

  const status = el('span', { class: 'small dim', 'data-testid': 'share-status' });

  button.addEventListener('click', () => {
    void share(huntCode, status);
  });

  return el('span', { class: 'chip', 'data-testid': 'hunt-code' }, button, status);
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

  try {
    await navigator.clipboard.writeText(link);
    status.textContent = `Link copied. ${OPEN_TO_ANYONE}`;
  } catch {
    // No clipboard access. Show the link so it can be read out or copied by hand — the hunter
    // still leaves with the thing they came for.
    status.textContent = `${link} — ${OPEN_TO_ANYONE}`;
  }
}
