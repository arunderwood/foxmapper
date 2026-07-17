/**
 * The contrast audit (SC-001), enforcing contracts/design-tokens.md §4.
 *
 * Parses tokens.css — the shipped file, not a fixture — so the evidence in research.md R2 can
 * never drift from what hunters actually see. Three floors:
 *
 *   7.0:1  glanceable — what a hunter reads at arm's length in direct sun: status colours on
 *          their surfaces, chip and report-bar label text, filled-button labels
 *   4.5:1  body text (WCAG AA)
 *   3.0:1  non-text UI — outlines and the report-kind icon hues (shape is the primary channel;
 *          hue is reinforcement, but it must still register)
 *
 * A change to any token value answers to this file before it answers to taste.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../../src/ui/tokens.css', import.meta.url)), 'utf8');

/** Every `--name: value;` declaration in the file, var() references unresolved. */
const declarations = new Map<string, string>();
for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  declarations.set(match[1]!, match[2]!.trim());
}

/** Resolves a token to its hex value through any chain of var() references. */
function resolve(name: string): string {
  let value = declarations.get(name);
  for (let hops = 0; value && hops < 10; hops++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    if (!ref) break;
    value = declarations.get(ref[1]!);
  }
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`token ${name} did not resolve to a hex colour (got: ${String(value)})`);
  }
  return value;
}

function luminance(hex: string): number {
  const channel = (index: number): number => {
    const c = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(fg: string, bg: string): number {
  const [hi, lo] = [luminance(resolve(fg)), luminance(resolve(bg))].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = ['--md-sys-color-surface', '--md-sys-color-surface-container'] as const;

/** [foreground, background, floor] — the pair list from contracts/design-tokens.md §4. */
const PAIRS: [string, string, number][] = [
  // Glanceable text on every surface it appears on.
  ['--md-sys-color-on-surface', '--md-sys-color-surface', 7],
  ['--md-sys-color-on-surface', '--md-sys-color-surface-container', 7],
  ['--md-sys-color-on-surface', '--md-sys-color-surface-container-high', 7],
  // Status colours: chips render on surface-container, warnings can sit on raw surface.
  ...SURFACES.flatMap((bg): [string, string, number][] => [
    ['--md-sys-color-primary', bg, 7],
    ['--fx-color-warn', bg, 7],
    ['--md-sys-color-error', bg, 7],
    ['--fx-color-ok', bg, 7],
  ]),
  // Filled and tonal button labels, and the loud-container chip text.
  ['--md-sys-color-on-primary', '--md-sys-color-primary', 7],
  ['--md-sys-color-on-primary-container', '--md-sys-color-primary-container', 7],
  ['--fx-color-on-warn-container', '--fx-color-warn-container', 7],
  ['--md-sys-color-on-error-container', '--md-sys-color-error-container', 7],
  // Body tier.
  ['--md-sys-color-on-surface-variant', '--md-sys-color-surface', 4.5],
  ['--md-sys-color-on-surface-variant', '--md-sys-color-surface-container', 4.5],
  ['--md-sys-color-on-surface-variant', '--md-sys-color-surface-container-high', 4.5],
  // Non-text UI.
  ['--md-sys-color-outline', '--md-sys-color-surface', 3],
  ['--fx-kind-bearing', '--md-sys-color-surface-container', 3],
  ['--fx-kind-signal', '--md-sys-color-surface-container', 3],
  ['--fx-kind-null', '--md-sys-color-surface-container', 3],
  ['--fx-kind-fix', '--md-sys-color-surface-container', 3],
];

describe('design token contrast floors (contracts/design-tokens.md §4)', () => {
  it.each(PAIRS)('%s on %s ≥ %d:1', (fg, bg, floor) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(floor);
  });

  it('field constants are present and exact', () => {
    expect(declarations.get('--fx-touch')).toBe('56px');
    expect(declarations.get('--fx-input-font')).toBe('16px');
  });

  it('the file never claims the wire palette (docs/log-format.md)', () => {
    // The per-callsign swatches are log format, not tokens: they live in src/log/colour.ts as a
    // cross-device guarantee. A token *named* for hunter identity would mean someone tried to
    // restyle that guarantee. (Kind hues sharing Tol-family values is fine — different channel.)
    expect(css).not.toMatch(/--(fx|md)-[\w-]*(callsign|hunter|observer|swatch)/i);
  });
});
