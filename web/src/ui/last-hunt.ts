/**
 * Which hunt to open (FR-004c/d).
 *
 * **No hunt list, no switcher, no multi-hunt view.** A hunter is in one hunt at a time; a list
 * would be a feature nobody asked for and a decision to make in the cold.
 */
import { forgetHunt, lastHunt, rememberHunt } from '../log/identity.js';

export type Landing =
  | { screen: 'hunt'; code: string }
  | { screen: 'start' };

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

export function huntLink(code: string): string {
  return `${window.location.origin}/h/${code}`;
}
