/**
 * Device position.
 *
 * Platform geolocation works dataless on both platforms — GPS needs no cell connection, which is
 * what makes Principle III's "reports keep working with no network" true rather than aspirational.
 */

export interface Fix {
  lat: number;
  lon: number;
  /**
   * Device-reported, **advisory only**. W3C says 95% confidence, Android reports the 68th
   * percentile, and Apple documents no percentile at all: three meanings, one number. Use it as a
   * relative quality hint and never weight anything with it.
   */
  accuracy_m: number;
  at: number;
}

export type PositionState =
  | { status: 'acquiring' }
  | { status: 'ready'; fix: Fix }
  | { status: 'denied' }
  | { status: 'unavailable' };

export type PositionListener = (state: PositionState) => void;

/**
 * Above this, the fix is almost certainly the first coarse network-derived one rather than GPS.
 * Kilometre-scale error would put a bearing's origin in the wrong valley.
 */
const COARSE_FIX_M = 1_000;

export function watchPosition(listener: PositionListener): () => void {
  if (!('geolocation' in navigator)) {
    listener({ status: 'unavailable' });
    return () => {};
  }

  // "Acquiring" is an honest state, and it is shown rather than hidden behind a spinner that
  // implies the app is loading. A hunter needs to know the fix is not ready yet.
  listener({ status: 'acquiring' });

  const id = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;

      // Discard early km-scale fixes rather than rendering a report a kilometre from where the
      // hunter stood. They resolve within seconds; a wrong origin persists in the log forever.
      if (accuracy > COARSE_FIX_M) {
        listener({ status: 'acquiring' });
        return;
      }

      listener({
        status: 'ready',
        fix: { lat: latitude, lon: longitude, accuracy_m: accuracy, at: position.timestamp },
      });
    },
    (error) => {
      listener(
        error.code === error.PERMISSION_DENIED ? { status: 'denied' } : { status: 'unavailable' },
      );
    },
    {
      enableHighAccuracy: true,
      // Long timeout: a cold GPS fix under tree cover legitimately takes this long, and giving up
      // early would send the hunter to manual placement for no reason.
      timeout: 30_000,
      maximumAge: 0,
    },
  );

  return () => navigator.geolocation.clearWatch(id);
}
