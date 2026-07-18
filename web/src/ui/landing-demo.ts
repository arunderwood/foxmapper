/**
 * The landing backdrop: a real FoxMapper map, so the product itself is the hero.
 *
 * Not a diagram — an actual capture of the app mid-hunt, three hunters' bearing wedges crossing
 * over the streets where they cross. Captured from the running app; the callsigns are the
 * XYZ-suffix example family (the app's own placeholder is KI7XYZ), each verified unassigned, so the
 * picture names no real operator.
 */
import { el } from './dom.js';

/** The real hunt map, sized to fill the landing behind the panel. */
export function huntMapBackdrop(): HTMLElement {
  return el('img', {
    class: 'landing-map-img',
    src: '/demo-hunt.webp',
    width: '1200',
    height: '830',
    alt: "A FoxMapper hunt in progress: three hunters' bearing wedges crossing on the streets over the fox.",
    loading: 'eager',
    decoding: 'async',
  });
}
