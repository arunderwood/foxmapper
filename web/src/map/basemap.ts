/**
 * The basemap.
 *
 * **There is no offline basemap, and that is a recorded decision rather than a shortfall.** Every
 * tile provider that could supply an offline archive prohibits it by name — OSMF's policies list
 * "downloading of tiles in advance instead of downloading when a user views those tiles" as the
 * prohibited example, with offline use named as the case.
 *
 * So the map **starts blank and upgrades if the network offers**, rather than starting with the
 * streets and degrading. That ordering is Principle III: the map is usable the instant it exists,
 * the reports draw with no network at all, and the basemap is an enhancement that arrives late or
 * never. Booting from a remote style would mean a failed fetch leaves the map with no layers and
 * no reports — which is what a hunt out of coverage looks like, i.e. the normal case.
 */
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';

/** No API key, no registration, no cookies, and no open-core — self-hosting stays available. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Required by the licence, and shown always — including when no tile ever loads. */
export const ATTRIBUTION = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';

/**
 * Blank ground. Not an error state — this is what a hunt looks like where cell coverage does not
 * reach, and every report still draws on top of it.
 */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  // The label font. Fetched from the same host, so offline the callsigns fall back to whatever is
  // cached — the shapes and colours still carry the report either way.
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'blank-ground',
      type: 'background',
      // A light ground rather than black: the report colours are chosen to sit on a street map,
      // and they must stay legible when the streets never arrive.
      paint: { 'background-color': '#f5f2ef' },
    },
  ],
};

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
    style: BLANK_STYLE,
    center: options.center,
    zoom: options.zoom ?? 12,
    attributionControl: false,
    // Never pre-fetch. OSMF's policy forbids pre-emptive fetching specifically; tiles the hunter
    // actually viewed while in coverage legitimately stay cached, and ground already looked at
    // stays drawn. That mitigation costs nothing and breaks no policy.
    maxTileCacheSize: 200,
  });

  // The style's own sources carry the required attribution once they load. Until then ours stands
  // in, so the licence is honoured even on a map that never fetches a tile.
  map.addControl(
    new maplibregl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }),
  );

  void upgradeToStreets(map, options.onTilesUnavailable);
  return map;
}

/**
 * Fetches the real style and swaps it in. Never awaited by the caller: the map is already usable,
 * and this only adds context.
 */
async function upgradeToStreets(map: MapLibreMap, onUnavailable?: () => void): Promise<void> {
  try {
    const response = await fetch(STYLE_URL);
    if (!response.ok) throw new Error(`style ${response.status}`);
    const style = (await response.json()) as StyleSpecification;

    // The map may already be gone if the hunter navigated away while this was in flight.
    if (!map.getContainer().isConnected) return;

    // `diff: false` because the two styles share nothing. The report layers are re-added by the
    // view on `styledata`, which fires for the new style as well as the blank one.
    map.setStyle(style, { diff: false });
  } catch {
    // No basemap. The map keeps working, the reports keep drawing, and the hunter is told once —
    // as a fact about the ground, not as an error to dismiss.
    onUnavailable?.();
  }
}
