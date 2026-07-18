/**
 * The two entry screens — create a hunt, or join one — share a shape.
 *
 * The product itself is the backdrop: a real hunt map fills the screen, and a single panel floats
 * over it carrying everything a visitor needs in one view — what this is, the one thing to do, the
 * words on the map, and the limits. Building both doors from one scaffold keeps them consistent; the
 * caller supplies only what differs (the kicker, the mode-specific head, and the form).
 *
 * **One screen, no scroll.** The panel is trimmed to fit the viewport on a phone: one line of
 * promise, a three-word glossary, a tight notice. The landing is a sanctioned expressive moment
 * (FR-005); the limits stay in the interface, never a terms page (FR-022).
 */
import { el } from './dom.js';
import { huntMapBackdrop } from './landing-demo.js';
import { limitsNotice } from './limits.js';

type Child = Node | string | undefined | false | null;

/** The pitch: what a fox hunt is, and how a shared link turns it into one live map. */
const BLURB =
  'A radio fox hunt uses radio direction finding to locate a hidden transmitter — the fox. Share ' +
  'a link and the team joins one session: each hunter takes a compass bearing toward the signal, ' +
  'and the shared map shows, live, where they cross.';

/**
 * The words on the map, trimmed to the two report kinds a newcomer needs to read the picture behind
 * the panel — the wedge and the dot. The fox itself is defined in the blurb above.
 */
const GLOSSARY: readonly [string, string][] = [
  ['Bearing', 'a compass heading towards the signal, taken at a location'],
  ['Signal', 'an omni-directional “signal was heard here” report — which way, unknown'],
];

function landingGlossary(): HTMLElement {
  return el(
    'dl',
    { class: 'landing-glossary', 'aria-label': 'Glossary' },
    ...GLOSSARY.flatMap(([term, meaning]) => [
      el('dt', { class: 'landing-glossary-term' }, term),
      el('dd', { class: 'landing-glossary-def dim' }, meaning),
    ]),
  );
}

/** A label bound to its input, kept tight as one unit so the eye reads them together. */
export function landingField(labelText: string, input: HTMLElement, forId?: string): HTMLElement {
  return el(
    'div',
    { class: 'landing-field' },
    el('label', forId ? { for: forId } : {}, labelText),
    input,
  );
}

export interface LandingScreen {
  /** Screen-level test hook: `start-screen` or `join-screen`. */
  testid: string;
  /** The mode, in the panel's own words — parallel across the two screens. */
  kicker: string;
  /** Mode-specific context above the form (the target on join); omitted on create. */
  head?: Child;
  /** The action itself: the fields and the single loud button. */
  form: HTMLElement;
}

/**
 * The real map behind, one panel in front. Wordmark and promise, the action, the glossary, then the
 * limits — a single fitted column so nothing scrolls, over the product doing the thing it is for.
 */
export function landingScreen(parts: LandingScreen): HTMLElement {
  return el(
    'div',
    { class: 'landing', 'data-testid': parts.testid },
    huntMapBackdrop(),
    el('div', { class: 'landing-scrim' }),
    el(
      'section',
      { class: 'landing-panel' },
      el('h1', { class: 'display landing-wordmark' }, 'FoxMapper'),
      el('p', { class: 'landing-blurb' }, BLURB),
      el(
        'div',
        { class: 'landing-card-head' },
        el('p', { class: 'landing-kicker' }, parts.kicker),
        parts.head,
      ),
      parts.form,
      // Reassurance at the point of action, on both screens: the friction people brace for is not
      // here. It is not the safety notice — that follows, and says something else entirely.
      el('p', { class: 'landing-fineprint small dim' }, 'No account. No app to install.'),
      landingGlossary(),
      limitsNotice(),
    ),
  );
}
