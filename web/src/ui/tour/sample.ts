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

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export function credibleRegionSample(): HTMLElement {
  const figure = svg('svg', {
    viewBox: '0 0 220 130',
    class: 'tour-sample-figure',
    role: 'img',
    'aria-label': 'Example: the estimate is a shaded region, not a single point',
  });

  // A radial fade: densest in the middle, gone at the edge — uncertainty you can see.
  const defs = svg('defs', {});
  const gradient = svg('radialGradient', { id: 'tour-sample-grad' });
  const stops: [string, string][] = [
    ['0%', '0.5'],
    ['60%', '0.24'],
    ['100%', '0'],
  ];
  for (const [offset, opacity] of stops) {
    gradient.append(svg('stop', { offset, 'stop-color': 'currentColor', 'stop-opacity': opacity }));
  }
  defs.append(gradient);
  figure.append(defs);

  const region = { cx: '110', cy: '65', rx: '86', ry: '46' };
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
