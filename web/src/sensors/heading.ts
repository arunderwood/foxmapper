/**
 * Compass heading. The two platforms disagree about almost everything here.
 *
 * | | iOS Safari | Android Chrome |
 * |---|---|---|
 * | Event | `deviceorientation` + `webkitCompassHeading` | `deviceorientationabsolute` |
 * | Permission | gesture-triggered `requestPermission()` | none |
 * | Value | already a compass heading | `360 - alpha`, plus screen orientation |
 * | Accuracy | `webkitCompassAccuracy` | **nothing — no equivalent exists** |
 *
 * Both give **magnetic**, never true. See declination.ts.
 *
 * **Feature-detect rather than sniff the user agent**: Safari does not implement
 * `deviceorientationabsolute` at all, and listening for it there yields an event that never fires
 * — a compass that silently reads nothing rather than failing.
 */
import { normalizeHeading } from './declination.js';

export interface Heading {
  /** Degrees clockwise from magnetic north. */
  magnetic: number;
  /** iOS only. `undefined` on Android, where the platform exposes nothing. */
  accuracyDegrees?: number;
}

export type HeadingListener = (heading: Heading) => void;

interface IosOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

interface IosDeviceOrientation {
  requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>;
}

/** True when the platform can produce an absolute heading at all. */
export function isCompassAvailable(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/** True when a user gesture must precede any reading (iOS 13+). */
export function needsPermission(): boolean {
  const ctor = (globalThis as { DeviceOrientationEvent?: IosDeviceOrientation })
    .DeviceOrientationEvent;
  return typeof ctor?.requestPermission === 'function';
}

/**
 * Must be called **from inside a user gesture handler** on iOS, or it rejects.
 *
 * Returns true where no permission model exists, so callers do not branch on platform.
 */
export async function requestPermission(): Promise<boolean> {
  const ctor = (globalThis as { DeviceOrientationEvent?: IosDeviceOrientation })
    .DeviceOrientationEvent;
  if (typeof ctor?.requestPermission !== 'function') return true;
  try {
    return (await ctor.requestPermission()) === 'granted';
  } catch {
    // Rejects when not called from a gesture. Not a crash — the reporter types the heading.
    return false;
  }
}

/**
 * Corrects for the device being held in landscape. Android's `alpha` is relative to the device,
 * not the screen, so a phone turned sideways reads 90° off without this.
 */
function screenAngle(): number {
  const angle = screen.orientation?.angle;
  return typeof angle === 'number' ? angle : 0;
}

/**
 * Streams magnetic headings. Returns an unsubscribe function.
 *
 * The reporter always sees the drafted heading and can adjust it before submitting (FR-006), so
 * a wrong reading here is visible rather than silent — which is the only reason it is acceptable
 * to draft from a sensor with 10–30° of error at all.
 */
export function watchHeading(listener: HeadingListener): () => void {
  // Feature-detect, in order of specificity. Safari implements neither `deviceorientationabsolute`
  // nor `absolute` on the plain event, so it falls through to webkitCompassHeading.
  const absoluteSupported = 'ondeviceorientationabsolute' in window;
  const eventName = absoluteSupported ? 'deviceorientationabsolute' : 'deviceorientation';

  const onOrientation = (event: Event): void => {
    const orientation = event as IosOrientationEvent;

    // iOS: already a compass heading, and the only platform that reports its own accuracy.
    if (typeof orientation.webkitCompassHeading === 'number') {
      const accuracy = orientation.webkitCompassAccuracy;
      listener({
        magnetic: normalizeHeading(orientation.webkitCompassHeading),
        // -1 means iOS itself does not trust the reading. Passing it through as a number would
        // record "minus one degrees of error", which is worse than admitting we do not know.
        ...(typeof accuracy === 'number' && accuracy >= 0
          ? { accuracyDegrees: accuracy }
          : {}),
      });
      return;
    }

    // Android: alpha counts anticlockwise from north, so the heading is 360 - alpha.
    if (typeof orientation.alpha === 'number' && (orientation.absolute || absoluteSupported)) {
      listener({ magnetic: normalizeHeading(360 - orientation.alpha - screenAngle()) });
    }
    // A relative-only event carries no compass information. Reporting it would be a heading
    // relative to wherever the phone happened to be pointing when the page loaded.
  };

  window.addEventListener(eventName, onOrientation, true);
  return () => window.removeEventListener(eventName, onOrientation, true);
}
