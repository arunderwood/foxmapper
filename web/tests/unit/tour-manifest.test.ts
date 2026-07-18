/**
 * The tour drift check (contracts/tour-drift-check.md, spec US3, FR-016–FR-019, SC-008).
 *
 * This is the authoritative layer of the safeguard — the Claude Code hook just runs it in-session.
 * A tour that points at a control that has been renamed or removed is worse than no tour, because it
 * teaches a newcomer something false on their first contact. So three things are asserted against the
 * live source tree, not against a copy of it:
 *
 *   1. every anchor a step depends on still exists as a `data-testid` in `web/src`;
 *   2. the kinds the tour claims to cover, plus the ones it deliberately omits, account for exactly
 *      the report kinds the app actually ships;
 *   3. every step's anchor is declared in the manifest, so the two never drift apart.
 *
 * It reads copy, styling and layout not at all (SC-008: no false alarm on unrelated edits).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { anchors, coveredKinds, uncoveredKinds } from '../../src/ui/tour/manifest.js';
import { STEPS } from '../../src/ui/tour/steps.js';
import { KIND_BUTTONS } from '../../src/ui/report-entry.js';

const SRC = 'src';
const REPORT_ENTRY = 'src/ui/report-entry.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * Every `data-testid` the source assigns as a plain string literal.
 *
 * Deliberately does not match template-literal testids (they start with a backtick): the one
 * generated family the tour depends on — the report-kind buttons — is resolved separately, from the
 * code's own kind list, so a change to how those ids are built is caught rather than assumed away.
 */
function literalTestids(files: string[]): Set<string> {
  const found = new Set<string>();
  const pattern = /data-testid["']?\s*:\s*["']([^"'`]+)["']/g;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) found.add(match[1]!);
  }
  return found;
}

/**
 * The report bar renders its kind buttons as `report-${kind}` (report-entry.ts). Mirror that here,
 * from KIND_BUTTONS, so anchors like `report-omni` resolve — but only while that template is really
 * the one in the source. If the prefix ever changes, this returns nothing and the affected anchors
 * fail loudly, which is the point.
 */
function generatedReportTestids(): string[] {
  const source = readFileSync(REPORT_ENTRY, 'utf8');
  const rendersReportKind = /data-testid["']?\s*:\s*`report-\$\{kind\}`/.test(source);
  return rendersReportKind ? KIND_BUTTONS.map((button) => `report-${button.kind}`) : [];
}

describe('tour drift check', () => {
  const files = sourceFiles(SRC);

  it('scans a source tree that actually contains the app', () => {
    // A guard on the guard: an empty or mis-rooted scan would make every anchor "exist".
    expect(files.length).toBeGreaterThan(10);
  });

  it('every tour anchor exists as a data-testid in web/src', () => {
    const known = new Set([...literalTestids(files), ...generatedReportTestids()]);
    const missing = anchors.filter((anchor) => !known.has(anchor));
    expect(
      missing,
      `Tour anchors with no matching data-testid in web/src: ${missing.join(', ')}. ` +
        'A step points at a control that was renamed or removed — update web/src/ui/tour/steps.ts ' +
        'and manifest.ts, or restore the anchor. See docs/product-tour.md.',
    ).toEqual([]);
  });

  it('covered and deliberately-omitted kinds together are exactly the app’s report kinds', () => {
    const shipped = new Set(KIND_BUTTONS.map((button) => button.kind));
    const accounted = new Set([...coveredKinds, ...uncoveredKinds]);

    // Nothing counted twice: a kind is either taught or consciously left out, never both.
    expect(coveredKinds.filter((kind) => uncoveredKinds.includes(kind))).toEqual([]);

    const unaccounted = [...shipped].filter((kind) => !accounted.has(kind));
    const stale = [...accounted].filter((kind) => !shipped.has(kind));
    expect(
      { unaccounted, stale },
      'The tour’s covered/omitted kinds no longer match the app’s report kinds. A new way to ' +
        'contribute must be added to coveredKinds and given a step, or (if it is not a way to ' +
        'contribute evidence) added to uncoveredKinds. See web/src/ui/tour/manifest.ts and ' +
        'docs/product-tour.md.',
    ).toEqual({ unaccounted: [], stale: [] });
  });

  it('every step’s anchor is declared in the manifest', () => {
    const undeclared = STEPS.filter(
      (step) => step.anchor !== undefined && !anchors.includes(step.anchor),
    ).map((step) => step.id);
    expect(undeclared).toEqual([]);
  });

  it('every covered kind has a step that teaches it', () => {
    // The contribute kinds the tour claims to cover must each own a step (its id is the kind).
    const stepIds = new Set(STEPS.map((step) => step.id));
    const untaught = coveredKinds.filter((kind) => !stepIds.has(kind));
    expect(untaught).toEqual([]);
  });
});
