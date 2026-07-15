/**
 * The map: the primary view.
 *
 * Everything the constitution says must be visible without a tap lives in the status bar here —
 * whether you are seeing everyone's reports or only what this phone holds (FR-018), the unsynced
 * queue depth, and the clock warning. **Never a footer, a tooltip, or a dismissible modal.**
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { createBasemap } from '../map/basemap.js';
import { render, type RenderedLog } from '../map/layers.js';
import type { FoldResult } from '../log/fold.js';
import type { ClockOffset } from '../log/clock.js';
import { clockWarning } from './clock-warning.js';
import { queueChip } from './storage.js';
import { targetChips, type Target } from './target.js';
import { formatTime, el, clear } from './dom.js';
import type { PositionState } from '../sensors/position.js';

const WEDGE_SOURCE = 'reports-wedges';
const MARKER_SOURCE = 'reports-markers';

export interface MapViewState {
  fold: FoldResult;
  target: Target;
  /** False when this device is not connected: it is showing only what it already holds. */
  live: boolean;
  queueDepth: number;
  clockOffset: ClockOffset;
  position: PositionState;
  tilesUnavailable: boolean;
}

export class MapView {
  #map: MapLibreMap | undefined;
  #statusBar: HTMLElement;
  #container: HTMLElement;
  /** The most recent fold, kept so it can be re-applied once the style is ready. */
  #pending: RenderedLog | undefined;
  readonly root: HTMLElement;

  constructor(center: [number, number], onTilesUnavailable: () => void) {
    this.#container = el('div', { id: 'map', 'data-testid': 'map' });
    this.#statusBar = el('div', { class: 'status-bar', 'data-testid': 'status-bar' });
    this.root = el('div', { class: 'map-view' }, this.#container, this.#statusBar);

    // The map is created after the element is in the document, so the caller mounts `root` first.
    queueMicrotask(() => {
      this.#map = createBasemap({
        container: this.#container,
        center,
        onTilesUnavailable,
      });
      this.#map.on('load', () => {
        this.#addLayers();
        // The log is almost always ready before the style is — it comes from IndexedDB, and the
        // style comes from the network. Without this, a hunter opening the app cold sees an empty
        // map while holding every report, and nothing ever redraws it.
        this.#flush();
      });
    });
  }

  #addLayers(): void {
    const map = this.#map;
    if (!map) return;

    const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
    map.addSource(WEDGE_SOURCE, { type: 'geojson', data: empty() });
    map.addSource(MARKER_SOURCE, { type: 'geojson', data: empty() });

    // A bearing is a bounded sector: width is the reporter's stated confidence, length their
    // stated range. Both come from the report; neither is a default wearing their name.
    map.addLayer({
      id: 'wedge-fill',
      type: 'fill',
      source: WEDGE_SOURCE,
      paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.22 },
    });
    map.addLayer({
      id: 'wedge-line',
      type: 'line',
      source: WEDGE_SOURCE,
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': 2,
        // A relayed report crossed a voice hop, which is where error enters. Dashed, in the
        // primary view, not in a tooltip.
        'line-dasharray': ['case', ['get', 'relayed'], ['literal', [2, 2]], ['literal', [1, 0]]],
      },
    });

    // omni, null and fix: a circle at a position, and nothing that implies a direction. No arrow,
    // no cone, no radius — interpreting how much ground a null report kills is fusion.
    map.addLayer({
      id: 'marker-circle',
      type: 'circle',
      source: MARKER_SOURCE,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'kind'], 'fix'], 11, 8],
        'circle-color': [
          'case',
          // "Heard nothing" is drawn hollow: the absence of a signal, not a weak one.
          ['==', ['get', 'kind'], 'null'],
          'rgba(0,0,0,0)',
          ['get', 'colour'],
        ],
        'circle-stroke-color': ['get', 'colour'],
        'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'null'], 3, 2],
        'circle-opacity': 0.85,
      },
    });
    map.addLayer({
      id: 'marker-label',
      type: 'symbol',
      source: MARKER_SOURCE,
      layout: {
        // FR-012: the callsign is on every report. Colour is an aid; identity never rests on it.
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#f2f5f8',
        'text-halo-color': '#101418',
        'text-halo-width': 1.5,
      },
    });

    map.on('click', ['wedge-fill', 'marker-circle'], (event) => {
      const feature = event.features?.[0];
      if (feature) this.#showDetail(event.lngLat, feature.properties as Record<string, unknown>);
    });
  }

  #showDetail(lngLat: maplibregl.LngLat, properties: Record<string, unknown>): void {
    const lines = [
      `${String(properties['label'])} — ${describeKind(String(properties['kind']))}`,
      formatTime(Number(properties['display_at'])),
    ];

    // Every caveat the report carries travels with it. The map must not read as more certain than
    // the report it is drawing.
    if (properties['relayed']) {
      lines.push(`Relayed by ${String(properties['entered_by'])} over the air`);
    }
    if (properties['placed']) lines.push('Position set by hand');
    if (properties['clock_unknown']) lines.push('That phone never checked its clock — time may be off');
    if (properties['clock_suspect']) lines.push('That phone’s clock was wrong — time is approximate');

    new maplibregl.Popup({ closeButton: true })
      .setLngLat(lngLat)
      .setText(lines.join('\n'))
      .addTo(this.#map!);
  }

  update(state: MapViewState): void {
    this.#pending = render(state.fold);
    this.#flush();
    this.#updateStatus(state);
  }

  /** Pushes the latest fold to the map, if the style is ready to receive it. */
  #flush(): void {
    const map = this.#map;
    const rendered = this.#pending;
    if (!map || !rendered) return;

    const wedges = map.getSource(WEDGE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const markers = map.getSource(MARKER_SOURCE) as maplibregl.GeoJSONSource | undefined;
    // Not yet — the sources arrive with the style. `#pending` holds the fold until `load` fires.
    if (!wedges || !markers) return;

    wedges.setData(rendered.wedges);
    markers.setData(rendered.markers);
  }

  #updateStatus(state: MapViewState): void {
    clear(this.#statusBar);
    const chips: (HTMLElement | undefined)[] = [
      ...targetChips(state.target, state.fold.found),

      // FR-018. A hunter acting on this map must know whether it is the whole picture. "Everyone's
      // reports" and "only mine" look identical otherwise, and the difference is the whole point.
      state.live
        ? el('span', { class: 'chip', 'data-testid': 'sync-state' }, 'Showing everyone’s reports')
        : el(
            'span',
            { class: 'chip warn', 'data-testid': 'sync-state' },
            'No signal — showing only what this phone has',
          ),

      queueChip(state.queueDepth),
      clockWarning(state.clockOffset),

      state.position.status === 'acquiring'
        ? el('span', { class: 'chip', 'data-testid': 'gps-state' }, 'Finding your position…')
        : undefined,
      state.position.status === 'denied'
        ? el('span', { class: 'chip danger', 'data-testid': 'gps-state' }, 'No location access — place your position by hand')
        : undefined,

      // Not an error. Blank ground is what a hunt looks like out of coverage, and the map is still
      // drawing every report the device holds.
      state.tilesUnavailable
        ? el('span', { class: 'chip', 'data-testid': 'tiles-state' }, 'Map background unavailable out here — reports still show')
        : undefined,
    ];

    this.#statusBar.append(...chips.filter((c): c is HTMLElement => c !== undefined));
  }

  center(lngLat: [number, number]): void {
    this.#map?.easeTo({ center: lngLat, zoom: Math.max(this.#map.getZoom(), 12) });
  }

  destroy(): void {
    this.#map?.remove();
  }
}

function describeKind(kind: string): string {
  switch (kind) {
    case 'bearing':
      return 'bearing';
    case 'omni':
      return 'heard a signal';
    case 'null':
      return 'heard nothing here';
    case 'fix':
      return 'found the fox';
    default:
      return kind;
  }
}
