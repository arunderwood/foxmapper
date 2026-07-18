/**
 * The running tour: the offer, and the overlay engine (contracts/tour-overlay.md).
 *
 * A thin, additive layer over surfaces that already exist. The overlay reads no network and writes
 * nothing — persistence (`markCompleted`/`markDeclined`) is the caller's job in main.ts, so this
 * file stays a pure UI controller. Every step spotlights an existing control by its `data-testid`;
 * when that control is absent at runtime (e.g. the target has not loaded on a fresh hunt) the step
 * falls back to a centred callout rather than pointing at nothing (FR-014).
 *
 * Accessibility is not an add-on here (FR-020): the overlay is a labelled modal dialog, the keyboard
 * advances/goes back/exits, focus moves to the callout on every step, Tab is trapped inside it, and
 * each step is announced through an `aria-live` region. Motion is left to CSS so the app's global
 * reduced-motion kill neutralises it with no special-casing.
 */
import { el } from '../dom.js';
import { STEPS, type TourStep } from './steps.js';
import { credibleRegionSample } from './sample.js';

export interface TourOffer {
  /** Where to mount — `#app` (main.ts). */
  root: HTMLElement;
  onAccept: () => void;
  onDecline: () => void;
}

export interface TourRun {
  root: HTMLElement;
  /** Reached the final step. */
  onFinish: () => void;
  /** Left before the end — Esc, a scrim tap, or the exit button. */
  onExit: () => void;
}

/**
 * The first-run offer: a small, non-blocking card. It never covers the controls beneath it, and
 * dismissing it changes nothing but the tour state the caller records (FR-001/FR-002).
 */
export function offerTour(offer: TourOffer): void {
  const card = el('div', {
    class: 'tour-offer',
    'data-testid': 'tour-offer',
    role: 'region',
    'aria-label': 'Take the tour',
  });

  let raf = 0;
  const dismiss = (): void => {
    cancelAnimationFrame(raf);
    card.remove();
  };

  const accept = el(
    'button',
    { type: 'button', class: 'primary', 'data-testid': 'tour-offer-accept' },
    'Show me around',
  );
  accept.addEventListener('click', () => {
    dismiss();
    offer.onAccept();
  });

  const decline = el(
    'button',
    { type: 'button', 'data-testid': 'tour-offer-decline' },
    'No thanks',
  );
  decline.addEventListener('click', () => {
    dismiss();
    offer.onDecline();
  });

  card.append(
    el(
      'p',
      { class: 'tour-offer-text' },
      'New to FoxMapper? Take a quick tour of how to help find the fox.',
    ),
    el('div', { class: 'tour-offer-actions' }, decline, accept),
  );
  offer.root.append(card);

  // Sit the offer just above the report bar so it never covers a report button (FR-002). The bar is
  // not necessarily at the viewport bottom — an "add to home screen" notice can sit below it and
  // push it up — and its labels wrap taller on a narrow phone, so the offer is pinned to the bar's
  // *live* top rather than to the viewport or a guessed height. Tracked each frame while the offer
  // is shown, so it stays put through any reflow; it is a transient card, and this is the same cheap
  // per-frame follow the tour spotlight uses.
  const bar = document.querySelector<HTMLElement>('[data-testid="report-bar"]');
  if (bar) {
    const gap = 12;
    const track = (): void => {
      const rect = bar.getBoundingClientRect();
      if (rect.height > 0) {
        card.style.bottom = `${Math.max(0, Math.round(window.innerHeight - rect.top)) + gap}px`;
      }
      raf = requestAnimationFrame(track);
    };
    track();
  }
}

/** Mounts the overlay and walks the steps from the top. */
export function runTour(run: TourRun): void {
  let index = 0;
  let closed = false;

  const title = el('h2', {
    class: 'tour-step-title',
    'data-testid': 'tour-step-title',
  });
  const body = el('p', { class: 'tour-step-body', 'data-testid': 'tour-step-body' });
  const sampleSlot = el('div', { class: 'tour-sample-slot' });
  const progress = el('p', { class: 'tour-progress', 'data-testid': 'tour-progress' });

  const back = el(
    'button',
    { type: 'button', class: 'tour-back', 'data-testid': 'tour-back' },
    'Back',
  );
  const exit = el(
    'button',
    { type: 'button', class: 'tour-exit', 'data-testid': 'tour-exit' },
    'Skip',
  );
  const next = el(
    'button',
    { type: 'button', class: 'primary tour-next', 'data-testid': 'tour-next' },
    'Next',
  );

  back.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  exit.addEventListener('click', () => close());

  const callout = el(
    'div',
    { class: 'tour-callout', 'data-testid': 'tour-callout', tabindex: '-1' },
    title,
    body,
    sampleSlot,
    progress,
    el('div', { class: 'tour-controls' }, exit, back, next),
  );

  // Visual only, and pointer-transparent so a tap on the highlighted control reaches the scrim.
  const spotlight = el('div', {
    class: 'tour-spotlight',
    'data-testid': 'tour-spotlight',
    'aria-hidden': 'true',
  });

  // Off-screen, but read aloud: each step's copy lands here for assistive tech (FR-020).
  const live = el('div', {
    class: 'tour-live',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  const overlay = el(
    'div',
    {
      class: 'tour-overlay',
      'data-testid': 'tour-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'FoxMapper tour',
    },
    spotlight,
    live,
    callout,
  );

  // A tap on the scrim (anywhere outside the callout) exits (FR-020).
  overlay.addEventListener('click', (event) => {
    if (!callout.contains(event.target as Node)) close();
  });

  function focusables(): HTMLButtonElement[] {
    return [...callout.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  }

  function trapTab(event: KeyboardEvent): void {
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === callout)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!event.shiftKey && active === callout) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (closed) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'ArrowRight':
        event.preventDefault();
        go(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        go(index - 1);
        break;
      case 'Enter':
        // A focused button owns its own Enter (Back/Skip); anywhere else, Enter advances.
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        go(index + 1);
        break;
      case 'Tab':
        trapTab(event);
        break;
      default:
        break;
    }
  }

  function place(step: TourStep): void {
    const target = step.anchor
      ? document.querySelector<HTMLElement>(`[data-testid="${step.anchor}"]`)
      : null;
    const rect = target?.getBoundingClientRect();

    if (!rect || rect.width === 0 || rect.height === 0) {
      // Nothing to point at: a centred callout carries the step on its own (FR-014).
      overlay.classList.add('tour-centred');
      spotlight.style.display = 'none';
      return;
    }

    overlay.classList.remove('tour-centred');
    spotlight.style.display = '';
    const pad = 8;
    spotlight.style.left = `${rect.left - pad}px`;
    spotlight.style.top = `${rect.top - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    // Keep the callout clear of the control it describes (FR-006): if the anchor sits low on the
    // screen — the report bar does — the callout goes to the top, and vice versa.
    const belowMiddle = rect.top + rect.height / 2 > window.innerHeight / 2;
    callout.classList.toggle('tour-callout-top', belowMiddle);
    callout.classList.toggle('tour-callout-bottom', !belowMiddle);
  }

  // The status bar rebuilds on every position tick, shifting the chips the target and share steps
  // point at. Rather than chase resize/scroll events, the spotlight re-measures its anchor every
  // frame while the overlay is open, so it stays glued to a control even as the layout reflows
  // underneath it (FR-006). It is a short-lived overlay; a per-frame `getBoundingClientRect` is
  // cheap enough for that.
  let raf = 0;
  function track(): void {
    if (closed) return;
    const step = STEPS[index];
    if (step) place(step);
    raf = requestAnimationFrame(track);
  }

  function render(): void {
    const step = STEPS[index];
    if (!step) return;

    // The current step id, exposed for the e2e suite to assert order without leaning on copy.
    overlay.dataset['step'] = step.id;
    title.textContent = step.title;
    body.textContent = step.body;

    sampleSlot.replaceChildren();
    if (step.sample) sampleSlot.append(credibleRegionSample());

    progress.textContent = `Step ${index + 1} of ${STEPS.length}`;

    back.toggleAttribute('disabled', index === 0);
    const isLast = index === STEPS.length - 1;
    next.textContent = isLast ? 'Done' : 'Next';

    place(step);

    // Announce, then move focus to the callout (FR-020). Order matters: the live region is updated
    // before focus so a screen reader reads the new step rather than the previous one.
    live.textContent = `${step.title}. ${step.body}`;
    callout.focus();
  }

  function go(to: number): void {
    if (closed) return;
    if (to < 0) return; // Before the first step: a no-op, not an exit.
    if (to >= STEPS.length) {
      finish();
      return;
    }
    index = to;
    render();
  }

  function teardown(): void {
    document.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(raf);
    overlay.remove();
  }

  function finish(): void {
    if (closed) return;
    closed = true;
    teardown();
    run.onFinish();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    teardown();
    run.onExit();
  }

  run.root.append(overlay);
  document.addEventListener('keydown', onKey, true);
  render();
  track();
}
