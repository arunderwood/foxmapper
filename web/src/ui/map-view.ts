/**
 * The map: the primary view.
 *
 * Everything the constitution says must be visible without a tap lives in the status bar here —
 * whether you are seeing everyone's reports or only what this phone holds (FR-018), the unsynced
 * queue depth, and the clock warning. **Never a footer, a tooltip, or a dismissible modal.**
 */
import type { Map as MapLibreMap, SymbolLayerSpecification } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { createBasemap } from '../map/basemap.js';
import { render, type RenderedLog } from '../map/layers.js';
import type { FoldResult } from '../log/fold.js';
import type { ClockOffset } from '../log/clock.js';
import { clockWarning } from './clock-warning.js';
import { queueChip } from './storage.js';
import { shareChip } from './share.js';
import { targetChips, type Target } from './target.js';
import { RETRACT_LABEL } from '../report/retract.js';
import { formatTime, el, clear } from './dom.js';
import { icon } from './icons.js';
import type { PositionState } from '../sensors/position.js';

const WEDGE_SOURCE = 'reports-wedges';
const MARKER_SOURCE = 'reports-markers';

const LABEL_PAINT = {
  'text-color': '#f2f5f8',
  'text-halo-color': '#101418',
  'text-halo-width': 1.5,
} as const;

/**
 * Shared by the wedge and marker labels, so a bearing is attributed exactly as loudly as a marker.
 *
 * **`text-allow-overlap` is true on purpose.** MapLibre's default drops a label that collides with
 * another, and a dropped label leaves the report identified by colour alone — which is the one
 * thing FR-002b forbids. Crowding is the price; a hunt where two reports overlap is exactly the
 * hunt where knowing whose is which matters most.
 */
function labelLayout(): NonNullable<SymbolLayerSpecification['layout']> {
  return {
    // FR-012: the callsign is on every report. Colour is an aid; identity never rests on it.
    'text-field': ['get', 'map_label'],
    'text-size': 12,
    'text-offset': [0, 1.4],
    'text-anchor': 'top',
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  };
}

export interface MapViewState {
  fold: FoldResult;
  /** Undefined until the target is known. Never a stand-in: an invented label is a lie (FR-004b). */
  target: Target | undefined;
  huntCode: string;
  /** False when this device is not connected: it is showing only what it already holds. */
  live: boolean;
  queueDepth: number;
  clockOffset: ClockOffset;
  position: PositionState;
  /** Set by hand when the device cannot supply a position, or supplied a wrong one. */
  placed: { lat: number; lon: number } | undefined;
  tilesUnavailable: boolean;
  /** Opens the point-at-map placement (FR-008a). */
  onPlace: () => void;
  /** Drops the hand-placed position and goes back to the device's own (FR-008a). */
  onUseDevice: () => void;
}

/** What the map may do to a report it is drawing. Retraction is the only one. */
export interface RetractHandler {
  /** True only for a report this participant entered — including one they relayed. */
  can: (reportId: string) => boolean;
  do: (reportId: string) => void;
}

export interface MapViewOptions {
  center: [number, number];
  onTilesUnavailable: () => void;
  retract?: RetractHandler;
}

export class MapView {
  #map: MapLibreMap | undefined;
  #statusBar: HTMLElement;
  #container: HTMLElement;
  #retract: RetractHandler | undefined;
  /** Set while the participant is placing their position by hand; consumed by the next tap. */
  #placing: ((position: { lat: number; lon: number }) => void) | undefined;
  #banner: HTMLElement | undefined;
  /**
   * Built once and re-appended, not rebuilt.
   *
   * `#updateStatus` clears and rebuilds the whole bar on every `#refresh()` — which fires on every
   * position callback, about once a second on a live fix. A chip rebuilt that often cannot hold a
   * result: "Link copied", and the bare link the last-resort branch shows so the code can be read
   * out loud, were both wiped within a second of appearing.
   */
  #shareChip: HTMLElement | undefined;
  /**
   * The deepest the queue got this offline stretch — the denominator of the drain progress.
   * Reset when the queue empties, so the next dead zone starts its own drain from zero.
   */
  #queuePeak = 0;
  /** Shows "All shared" briefly after a drain completes (FR-011): confirmation, then quiet. */
  #syncedUntil = 0;
  #syncedTimer: ReturnType<typeof setTimeout> | undefined;
  #lastState: MapViewState | undefined;
  /** The most recent fold, kept so it can be re-applied once the style is ready. */
  #pending: RenderedLog | undefined;
  /** Map-level listeners survive a style swap; the layers do not. */
  #clickBound = false;
  readonly root: HTMLElement;

  constructor(options: MapViewOptions) {
    this.#retract = options.retract;
    this.#container = el('div', { id: 'map', 'data-testid': 'map' });
    this.#statusBar = el('div', { class: 'status-bar', 'data-testid': 'status-bar' });
    this.root = el('div', { class: 'map-view' }, this.#container, this.#statusBar);

    // The map is created after the element is in the document, so the caller mounts `root` first.
    queueMicrotask(() => {
      this.#map = createBasemap({
        container: this.#container,
        center: options.center,
        onTilesUnavailable: options.onTilesUnavailable,
      });
      // A handle for the E2E suite, which needs to assert what the map is *drawing* rather than
      // what the log holds — the gap between those two is where the render bugs live.
      (window as unknown as { __map?: MapLibreMap }).__map = this.#map;

      // `styledata`, not `load`: the basemap starts blank and swaps in the streets if the network
      // offers, and a swapped style drops every custom source with it. Re-adding here covers the
      // first style and the upgrade with one path.
      //
      // The flush matters as much as the layers: the log comes from IndexedDB and is almost always
      // ready before any style is. Without it a hunter opening the app cold sees empty ground while
      // holding every report, and nothing ever redraws it.
      this.#map.on('styledata', () => {
        this.#addLayers();
        this.#flush();
      });
    });
  }

  #addLayers(): void {
    const map = this.#map;
    // Idempotent: `styledata` fires more than once per style, and re-adding a live source throws.
    if (!map || map.getSource(WEDGE_SOURCE)) return;

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

    // FR-012: a bearing is attributed on the map, not on a tap. Without this the headline report
    // kind is told apart by colour alone, which FR-002b forbids by name — and with nine swatches
    // a hunt of eight will almost always contain a collision.
    map.addLayer({
      id: 'wedge-label',
      type: 'symbol',
      source: WEDGE_SOURCE,
      layout: labelLayout(),
      paint: LABEL_PAINT,
    });

    // omni, null and fix: a circle at a position, and nothing that implies a direction. No arrow,
    // no cone, no radius — interpreting how much ground a null report kills is fusion.
    map.addLayer({
      id: 'marker-circle',
      type: 'circle',
      source: MARKER_SOURCE,
      paint: {
        // Each kind reads as the claim it is. `omni` is sized by the strength reported — the one
        // scalar it carries — so two signal reports are not one indistinguishable dot; `fix` is
        // the biggest and boldest mark on the map. Size never implies a direction.
        // Only an omni carries a strength, so the interpolate reads through `to-number` with a
        // fallback: the `case` above should keep a null from ever reaching it, and this makes the
        // radius defined rather than resting on that.
        'circle-radius': [
          'case',
          ['==', ['get', 'kind'], 'fix'],
          14,
          ['==', ['get', 'kind'], 'omni'],
          ['interpolate', ['linear'], ['to-number', ['get', 'strength'], 5], 2, 6, 8, 12],
          8,
        ],
        'circle-color': [
          'case',
          // "Heard nothing" is drawn hollow: the absence of a signal, not a weak one.
          ['==', ['get', 'kind'], 'null'],
          'rgba(0,0,0,0)',
          ['get', 'colour'],
        ],
        'circle-stroke-color': ['get', 'colour'],
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'kind'], 'null'],
          3,
          ['==', ['get', 'kind'], 'fix'],
          5,
          2,
        ],
        'circle-opacity': 0.85,
      },
    });

    // The voice hop, as a shape as well as a word. The wedges dash their outline for this; a
    // circle cannot dash, so a relayed marker wears a second ring.
    //
    // Belt and braces rather than a fallback: the label survives with the glyph host unreachable
    // (MapLibre shapes the codepoints locally — see basemap.ts), so this is not carrying the
    // requirement alone. It reads at a glance, which "via W7NET" in 12px does not.
    map.addLayer({
      id: 'marker-relay-ring',
      type: 'circle',
      source: MARKER_SOURCE,
      filter: ['==', ['get', 'relayed'], true],
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'kind'], 'fix'],
          20,
          ['==', ['get', 'kind'], 'omni'],
          ['interpolate', ['linear'], ['to-number', ['get', 'strength'], 5], 2, 12, 8, 18],
          14,
        ],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': ['get', 'colour'],
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.9,
      },
    });

    map.addLayer({
      id: 'marker-label',
      type: 'symbol',
      source: MARKER_SOURCE,
      layout: labelLayout(),
      paint: LABEL_PAINT,
    });

    this.#bindClick();
  }

  /**
   * Registered once, on the map rather than the style.
   *
   * A style swap drops the custom sources — which is why `#addLayers` re-runs — but it does not
   * drop map-level listeners. Re-binding here would stack a second popup on every tap for the rest
   * of the hunt, and the blank→streets upgrade guarantees it happens.
   */
  #bindClick(): void {
    const map = this.#map;
    if (!map || this.#clickBound) return;
    this.#clickBound = true;

    // Placing wins over inspecting: a tap during placement is an answer to the question the banner
    // asked, even if a wedge happens to be under the thumb.
    map.on('click', (event) => {
      const place = this.#placing;
      if (!place) return;
      this.#endPlacing();
      place({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    map.on('click', ['wedge-fill', 'marker-circle'], (event) => {
      if (this.#placing) return;
      const feature = event.features?.[0];
      if (feature) this.#showDetail(event.lngLat, feature.properties as Record<string, unknown>);
    });
  }

  /**
   * Point-at-map: the second entry method (FR-008a).
   *
   * The device default drafts a position from GPS. This is the other one — and it is not a fallback
   * for a broken phone, it is how a hunter under canopy, in a denied-permission tab, or standing
   * somewhere their phone insists is half a mile away files an honest report.
   */
  beginPlacing(prompt: string, onPlaced: (position: { lat: number; lon: number }) => void): void {
    this.#endPlacing();
    this.#placing = onPlaced;
    this.#container.classList.add('placing');

    const cancel = el('button', { type: 'button', 'data-testid': 'cancel-placing' }, 'Cancel');
    cancel.addEventListener('click', () => this.#endPlacing());

    this.#banner = el(
      'div',
      { class: 'banner', 'data-testid': 'placing-banner' },
      icon('edit_location', { label: prompt }),
      el('span', { class: 'banner-text' }, prompt),
      cancel,
    );
    this.root.append(this.#banner);
  }

  #endPlacing(): void {
    this.#placing = undefined;
    this.#container.classList.remove('placing');
    this.#banner?.remove();
    this.#banner = undefined;
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
    if (properties['clock_unknown'])
      lines.push('That phone never checked its clock — time may be off');
    if (properties['clock_suspect'])
      lines.push('That phone’s clock was wrong — time is approximate');

    const content = el('div', { class: 'popup', 'data-testid': 'report-detail' });
    for (const line of lines) content.append(el('p', {}, line));

    // FR-010, and only for a report this phone entered. There is no moderator and no appeal: a
    // report is a fact about what someone said, and only the person who said it may withdraw it.
    const id = String(properties['report_id']);
    const popup = new maplibregl.Popup({ closeButton: true });
    if (this.#retract?.can(id)) {
      const button = el(
        'button',
        { type: 'button', class: 'danger', 'data-testid': 'retract' },
        RETRACT_LABEL,
      );
      button.addEventListener('click', () => {
        this.#retract?.do(id);
        popup.remove();
      });
      content.append(button);
    }

    popup.setLngLat(lngLat).setDOMContent(content).addTo(this.#map!);
  }

  update(state: MapViewState): void {
    this.#pending = render(state.fold);
    this.#flush();

    // Drain accounting (FR-011): the peak is the denominator, and reaching zero from a real
    // drain earns a brief "all shared" confirmation before the bar goes quiet again.
    if (state.queueDepth > this.#queuePeak) this.#queuePeak = state.queueDepth;
    if (this.#queuePeak > 0 && state.queueDepth === 0) {
      this.#queuePeak = 0;
      this.#syncedUntil = Date.now() + 2000;
      clearTimeout(this.#syncedTimer);
      // The bar rebuilds on every position tick anyway; this only guarantees the flash also
      // *ends* on time when the phone is sitting still.
      this.#syncedTimer = setTimeout(() => {
        if (this.#lastState) this.#updateStatus(this.#lastState);
      }, 2100);
    }

    this.#lastState = state;
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

    // FR-018. A hunter acting on this map must know whether it is the whole picture. "Everyone's
    // reports" and "only mine" look identical otherwise, and the difference is the whole point.
    // Each state is an icon + colour + shape triple (data-model.md §3) — never colour alone.
    const syncChip = state.live
      ? el(
          'span',
          { class: 'chip ok', 'data-testid': 'sync-state', 'data-state': 'live' },
          icon('cloud_done', { label: 'Everyone’s reports' }),
          el('span', { class: 'chip-label' }, 'Everyone’s reports'),
        )
      : el(
          'span',
          { class: 'chip warn', 'data-testid': 'sync-state', 'data-state': 'offline' },
          icon('cloud_off', { label: 'No signal' }),
          el('span', { class: 'chip-label' }, 'No signal — this phone only'),
        );

    const chips: (HTMLElement | undefined)[] = [
      ...targetChips(state.target, state.fold.found),

      // FR-001: the code is how a hunt is shared, and it is normally read aloud over a repeater.
      // A creator whose only copy of it is the address bar has not been given anything.
      (this.#shareChip ??= shareChip(state.huntCode)),

      syncChip,

      queueChip(state.queueDepth, state.live, this.#drainedFraction(state.queueDepth)),

      // The drain just finished: say so, briefly, then get out of the way (FR-011).
      Date.now() < this.#syncedUntil
        ? el(
            'span',
            { class: 'chip ok', 'data-testid': 'sync-flash' },
            icon('cloud_done', { label: 'All shared' }),
            el('span', { class: 'chip-label' }, 'All shared'),
          )
        : undefined,

      clockWarning(state.clockOffset),

      // Where the hunter is reporting from, and how that was established. A report needs one of
      // these two to exist at all — there is no third case where the map guesses.
      positionChip(state, this.#placeButton(state.onPlace)),

      // Not an error. Blank ground is what a hunt looks like out of coverage, and the map is still
      // drawing every report the device holds.
      state.tilesUnavailable
        ? el(
            'span',
            { class: 'chip dim', 'data-testid': 'tiles-state' },
            icon('layers_clear', { label: 'No map out here' }),
            el('span', { class: 'chip-label' }, 'No map out here — reports still show'),
          )
        : undefined,
    ];

    this.#statusBar.append(...chips.filter((c): c is HTMLElement => c !== undefined));
  }

  /** How much of this drain is already through: the determinate part of the draining chip. */
  #drainedFraction(depth: number): number {
    if (this.#queuePeak === 0) return 0;
    return (this.#queuePeak - depth) / this.#queuePeak;
  }

  /** Always offered, never only on failure: a measured fix can be wrong, and FR-008 says so. */
  #placeButton(onPlace: () => void): HTMLElement {
    const button = el(
      'button',
      { type: 'button', class: 'chip-action', 'data-testid': 'place-position' },
      icon('edit_location', { label: 'Set where you are' }),
      el('span', { class: 'chip-label' }, 'Set where you are'),
    );
    button.addEventListener('click', onPlace);
    return button;
  }

  center(lngLat: [number, number]): void {
    this.#map?.easeTo({ center: lngLat, zoom: Math.max(this.#map.getZoom(), 12) });
  }

  destroy(): void {
    this.#map?.remove();
  }
}

/**
 * The position chip, which is the honest answer to "can this phone file a report right now".
 *
 * A hand-placed position outranks a measured one: a hunter who placed themselves did it because
 * the device was wrong or absent, and silently preferring GPS afterwards would overrule them.
 */
function positionChip(state: MapViewState, place: HTMLElement): HTMLElement {
  // `data-ready` is the honest summary of "can this phone file a report at all", and the only
  // thing on the page that answers it. The E2E suite waits on it rather than on a timer.
  if (state.placed) {
    // FR-008a needs *both* methods reachable. Placing used to be one-way: the hunter who set
    // themselves under canopy and then walked into the open had no way to say so, and every report
    // for the rest of the hunt came from where they used to be.
    const back = state.position.status === 'ready' ? useDeviceButton(state.onUseDevice) : undefined;

    return el(
      'span',
      {
        class: 'chip chip-with-action',
        'data-testid': 'gps-state',
        'data-ready': 'true',
        'data-state': 'placed',
      },
      icon('edit_location', { label: 'From the spot you set' }),
      el('span', { class: 'chip-label' }, 'From the spot you set'),
      place,
      ...(back ? [back] : []),
    );
  }
  if (state.position.status === 'ready') {
    return el(
      'span',
      {
        class: 'chip chip-with-action',
        'data-testid': 'gps-state',
        'data-ready': 'true',
        'data-state': 'gps-ok',
      },
      icon('my_location', { label: 'From your phone’s fix' }),
      el('span', { class: 'chip-label' }, 'From your phone’s fix'),
      place,
    );
  }

  // No fix and nothing placed: there is no position, and a report cannot be filed from nowhere.
  // Saying so is the whole of T075 — the alternative is a wedge drawn from a coordinate the
  // hunter never stood on, labelled as though they chose it.
  const message =
    state.position.status === 'acquiring'
      ? 'Finding your position — or set it yourself'
      : state.position.status === 'denied'
        ? 'No location access — set where you are'
        : 'No position from this phone — set where you are';

  return el(
    'span',
    {
      class: 'chip danger chip-with-action',
      'data-testid': 'gps-state',
      'data-ready': 'false',
      'data-state': 'gps-lost',
    },
    icon('location_disabled', { label: message }),
    el('span', { class: 'chip-label' }, message),
    place,
  );
}

/** Offered only when there is a device fix to go back to — never as a dead control. */
function useDeviceButton(onUseDevice: () => void): HTMLElement {
  const button = el(
    'button',
    { type: 'button', class: 'chip-action', 'data-testid': 'use-device-position' },
    icon('my_location', { label: 'Use my phone’s fix' }),
    el('span', { class: 'chip-label' }, 'Use my phone’s fix'),
  );
  button.addEventListener('click', onUseDevice);
  return button;
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
