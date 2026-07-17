/**
 * Compass heading — the transformation, not the sensor.
 *
 * This module was the last untested one in `src/`, and it is the one where a silent error costs the
 * most: every bearing in the product goes through it, and a sign error in `360 - alpha` yields a
 * heading that is confidently, plausibly wrong. `research.md § 5` establishes what the platforms
 * *give* us (both magnetic, from WebKit and Chromium source). What nobody had checked is what we do
 * with it.
 *
 * A phone cannot tell us any of this — a phone tells us the platform delivers an event, which the
 * research already settled from source. What a phone cannot do is prove `360 - alpha - screenAngle`
 * has the right sign at 90° of screen rotation, or that iOS's `-1` accuracy sentinel is refused.
 * Synthetic events can, in milliseconds, on every branch, forever.
 *
 * The window is faked rather than pulling in jsdom: `watchHeading` touches `addEventListener` and
 * `screen.orientation.angle` and nothing else, so a real DOM would add a dependency and prove no
 * more.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { watchHeading, needsPermission, type Heading } from '../../src/sensors/heading.js';

type Listener = (event: unknown) => void;

/** A window with exactly the surface `watchHeading` reaches for. */
function fakeWindow(options: { absolute: boolean; screenAngle?: number }) {
  const listeners = new Map<string, Listener[]>();
  const win: Record<string, unknown> = {
    addEventListener: (name: string, fn: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
    removeEventListener: (name: string, fn: Listener) => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((f) => f !== fn),
      );
    },
  };
  // The feature-detect is `'ondeviceorientationabsolute' in window` — presence, not truthiness.
  if (options.absolute) win['ondeviceorientationabsolute'] = null;

  (globalThis as Record<string, unknown>)['window'] = win;
  (globalThis as Record<string, unknown>)['screen'] = {
    orientation: { angle: options.screenAngle ?? 0 },
  };

  return {
    /** Fire an event as the platform would, and return what the listener was told. */
    emit(name: string, event: unknown): Heading[] {
      for (const fn of listeners.get(name) ?? []) fn(event);
      return captured.splice(0);
    },
    listenerCount: (name: string) => (listeners.get(name) ?? []).length,
  };
}

const captured: Heading[] = [];
const collect = (h: Heading) => captured.push(h);

afterEach(() => {
  captured.length = 0;
  delete (globalThis as Record<string, unknown>)['window'];
  delete (globalThis as Record<string, unknown>)['screen'];
  delete (globalThis as Record<string, unknown>)['DeviceOrientationEvent'];
});

describe('iOS — webkitCompassHeading', () => {
  it('takes the compass heading as given: it is already a heading', () => {
    const w = fakeWindow({ absolute: false });
    watchHeading(collect);
    // Safari implements neither `deviceorientationabsolute` nor `absolute`, so it must fall through
    // to the plain event. Listening for the absolute one there yields a compass that never fires.
    expect(w.listenerCount('deviceorientation')).toBe(1);

    expect(w.emit('deviceorientation', { webkitCompassHeading: 90 })).toEqual([{ magnetic: 90 }]);
  });

  it('records the accuracy iOS reports', () => {
    const w = fakeWindow({ absolute: false });
    watchHeading(collect);
    expect(
      w.emit('deviceorientation', { webkitCompassHeading: 12, webkitCompassAccuracy: 15 }),
    ).toEqual([{ magnetic: 12, accuracyDegrees: 15 }]);
  });

  it('refuses the -1 sentinel rather than recording "minus one degrees of error"', () => {
    // iOS uses -1 to say it does not trust the reading. Passing it through as a number would put a
    // negative error bar in an immutable log — worse than admitting we do not know.
    const w = fakeWindow({ absolute: false });
    watchHeading(collect);
    const [heading] = w.emit('deviceorientation', {
      webkitCompassHeading: 200,
      webkitCompassAccuracy: -1,
    });
    expect(heading).toEqual({ magnetic: 200 });
    expect(heading).not.toHaveProperty('accuracyDegrees');
  });

  it('wraps a heading the platform reports out of range', () => {
    const w = fakeWindow({ absolute: false });
    watchHeading(collect);
    expect(w.emit('deviceorientation', { webkitCompassHeading: 370 })).toEqual([{ magnetic: 10 }]);
  });
});

describe('Android — deviceorientationabsolute', () => {
  it('listens for the absolute event where it exists', () => {
    const w = fakeWindow({ absolute: true });
    watchHeading(collect);
    expect(w.listenerCount('deviceorientationabsolute')).toBe(1);
    expect(w.listenerCount('deviceorientation')).toBe(0);
  });

  it('converts alpha to a heading: alpha counts anticlockwise, a heading does not', () => {
    const w = fakeWindow({ absolute: true });
    watchHeading(collect);
    // 360 - 90 = 270. Get this sign wrong and every Android bearing is mirrored about north.
    expect(w.emit('deviceorientationabsolute', { alpha: 90, absolute: true })).toEqual([
      { magnetic: 270 },
    ]);
  });

  it('corrects for a rotated screen', () => {
    const w = fakeWindow({ absolute: true, screenAngle: 90 });
    watchHeading(collect);
    // 360 - 90 - 90 = 180. A hunter holding the phone sideways is not pointing 90° off.
    expect(w.emit('deviceorientationabsolute', { alpha: 90, absolute: true })).toEqual([
      { magnetic: 180 },
    ]);
  });

  it('never invents an accuracy — Android exposes none', () => {
    // research.md § 5: "iOS exposes webkitCompassAccuracy. Android exposes nothing." A number here
    // would be fabricated provenance, and no code can fix the platform gap.
    const w = fakeWindow({ absolute: true });
    watchHeading(collect);
    const [heading] = w.emit('deviceorientationabsolute', { alpha: 0, absolute: true });
    expect(heading).not.toHaveProperty('accuracyDegrees');
  });

  it('wraps past north', () => {
    const w = fakeWindow({ absolute: true, screenAngle: 90 });
    watchHeading(collect);
    // 360 - 350 - 90 = -80 → 280.
    expect(w.emit('deviceorientationabsolute', { alpha: 350, absolute: true })).toEqual([
      { magnetic: 280 },
    ]);
  });
});

describe('what must never reach the log', () => {
  it('ignores a relative-only event: it carries no compass information', () => {
    // A relative event's alpha is measured from wherever the phone happened to point when the page
    // loaded. Reporting it would be a bearing from an arbitrary origin — plausible and meaningless.
    const w = fakeWindow({ absolute: false });
    watchHeading(collect);
    expect(w.emit('deviceorientation', { alpha: 90, absolute: false })).toEqual([]);
  });

  it('ignores an event with no orientation at all', () => {
    const w = fakeWindow({ absolute: false });
    watchHeading(collect);
    expect(w.emit('deviceorientation', {})).toEqual([]);
  });

  it('stops listening when told to', () => {
    const w = fakeWindow({ absolute: true });
    const stop = watchHeading(collect);
    stop();
    expect(w.listenerCount('deviceorientationabsolute')).toBe(0);
    expect(w.emit('deviceorientationabsolute', { alpha: 90, absolute: true })).toEqual([]);
  });
});

describe('the iOS permission gate', () => {
  it('is needed only where requestPermission exists', () => {
    fakeWindow({ absolute: false });
    expect(needsPermission()).toBe(false);

    (globalThis as Record<string, unknown>)['DeviceOrientationEvent'] = {
      requestPermission: () => Promise.resolve('granted'),
    };
    expect(needsPermission()).toBe(true);
  });
});
