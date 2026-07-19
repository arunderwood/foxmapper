/**
 * The scripted credible-region sample for the estimate step (FR-014, Principle I).
 *
 * On a brand-new hunt there are no reports and so no real credible region to point at. Rather than
 * spotlight empty ground — or, worse, teach a single confident dot — the estimate step carries this
 * fixed illustration: a soft **region**, plainly marked as an example, that shows the shape of the
 * real thing. It is drawn in the DOM only; it is never written to the log or the map, and it renders
 * a region rather than a point so the tour cannot teach false precision.
 */
import { el } from '../dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/**
 * A miniature of the real thing: a map tile with a couple of faint reports on it, and the shaded
 * credible region they add up to. It reads as *ground on the map*, not an abstract diagram — but it
 * is still a region, never a point, so it cannot teach the false precision Principle I rejects. The
 * map furniture (tile, streets) is drawn in theme tokens; the estimate and the reports feeding it use
 * `currentColor`, the bearing accent the whole sample inherits from `.tour-sample`.
 */
export function credibleRegionSample(): HTMLElement {
  const figure = svg('svg', {
    viewBox: '0 0 220 130',
    class: 'tour-sample-figure',
    role: 'img',
    'aria-label': 'Example: a few reports on a map add up to a shaded region, not a single point',
  });

  // A radial fade: densest in the middle, gone at the edge — uncertainty you can see.
  const defs = svg('defs');
  const gradient = svg('radialGradient', { id: 'tour-sample-grad' });
  const stops: [string, string][] = [
    ['0%', '0.5'],
    ['60%', '0.24'],
    ['100%', '0'],
  ];
  for (const [offset, opacity] of stops) {
    gradient.append(svg('stop', { offset, 'stop-color': 'currentColor', 'stop-opacity': opacity }));
  }
  // Clip the streets to the rounded tile so no line runs off its edge.
  const clip = svg('clipPath', { id: 'tour-sample-tile' });
  clip.append(svg('rect', { x: '2', y: '2', width: '216', height: '126', rx: '10' }));
  defs.append(gradient, clip);
  figure.append(defs);

  // The map tile: a muted card that reads as terrain, in theme tokens so it works light and dark.
  const tile = svg('rect', { x: '2', y: '2', width: '216', height: '126', rx: '10' });
  tile.style.fill = 'var(--md-sys-color-surface-container-high)';
  tile.style.stroke = 'var(--md-sys-color-outline-variant)';
  tile.style.strokeWidth = '1';
  figure.append(tile);

  // A loose street grid — enough to say "map" without drawing attention from the estimate.
  const streets = svg('g', { 'clip-path': 'url(#tour-sample-tile)' });
  const lines = [
    'M0,46 L220,54',
    'M0,92 L220,82',
    'M74,0 L64,130',
    'M156,0 L168,130',
    'M0,124 L128,0',
  ];
  for (const d of lines) {
    const street = svg('path', { d, fill: 'none' });
    street.style.stroke = 'var(--md-sys-color-outline-variant)';
    street.style.strokeWidth = '1.5';
    street.style.strokeOpacity = '0.7';
    streets.append(street);
  }
  figure.append(streets);

  // The reports feeding the estimate, kept faint so the region stays the subject: a bearing wedge
  // cutting in from one corner, and a single signal report as a ringed dot.
  const wedge = svg('path', {
    d: 'M18,120 L112,74 L96,54 Z',
    fill: 'currentColor',
    'fill-opacity': '0.14',
    stroke: 'currentColor',
    'stroke-opacity': '0.4',
    'stroke-width': '1',
  });
  figure.append(wedge);
  figure.append(
    svg('circle', { cx: '178', cy: '42', r: '3.5', fill: 'currentColor', 'fill-opacity': '0.55' }),
  );
  figure.append(
    svg('circle', {
      cx: '178',
      cy: '42',
      r: '7.5',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-opacity': '0.4',
      'stroke-width': '1',
    }),
  );

  // The estimate itself: the shaded region those reports add up to, densest in the middle.
  const region = { cx: '116', cy: '66', rx: '74', ry: '38' };
  figure.append(svg('ellipse', { ...region, fill: 'url(#tour-sample-grad)' }));
  // A dashed outline so the region still reads as a region where the fill is faint.
  figure.append(
    svg('ellipse', {
      ...region,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-opacity': '0.55',
      'stroke-width': '1.5',
      'stroke-dasharray': '5 4',
    }),
  );

  return el(
    'figure',
    { class: 'tour-sample', 'data-testid': 'tour-sample' },
    figure,
    el(
      'figcaption',
      { class: 'tour-sample-caption' },
      'Example — the fox is somewhere in the shaded region, not at one point',
    ),
  );
}
