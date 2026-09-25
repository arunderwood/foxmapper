/**
 * The estimate module calls no inexact math and reads no clock or storage (research R5,
 * contracts/estimate-module.md §1 and §3).
 *
 * ECMA-262 defines `Math.sqrt`, `floor`, `abs`, `min` and `max` exactly and leaves the rest
 * implementation-approximated, so one stray `Math.exp` makes two engines draw different regions.
 * The owned replacements live in `detmath.ts`. A clock or storage read would make the result depend
 * on something other than the reports, which FR-018 forbids.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXACT_MATH = new Set(['sqrt', 'floor', 'abs', 'min', 'max']);
const FORBIDDEN = [/\bDate\b/, /\bperformance\b/, /\blocalStorage\b/, /\bindexedDB\b/];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const files = sourceFiles('src/estimate');

describe('estimate purity', () => {
  it('scans the whole module', () => {
    expect(files).toContain('src/estimate/estimate.ts');
    expect(files).toContain('src/estimate/detmath.ts');
  });

  it.each(files)('%s uses only exactly specified Math functions', (file) => {
    const members = [...code(readFileSync(file, 'utf8')).matchAll(/\bMath\s*\.\s*(\w+)/g)].map(
      (m) => m[1]!,
    );
    expect(members.filter((name) => !EXACT_MATH.has(name))).toEqual([]);
  });

  it.each(files)('%s reads no clock and no storage', (file) => {
    const source = code(readFileSync(file, 'utf8'));
    expect(FORBIDDEN.filter((pattern) => pattern.test(source)).map(String)).toEqual([]);
  });
});
