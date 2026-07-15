/**
 * Storage durability (Complexity Tracking: iOS eviction).
 *
 * iOS deletes script-writable storage — IndexedDB *and* service worker caches — after 7 days of
 * Safari use without interaction on the site. Home Screen web apps are exempt. The exposed case is
 * a report authored offline and not yet synced on a phone that gets evicted, and the 30-day
 * interference hunter is exactly the usage pattern this rule punishes.
 *
 * The strongest mitigation is Add to Home Screen — which the constitution forbids *requiring*. So
 * it is an **offer, never a gate**: everything works without it.
 */
import { el } from './dom.js';

/**
 * Asks the browser to exempt our storage from eviction.
 *
 * Whether this actually beats iOS's 7-day rule **could not be verified from primary sources** —
 * see research.md. Designing as though it were a guarantee is exactly the confident-looking
 * wrongness Principle I exists to prevent, so it is called and then field-tested (T064), not
 * trusted.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * The offer. Shown only where it buys something (iOS, not already installed), and dismissible —
 * an offer a hunter cannot decline is a gate wearing a friendlier word.
 */
export function addToHomeScreenOffer(onDismiss: () => void): HTMLElement | undefined {
  if (!isIos() || isStandalone()) return undefined;

  const notice = el(
    'div',
    { class: 'notice', 'data-testid': 'a2hs-offer' },
    el(
      'p',
      { style: 'margin:0 0 .5rem' },
      'Tip: add FoxMapper to your Home Screen (Share → Add to Home Screen). ' +
        'iPhones clear a website’s saved data after about a week unused, which could drop reports ' +
        'you entered with no signal. Everything works without this.',
    ),
  );

  const dismiss = el('button', { type: 'button' }, 'Got it');
  dismiss.addEventListener('click', () => {
    notice.remove();
    onDismiss();
  });
  notice.append(dismiss);

  return notice;
}

/** The unsynced count, so a hunter knows reports are still stuck on their phone. */
export function queueChip(depth: number): HTMLElement | undefined {
  if (depth === 0) return undefined;
  return el(
    'span',
    { class: 'chip warn', 'data-testid': 'queue-depth' },
    `${depth} report${depth === 1 ? '' : 's'} still on this phone`,
  );
}
