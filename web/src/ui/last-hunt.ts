/**
 * Which hunt to open (FR-004c/d).
 *
 * **No hunt list, no switcher, no multi-hunt view.** A hunter is in one hunt at a time; a list
 * would be a feature nobody asked for and a decision to make in the cold.
 */
import { forgetHunt, lastHunt, rememberHunt } from '../log/identity.js';

export type Landing = { screen: 'hunt'; code: string } | { screen: 'start' };

/**
 * The link wins over memory: a hunter opening a shared link means to go there, whatever they were
 * last in.
 */
export function decideLanding(url: URL = new URL(window.location.href)): Landing {
  const fromLink = codeFromPath(url.pathname) ?? url.searchParams.get('hunt');
  if (fromLink) {
    rememberHunt(fromLink);
    return { screen: 'hunt', code: fromLink };
  }

  const remembered = lastHunt();
  if (remembered) return { screen: 'hunt', code: remembered };

  return { screen: 'start' };
}

/** `/h/quiet-fox-8821-h7k2` */
function codeFromPath(pathname: string): string | undefined {
  const match = /^\/h\/([a-z0-9-]+)\/?$/i.exec(pathname);
  return match?.[1]?.toLowerCase();
}

/**
 * The remembered hunt has expired: the stream 204s and the code is dead. Forget it and land the
 * participant where a first-time visitor lands, rather than retrying a dead code forever.
 */
export function huntIsGone(): void {
  forgetHunt();
}

/**
 * The hunter chose to leave and start another: a clean handoff, not a hunt that died. Forgetting the
 * code is the whole point — it is what unsticks `decideLanding()` from routing back here, so the
 * create screen becomes reachable. The hunt itself is untouched (its log stays on this device, and
 * it stays live on the server); leaving is recoverable by reopening its link.
 */
export function leaveHunt(): void {
  forgetHunt();
}

export function huntLink(code: string): string {
  return `${window.location.origin}/h/${code}`;
}
