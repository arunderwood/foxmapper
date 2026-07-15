/**
 * The basemap.
 *
 * **There is no offline basemap, and that is a recorded decision rather than a shortfall.** Every
 * tile provider that could supply an offline archive prohibits it by name — OSMF's policies list
 * "downloading of tiles in advance instead of downloading when a user views those tiles" as the
 * prohibited example, with offline use named as the case.
 *
 * So offline, in ground the hunter has not already looked at, this renders reports and positions
 * over blank space rather than streets. Principle III's own wording is "degrading only to the
 * reports the device already holds": no report is lost or blocked, and the picture still renders.
 * It is the *context* that goes.
 *
 * If the blank map proves useless outdoors, the field gate will say so — and that answer is worth
 * more than a tile pipeline built on a guess.
 */
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';

/** No API key, no registration, no cookies, and no open-core — self-hosting stays available. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Required by the licence, and shown always — including when no tile ever loads. */
export const ATTRIBUTION = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';

export interface BasemapOptions {
  container: HTMLElement;
  center: [number, number];
  zoom?: number;
  /** Called when tiles cannot be fetched. This is the normal field case, not an error. */
  onTilesUnavailable?: () => void;
}

export function createBasemap(options: BasemapOptions): MapLibreMap {
  const map = new maplibregl.Map({
    container: options.container,
    style: STYLE_URL,
    center: options.center,
    zoom: options.zoom ?? 12,
    attributionControl: false,
    // Never pre-fetch. OSMF's policy forbids pre-emptive fetching specifically; tiles the hunter
    // actually viewed while in coverage legitimately stay cached, and ground already looked at
    // stays drawn. That mitigation costs nothing and breaks no policy.
    // MapLibre does not prefetch beyond the viewport by default; this makes the intent explicit.
    maxTileCacheSize: 200,
  });

  map.addControl(
    new maplibregl.AttributionControl({ compact: false, customAttribution: ATTRIBUTION }),
  );

  map.on('error', (event) => {
    // An unreachable tile host is what a hunt looks like. Surfacing it as an error would train
    // hunters to dismiss a warning, and the map is still doing its job: it is drawing reports.
    const isTileError = event.error && 'status' in event.error;
    if (isTileError) {
      options.onTilesUnavailable?.();
      return;
    }
    console.warn('map error', event.error);
  });

  return map;
}
