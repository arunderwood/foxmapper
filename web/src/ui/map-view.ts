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
import { formatTime, el, clear, cssToken } from './dom.js';
import { icon, iconPath } from './icons.js';
import { PALETTE } from '../log/colour.js';
import { KIND_ICONS, type ReportKind } from './report-entry.js';
import type { PositionState } from '../sensors/position.js';

const WEDGE_SOURCE = 'reports-wedges';
const MARKER_SOURCE = 'reports-markers';
/** The hand-placed position, as map data rather than a DOM marker — see #addLayers. */
const PLACED_SOURCE = 'placed-position';
/** The device's own GPS fix, as map data. Shown only when nothing was placed by hand. */
const DEVICE_SOURCE = 'device-position';

/**
 * Resolved when layers are added, not at import: the values come from the token set, and the
 * stylesheet must be live to answer. Light ink with a dark halo reads on both grounds — the
 * street style and the blank light fallback.
 */
function labelPaint(): {
  'text-color': string;
  'text-halo-color': string;
  'text-halo-width': number;
} {
  return {
    'text-color': cssToken('--md-sys-color-on-surface', '#EFDFDB'),
    'text-halo-color': cssToken('--md-sys-color-surface', '#191210'),
    'text-halo-width': 1.5,
  };
}

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
  /** Per-device setting (settings.ts): when false, no relay affordance exists anywhere. */
  relayMode: boolean;
  /** Armed relay target: the next report files as this observer's. One report per arming. */
  relayTarget: { callsign: string; position: { lat: number; lon: number } } | undefined;
  onOpenSettings: () => void;
  onBeginRelay: () => void;
  onCancelRelay: () => void;
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
  /** The hand-placed position, held for re-application when a style swap recreates sources. */
  #placedPosition: { lat: number; lon: number } | undefined;
  /** The device fix, held for the same re-application. Cleared while a hand-placed position wins. */
  #devicePosition: { lat: number; lon: number } | undefined;
  /** Marks the armed relay target's position while a relayed report is being filed. */
  #relayPin: maplibregl.Marker | undefined;
  /** Shows "All shared" briefly after a drain completes (FR-011): confirmation, then quiet. */
  #syncedUntil = 0;
  #syncedTimer: ReturnType<typeof setTimeout> | undefined;
  #lastState: MapViewState | undefined;
  /** The most recent fold, kept so it can be re-applied once the style is ready. */
  #pending: RenderedLog | undefined;
  /** Map-level listeners survive a style swap; the layers do not. */
  #clickBound = false;
  /** The browser event a placement tap consumed — the detail listener must ignore that click. */
  #placementClick: MouseEvent | TouchEvent | undefined;
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
    map.addSource(PLACED_SOURCE, { type: 'geojson', data: empty() });
    map.addSource(DEVICE_SOURCE, { type: 'geojson', data: empty() });

    // The hand-placed position pin, FIRST: it lives in the canvas (not a DOM marker, which
    // would float above everything the map draws) precisely so every report renders over it.
    // The pin is position furniture; a planted "Found it" flag on the same spot must win.
    this.#glyphImage(map, 'placed-pin-img', 'edit_location', {
      fill: cssToken('--md-sys-color-primary-container', '#862300'),
      size: 64,
    });
    map.addLayer({
      id: 'placed-pin',
      type: 'symbol',
      source: PLACED_SOURCE,
      layout: {
        'icon-image': 'placed-pin-img',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'bottom',
      },
    });

    // The device's own fix, marked the moment there is one (feedback: filing from the phone's fix
    // left the map with no "you are here"). Same reason as the placed pin to live in the canvas
    // rather than a DOM marker — every report renders over it. It wears `my_location`, the icon the
    // position chip already uses for the fix, so map and chip agree; the crosshair is symmetric, so
    // it anchors at its centre rather than a pin's point. Only ever one self-pin: `#syncDevicePin`
    // clears this the instant a hand-placed position exists, which is what the placed pin shows.
    this.#glyphImage(map, 'device-pin-img', 'my_location', {
      fill: cssToken('--md-sys-color-primary', '#FFB59B'),
      size: 56,
    });
    map.addLayer({
      id: 'device-pin',
      type: 'symbol',
      source: DEVICE_SOURCE,
      layout: {
        'icon-image': 'device-pin-img',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
    });

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
      paint: labelPaint(),
    });

    // omni and null: a circle at a position, and nothing that implies a direction. No arrow,
    // no cone, no radius — interpreting how much ground a null report kills is fusion.
    map.addLayer({
      id: 'marker-circle',
      type: 'circle',
      source: MARKER_SOURCE,
      filter: ['!=', ['get', 'kind'], 'fix'],
      paint: {
        // Each kind reads as the claim it is. `omni` is sized by the strength reported — the one
        // scalar it carries — so two signal reports are not one indistinguishable dot.
        // Only an omni carries a strength, so the interpolate reads through `to-number` with a
        // fallback: the filter should keep a null from ever reaching it, and this makes the
        // radius defined rather than resting on that.
        'circle-radius': [
          'case',
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
        'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'null'], 3, 2],
        'circle-opacity': 0.85,
      },
    });

    // "Found it" is the report a hunt exists to produce, and it stopped looking like a bigger
    // signal dot (feedback round 3): it plants the same flag the report bar and popup wear, in
    // the observer's colour, twice the height of any circle — and, added after the placed-pin
    // layer, it draws over the pin when the fox is found at the spot the hunter set. One image
    // per palette swatch, from the shared glyph, so every surface agrees on what it looks like.
    for (const colour of PALETTE) {
      this.#glyphImage(map, `fix-flag-${colour}`, 'flag', { fill: colour, size: 88 });
    }
    map.addLayer({
      id: 'fix-flag',
      type: 'symbol',
      source: MARKER_SOURCE,
      filter: ['==', ['get', 'kind'], 'fix'],
      layout: {
        'icon-image': ['concat', 'fix-flag-', ['get', 'colour']],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // The pole plants at the reported position; the flag flies above it.
        'icon-anchor': 'bottom',
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
      paint: labelPaint(),
    });

    this.#bindClick();
    // The swap that recreated these sources also emptied them; the pin state survives here.
    this.#applyPlacedPin();
    this.#applyDevicePin();
  }

  /**
   * A shared glyph rasterized into a map image (the flag markers, the placed pin). The halo is
   * the LIGHT map ground, not the dark label halo — half the Tol swatches are dark, and a dark
   * halo turned those glyphs into blobs; a light halo cuts every colour out of the busy street
   * detail the way a classic map marker does. `size` is device pixels at pixelRatio 2, so the
   * on-map height is half of it. Re-added after every style swap — `setStyle(diff: false)`
   * drops images along with the sources.
   */
  #glyphImage(
    map: MapLibreMap,
    id: string,
    name: Parameters<typeof iconPath>[0],
    options: { fill: string; size: number },
  ): void {
    if (map.hasImage(id)) return;
    const canvas = document.createElement('canvas');
    canvas.width = options.size;
    canvas.height = options.size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The glyph lives in Material Symbols' 0/-960/960/960 box; map it onto the canvas.
    const path = new Path2D(iconPath(name));
    const scale = options.size / 960;
    ctx.setTransform(scale, 0, 0, scale, 0, options.size);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 110;
    ctx.strokeStyle = cssToken('--fx-color-map-ground', '#F6F0EA');
    ctx.stroke(path);
    ctx.fillStyle = options.fill;
    ctx.fill(path);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    map.addImage(id, ctx.getImageData(0, 0, options.size, options.size), { pixelRatio: 2 });
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
      // Remember the browser event this tap consumed: the layer-filtered listener below fires
      // for the SAME click, and by then #placing is already cleared — so its guard alone let a
      // placement tap inside a wedge also open that wedge's popup.
      this.#placementClick = event.originalEvent;
      place({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    map.on('click', ['wedge-fill', 'marker-circle', 'fix-flag'], (event) => {
      if (this.#placing || event.originalEvent === this.#placementClick) return;
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
    const kind = String(properties['kind']) as ReportKind;

    const content = el('div', { class: 'popup', 'data-testid': 'report-detail' });

    // The report's kind identity — same icon, same hue as the bar button that filed it (US3
    // scenario 3): the popup visibly belongs to the vocabulary the hunter already knows.
    const title = `${String(properties['label'])} — ${describeKind(kind)}`;
    content.append(
      el(
        'div',
        { class: `popup-header kind-${kind}` },
        icon(KIND_ICONS[kind] ?? 'explore', { label: title }),
        el('span', { class: 'popup-title' }, title),
      ),
      el('p', {}, formatTime(Number(properties['display_at']))),
    );

    // Every caveat the report carries travels with it. The map must not read as more certain than
    // the report it is drawing.
    const lines = [];
    if (properties['relayed']) {
      lines.push(`Relayed by ${String(properties['entered_by'])} over the air`);
    }
    if (properties['placed']) lines.push('Position set by hand');
    if (properties['clock_unknown'])
      lines.push('That phone never checked its clock — time may be off');
    if (properties['clock_suspect'])
      lines.push('That phone’s clock was wrong — time is approximate');
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
    this.#syncPlacedPin(state.placed);
    // The device fix, but only when it is the position a report would actually use: no hand-placed
    // position overriding it. `positionChip` makes the same call for its "from your phone's fix"
    // wording, so the map's self-pin and the chip always tell one story.
    this.#syncDevicePin(
      !state.placed && state.position.status === 'ready'
        ? { lat: state.position.fix.lat, lon: state.position.fix.lon }
        : undefined,
    );
    this.#syncRelayPin(state.relayTarget);
    this.#updateStatus(state);
  }

  /**
   * The armed relay target's pin: where the OBSERVER stood, dashed like every relayed mark on
   * this map. It exists exactly as long as the arming does — dropped on "Report for them",
   * gone when the report files or the arming is cancelled.
   */
  #syncRelayPin(target: MapViewState['relayTarget']): void {
    if (!target) {
      this.#relayPin?.remove();
      this.#relayPin = undefined;
      return;
    }
    const map = this.#map;
    if (!map) return;

    if (!this.#relayPin) {
      const pin = el(
        'div',
        { class: 'relay-pin', 'data-testid': 'relay-pin', 'aria-hidden': 'true' },
        icon('record_voice_over', { label: target.callsign }),
      );
      this.#relayPin = new maplibregl.Marker({ element: pin, anchor: 'center' })
        .setLngLat([target.position.lon, target.position.lat])
        .addTo(map);
    } else {
      this.#relayPin.setLngLat([target.position.lon, target.position.lat]);
    }
  }

  /**
   * A pin at the hand-placed position, the moment it exists (FR-008a feedback). Placing without
   * a mark left the hunter guessing whether — and where — the tap landed; the chip alone says
   * "the spot you set" without showing the spot. Map data, not a DOM marker: DOM markers float
   * above the whole canvas, and the pin must sit UNDER the reports — a flag planted at the spot
   * the hunter set has to win. Invisible to the accessibility tree either way; the position
   * chip carries the words.
   */
  #syncPlacedPin(placed: { lat: number; lon: number } | undefined): void {
    this.#placedPosition = placed;
    this.#applyPlacedPin();
  }

  /** Writes the placed position into its source — re-run after style swaps recreate it. */
  #applyPlacedPin(): void {
    const source = this.#map?.getSource(PLACED_SOURCE) as maplibregl.GeoJSONSource | undefined;
    // Not yet: #addLayers re-applies once the source exists again.
    if (!source) return;

    const placed = this.#placedPosition;
    source.setData({
      type: 'FeatureCollection',
      features: placed
        ? [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [placed.lon, placed.lat] },
              properties: {},
            },
          ]
        : [],
    });
  }

  /**
   * A pin at the device's own fix — the counterpart to the placed pin, for a hunter reporting from
   * GPS. It is the position the next report would carry, so it appears exactly when the position
   * chip reads "from your phone's fix": a live fix and nothing set by hand. A hand-placed position
   * outranks the device's (positionChip), so this clears the moment one exists and the placed pin
   * takes over — the two never show at once.
   */
  #syncDevicePin(device: { lat: number; lon: number } | undefined): void {
    this.#devicePosition = device;
    this.#applyDevicePin();
  }

  /** Writes the device fix into its source — re-run after style swaps recreate it. */
  #applyDevicePin(): void {
    const source = this.#map?.getSource(DEVICE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const device = this.#devicePosition;
    source.setData({
      type: 'FeatureCollection',
      features: device
        ? [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [device.lon, device.lat] },
              properties: {},
            },
          ]
        : [],
    });
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
    // Each state is an icon + colour + shape triple (data-model.md §3) — never colour alone — and
    // here the icon carries it alone: cloud-with-check for the whole picture, cloud-with-slash for
    // this phone only (contracts/iconography.md §1). The scope still reaches assistive tech through
    // the chip's `aria-label`; only the redundant wording is gone.
    const syncChip = state.live
      ? el(
          'span',
          {
            class: 'chip ok icon-only',
            'data-testid': 'sync-state',
            'data-state': 'live',
            role: 'img',
            'aria-label': 'Showing everyone’s reports',
          },
          icon('cloud_done', { label: 'Showing everyone’s reports' }),
        )
      : el(
          'span',
          {
            class: 'chip warn icon-only',
            'data-testid': 'sync-state',
            'data-state': 'offline',
            role: 'img',
            'aria-label': 'No signal — showing this phone only',
          },
          icon('cloud_off', { label: 'No signal — showing this phone only' }),
        );

    const chips: (HTMLElement | undefined)[] = [
      // The hunt name is also the way into the menu (settings + start a new hunt), so the standalone
      // gear is gone: one affordance in the bar, not two that mean nearly the same thing.
      ...targetChips(state.target, state.fold.found, state.onOpenSettings),

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

      // Relay: an affordance only when this device opted in (settings), a status only while
      // armed. Everyone else's status bar never mentions it.
      ...this.#relayChips(state),
    ];

    this.#statusBar.append(...chips.filter((c): c is HTMLElement => c !== undefined));
  }

  /** How much of this drain is already through: the determinate part of the draining chip. */
  #drainedFraction(depth: number): number {
    if (this.#queuePeak === 0) return 0;
    return (this.#queuePeak - depth) / this.#queuePeak;
  }

  /**
   * Relay affordances (feedback round 2): a "report for someone else" action while unarmed,
   * a "relaying for X" status with its cancel while armed. Absent entirely when relay mode is
   * off — the fringe feature costs the common case nothing.
   */
  #relayChips(state: MapViewState): HTMLElement[] {
    if (!state.relayMode) return [];

    if (state.relayTarget) {
      const cancel = el(
        'button',
        { type: 'button', class: 'chip-action', 'data-testid': 'cancel-relay' },
        icon('close', { label: 'Cancel' }),
        el('span', { class: 'chip-label' }, 'Cancel'),
      );
      cancel.addEventListener('click', state.onCancelRelay);
      return [
        el(
          'span',
          { class: 'chip chip-with-action', 'data-testid': 'relay-armed' },
          chipStatus('record_voice_over', `Next report files as ${state.relayTarget.callsign}’s`),
          cancel,
        ),
      ];
    }

    const begin = el(
      'button',
      { type: 'button', class: 'chip-action', 'data-testid': 'begin-relay' },
      icon('record_voice_over', { label: 'Report for someone else' }),
      el('span', { class: 'chip-label' }, 'Report for someone else'),
    );
    begin.addEventListener('click', state.onBeginRelay);
    return [el('span', { class: 'chip chip-with-action' }, begin)];
  }

  /** The settings gear: icon-only (universal), and the only door to the per-device switches. */
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
    this.#relayPin?.remove();
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
      chipStatus('edit_location', 'Reporting from the spot you set'),
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
      chipStatus('my_location', 'Reporting from your phone’s fix'),
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
    chipStatus('location_disabled', message),
    place,
  );
}

/**
 * The status half of a chip that also hosts actions: one pill, one element. It used to be an
 * icon and a label as loose siblings fused by negative-margin CSS, which rendered with a seam —
 * a wrapper is the honest structure.
 */
function chipStatus(name: Parameters<typeof icon>[0], label: string): HTMLElement {
  return el(
    'span',
    { class: 'chip-status' },
    icon(name, { label }),
    el('span', { class: 'chip-label' }, label),
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
