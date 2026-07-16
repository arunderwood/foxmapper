/**
 * SC-008: **0 occurrences** of protocol vocabulary on any participant-facing surface.
 *
 * Principle V: these formats are a 1990s encoding most APRS clients never implemented and the
 * great majority of active hunters have never met. Reusing them is an *interoperation* decision.
 * Showing them would be a *vocabulary* decision, and a bad one.
 *
 * The full check is a human reading every reachable screen (T065) — an error path can still leak
 * what a scan cannot see. This catches the regression mechanically, which is the half a review
 * does worst.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The firewall list, verbatim from the contract. */
const JARGON = [
  /\bNRQ\b/,
  /\bDFS\b/,
  /\bPHG\b/,
  /\bAPRS\b/,
  /\bBRG\b/,
  /\bQ[- ]?value\b/i,
  /\bS[- ]?point\b/i,
  /\bconfidence_q\b/,
  /\bmax_range_r\b/,
  /\bstrength_s\b/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** String literals only, with comments stripped — the code may name a digit; a screen may not. */
function literals(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...withoutComments.matchAll(/(["`'])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]!);
}

describe('the vocabulary firewall', () => {
  const surfaces = [...sourceFiles('src/ui'), ...sourceFiles('src/report')];

  it('covers every module that can reach a screen', () => {
    // A guard on the guard: if the UI moves, this suite must follow it.
    expect(surfaces.length).toBeGreaterThan(8);
  });

  it.each(surfaces)('%s speaks no protocol vocabulary', (file) => {
    const offenders = literals(readFileSync(file, 'utf8')).filter((text) =>
      JARGON.some((pattern) => pattern.test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it('the mapping module is imported by nothing that renders', () => {
    // The contract's structural guarantee: the ugliness lives in exactly one module, and the
    // reason "DFS" does not appear in the shipped bundle at all is that nothing pulls it in.
    for (const file of surfaces) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"].*aprs\/mapping/);
    }
  });

  it('speaks the language hunters actually use', () => {
    // The other half of Principle V, which a "no jargon" check alone would not catch: the absence
    // of NRQ is not the presence of plain language.
    const spoken = surfaces.map((f) => readFileSync(f, 'utf8')).join('\n').toLowerCase();
    for (const phrase of ['bearing', 'signal', 'hear nothing here', 'how sure are you']) {
      expect(spoken).toContain(phrase);
    }
  });
});
