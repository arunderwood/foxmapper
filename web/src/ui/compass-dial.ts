/**
 * The bearing dial (feature 004).
 *
 * A rotating compass rose read under a fixed top index ("toward the fox"). On a device with a
 * compass the rose tracks the device — auto-live where the platform needs no permission, behind an
 * explicit tap where a gesture is required — damped so it reads like a settling card, and the hunter
 * freezes it with one tap. A frozen (or, on a phone with no compass, an idle) rose can be twisted to
 * set or correct the bearing. The always-visible numeric field is the accessible, keyboard path; the
 * SVG rose is decorative to assistive tech.
 *
 * The dial produces **only a magnetic heading**. It never records where the number came from — a
 * bearing is a bearing (FR-010) — and it commits nothing until the hunter freezes or twists
 * (FR-003a: no due-north default). The true-north conversion stays in composeBearing, invisible.
 */
import { watchHeading, needsPermission, requestPermission } from '../sensors/heading.js';
import { normalizeHeading } from '../sensors/declination.js';
import { el } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — research R2/R3)
// ---------------------------------------------------------------------------

/**
 * Angle-domain low-pass. Smoothing the heading directly would jump between 359° and 1°; smoothing a
 * unit vector does not. `push` returns the smoothed heading; the caller reads that, and freezes it —
 * the value on screen is the value the hunter vouches for (SC-007), never the latest raw sample.
 */
export interface HeadingSmoother {
  push(headingDeg: number, dtMs: number): number;
  reset(headingDeg?: number): void;
  value(): number | undefined;
}

export function createHeadingSmoother(tauMs = 200): HeadingSmoother {
  let x: number | undefined;
  let y: number | undefined;
  const read = (): number | undefined =>
    x === undefined || y === undefined ? undefined : normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
  return {
    push(headingDeg, dtMs) {
      const rad = (headingDeg * Math.PI) / 180;
      const tx = Math.cos(rad);
      const ty = Math.sin(rad);
      if (x === undefined || y === undefined) {
        x = tx;
        y = ty;
      } else {
        // 1 - e^(-dt/τ): frame-rate independent, so damping feels the same at 30 or 60 fps.
        const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
        x += alpha * (tx - x);
        y += alpha * (ty - y);
      }
      return read() as number;
    },
    reset(headingDeg) {
      if (headingDeg === undefined) {
        x = undefined;
        y = undefined;
      } else {
        const rad = (headingDeg * Math.PI) / 180;
        x = Math.cos(rad);
        y = Math.sin(rad);
      }
    },
    value: read,
  };
}

/** Compass bearing (clockwise from 12 o'clock) of a pointer at `(px,py)` about centre `(cx,cy)`. */
export function pointerBearing(cx: number, cy: number, px: number, py: number): number {
  // Screen y grows downward; "up" (−y) is 0°, clockwise positive.
  return normalizeHeading((Math.atan2(px - cx, cy - py) * 180) / Math.PI);
}

/**
 * Grab-and-follow twist: as the finger sweeps from `fromBearing` to `toBearing` about the centre,
 * the grabbed rose mark stays under the finger, so the heading under the top index moves by the
 * opposite of the finger's sweep. Returns the new committed heading, normalized.
 */
export function twistHeading(startHeading: number, fromBearing: number, toBearing: number): number {
  return normalizeHeading(startHeading - (toBearing - fromBearing));
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

/** `auto` gets a live compass where the platform allows; `by-hand` never does (no-compass, relay). */
export type DialMode = 'auto' | 'by-hand';

export type DialState = 'idle' | 'live' | 'frozen' | 'by-hand';

export interface DialOptions {
  mode?: DialMode;
  /** Fires whenever the committed heading changes (including to `undefined`). */
  onChange?: (heading: number | undefined) => void;
}

export interface CompassDial {
  node: HTMLElement;
  /** The heading the report will carry, or `undefined` until the hunter freezes or twists. */
  committedHeading(): number | undefined;
  destroy(): void;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Build the static rose once: minor ticks (10°), major ticks + numerals (30°), cardinal letters. */
function buildRose(): SVGGElement {
  const g = svg('g', { class: 'rose-rotator' }) as SVGGElement;
  g.append(svg('circle', { class: 'rose-face', cx: '0', cy: '0', r: '96' }));
  for (let deg = 0; deg < 360; deg += 10) {
    const major = deg % 30 === 0;
    const len = major ? 12 : 6;
    const rad = (deg * Math.PI) / 180;
    const outer = 92;
    const inner = outer - len;
    g.append(
      svg('line', {
        class: major ? 'rose-tick major' : 'rose-tick',
        x1: String(Math.sin(rad) * inner),
        y1: String(-Math.cos(rad) * inner),
        x2: String(Math.sin(rad) * outer),
        y2: String(-Math.cos(rad) * outer),
      }),
    );
  }
  const cardinals: [number, string][] = [
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
  ];
  for (const [deg, letter] of cardinals) {
    const rad = (deg * Math.PI) / 180;
    const t = svg('text', {
      class: `rose-cardinal${letter === 'N' ? ' north' : ''}`,
      x: String(Math.sin(rad) * 68),
      y: String(-Math.cos(rad) * 68),
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    t.textContent = letter;
    g.append(t);
  }
  return g;
}

export function compassDial(options: DialOptions = {}): CompassDial {
  const mode: DialMode = options.mode ?? 'auto';

  let state: DialState = 'idle';
  let committed: number | undefined;
  /** What the rose currently shows: the live smoothed heading, or the committed value. */
  let displayed = 0;
  let stopWatching: (() => void) | undefined;
  let lastTs: number | undefined;
  /** True once the sensor has actually reported a heading this live session. A phone with no
   *  compass goes live but never gets one, so Freeze stays hidden and it falls to twist alone —
   *  no dead affordance, without the code having to detect the sensor's absence (FR-011). */
  let receivedSample = false;
  const smoother = createHeadingSmoother();

  const rose = buildRose();
  const svgEl = svg('svg', {
    class: 'dial-rose',
    viewBox: '-100 -100 200 200',
    'aria-hidden': 'true',
  });
  svgEl.append(rose);
  const face = el('div', { class: 'dial-face' }, svgEl, el('div', { class: 'dial-index' }));

  const input = el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: '0',
    max: '359.9',
    step: '0.1',
    class: 'dial-degrees',
    'data-testid': 'heading-input',
    'aria-label': 'Bearing in degrees',
  });

  const status = el('p', { class: 'small dim', 'data-testid': 'heading-status' }, '');

  const startBtn = el(
    'button',
    { type: 'button', class: 'dial-start', 'data-testid': 'use-compass', hidden: true },
    'Use the compass',
  );
  const freezeBtn = el(
    'button',
    { type: 'button', class: 'dial-freeze', 'data-testid': 'freeze', hidden: true },
    'Freeze',
  );
  const retakeBtn = el(
    'button',
    { type: 'button', class: 'dial-retake', 'data-testid': 'go-live', hidden: true },
    'Take again',
  );

  const node = el(
    'div',
    { class: 'compass-dial', 'data-testid': 'compass-dial', 'data-state': state },
    face,
    el('label', { class: 'dial-degrees-label' }, 'Degrees', input),
    el('div', { class: 'dial-controls' }, startBtn, freezeBtn, retakeBtn),
    status,
  );

  // -- rendering -----------------------------------------------------------

  function render(): void {
    node.setAttribute('data-state', state);
    // A mark at clockwise angle H sits under the top index when the rose is rotated by −H.
    rose.style.transform = `rotate(${-displayed}deg)`;
    // The number reflects the *committed* bearing only. While live it stays empty — a moving stream
    // is not a value the reporter has claimed (FR-003a), and a due-north "0.0" would read as one.
    // Round then re-fold so a value just shy of 360 shows "0.0", never an out-of-range "360.0".
    if (document.activeElement !== input) {
      input.value =
        committed === undefined ? '' : ((Math.round(committed * 10) / 10) % 360).toFixed(1);
    }
    startBtn.toggleAttribute('hidden', !(state === 'idle' && mode === 'auto' && needsPermission()));
    // Freeze appears only once the compass has actually reported — never on a phone that has none.
    freezeBtn.toggleAttribute('hidden', !(state === 'live' && receivedSample));
    // Retake only exists in auto mode, and only after a value is captured.
    retakeBtn.toggleAttribute(
      'hidden',
      mode !== 'auto' || !(state === 'frozen' || state === 'by-hand'),
    );
  }

  function setCommitted(value: number | undefined): void {
    // Only notify on a real change. The initial auto-live sets `undefined` while the host is still
    // wiring its onChange handler; firing it then would touch not-yet-initialized host state (TDZ).
    if (value === committed) return;
    committed = value;
    options.onChange?.(committed);
  }

  function setStatus(message: string): void {
    status.textContent = message;
  }

  // -- live compass --------------------------------------------------------

  function goLive(): void {
    state = 'live';
    setCommitted(undefined);
    smoother.reset();
    lastTs = undefined;
    receivedSample = false;
    // Names both paths: a real compass reports and Freeze appears; a phone with no compass never
    // does, so "or twist the dial" is the only guidance it will get and must be here (FR-011).
    setStatus('Point the phone at the fox and freeze — or twist the dial to set it.');
    stopWatching?.();
    stopWatching = watchHeading((heading) => {
      const now = performance.now();
      const dt = lastTs === undefined ? 0 : now - lastTs;
      lastTs = now;
      displayed = smoother.push(heading.magnetic, dt);
      receivedSample = true;
      render();
    });
    render();
  }

  function startCompass(): void {
    // Must be called inside the tap on iOS, or requestPermission rejects.
    void (async () => {
      if (needsPermission() && !(await requestPermission())) {
        setStatus('No compass access — twist the dial to set the bearing');
        return;
      }
      goLive();
    })();
  }

  function freeze(): void {
    stopWatching?.();
    stopWatching = undefined;
    state = 'frozen';
    setCommitted(displayed);
    setStatus('Frozen — twist to adjust, or take again');
    render();
  }

  function detachToByHand(next: number): void {
    // Any twist or numeric edit hands over from the sensor: a live reading may not overwrite a
    // value the reporter set (FR-009).
    stopWatching?.();
    stopWatching = undefined;
    state = 'by-hand';
    displayed = normalizeHeading(next);
    setCommitted(displayed);
    setStatus('Set by hand');
    render();
  }

  startBtn.addEventListener('click', startCompass);
  freezeBtn.addEventListener('click', freeze);
  retakeBtn.addEventListener('click', goLive);

  input.addEventListener('input', () => {
    const raw = input.value.trim();
    const typed = Number(raw);
    // Empty, or anything that isn't a finite number (an overflow like "1e309" parses to Infinity),
    // commits nothing: a NaN heading would pass the host's "!== undefined" Send guard and file a
    // report whose bearing serializes to null.
    if (raw === '' || !Number.isFinite(typed)) {
      setCommitted(undefined);
      return;
    }
    detachToByHand(typed);
  });

  // -- twist ---------------------------------------------------------------
  //
  // Incremental grab-and-follow: each move rotates the rose by the finger's angular *step* about a
  // centre measured once at pointerdown. Applying the step to the current heading (not one captured
  // at grab time) means a live sensor tick between grab and first move cannot make the rose jump,
  // and the centre is not re-measured per move — avoiding a layout reflow on every pointermove.

  let dragCentre: { cx: number; cy: number } | undefined;
  let lastPointerBearing = 0;

  face.addEventListener('pointerdown', (event: PointerEvent) => {
    const rect = svgEl.getBoundingClientRect();
    dragCentre = { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    lastPointerBearing = pointerBearing(dragCentre.cx, dragCentre.cy, event.clientX, event.clientY);
    face.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  face.addEventListener('pointermove', (event: PointerEvent) => {
    if (dragCentre === undefined) return;
    const now = pointerBearing(dragCentre.cx, dragCentre.cy, event.clientX, event.clientY);
    detachToByHand(twistHeading(displayed, lastPointerBearing, now));
    lastPointerBearing = now;
  });

  const endDrag = (event: PointerEvent): void => {
    if (dragCentre === undefined) return;
    dragCentre = undefined;
    if (face.hasPointerCapture(event.pointerId)) face.releasePointerCapture(event.pointerId);
  };
  face.addEventListener('pointerup', endDrag);
  face.addEventListener('pointercancel', endDrag);

  // -- start -------------------------------------------------------------

  if (mode === 'auto' && !needsPermission()) {
    goLive();
  } else if (mode === 'auto') {
    setStatus('Start the compass, or twist the dial to set the bearing');
    render();
  } else {
    setStatus('Twist the dial to set the bearing');
    render();
  }

  return {
    node,
    committedHeading: () => committed,
    destroy: () => stopWatching?.(),
  };
}
