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
 * reach, and every report still draws on top of it. A designed empty state, coloured from the
 * token set (`--fx-color-map-ground`) rather than a hex of its own.
 */
function blankStyle(): StyleSpecification {
  // Read at map creation; the committed token value stands in if the stylesheet is somehow
  // absent. A LIGHT ground on purpose, and this is a decision the dark re-skin must not touch:
  // the per-callsign report colours are a wire-format guarantee tuned to sit on a street map
  // (docs/log-format.md), and they must stay legible when the streets never arrive.
  const ground =
    getComputedStyle(document.documentElement).getPropertyValue('--fx-color-map-ground').trim() ||
    '#F6F0EA';

  return {
    version: 8,
    sources: {},
    // The label font, from the tile host — which is fine, and is *not* what the callsigns depend
    // on. When a glyph range cannot be fetched MapLibre shapes the codepoints locally instead, so
    // a report keeps its callsign with this host unreachable. Verified rather than assumed, on
    // both engines, in tests/e2e/basemap.spec.ts — FR-002b ("no interface may rely on colour
    // alone") rests on it, and it is a behaviour of a dependency rather than of our code.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      {
        id: 'blank-ground',
        type: 'background',
        paint: { 'background-color': ground },
      },
    ],
  };
}

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
    style: blankStyle(),
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
  const standIn = new maplibregl.AttributionControl({
    compact: true,
    customAttribution: ATTRIBUTION,
  });
  map.addControl(standIn);

  void upgradeToStreets(map, options.onTilesUnavailable, () => {
    // The streets are in, and their sources name the licence themselves. Keeping ours as well
    // printed the same sentence twice, side by side, across most of the width of a phone — the one
    // piece of furniture already competing with the map for room.
    map.removeControl(standIn);
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
  });
  return map;
}

/**
 * Fetches the real style and swaps it in. Never awaited by the caller: the map is already usable,
 * and this only adds context.
 */
async function upgradeToStreets(
  map: MapLibreMap,
  onUnavailable?: () => void,
  onUpgraded?: () => void,
): Promise<void> {
  try {
    const response = await fetch(STYLE_URL);
    if (!response.ok) throw new Error(`style ${response.status}`);
    const style = (await response.json()) as StyleSpecification;

    // The map may already be gone if the hunter navigated away while this was in flight.
    if (!map.getContainer().isConnected) return;

    // `diff: false` because the two styles share nothing. The report layers are re-added by the
    // view on `styledata`, which fires for the new style as well as the blank one.
    map.setStyle(style, { diff: false });

    // Only hand over the licence to a style that actually carries it. A style whose sources named
    // no attribution would leave the map with none at all, which is the one outcome worse than
    // saying it twice.
    if (Object.values(style.sources).some((source) => 'attribution' in source)) onUpgraded?.();
  } catch {
    // No basemap. The map keeps working, the reports keep drawing, and the hunter is told once —
    // as a fact about the ground, not as an error to dismiss.
    onUnavailable?.();
  }
}
