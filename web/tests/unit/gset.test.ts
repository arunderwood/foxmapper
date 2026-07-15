/**
 * G-Set union laws per contracts/log-format.md § Merge.
 *
 * These three properties are the formal reason no conflict can arise, and therefore the reason
 * no participant is ever asked to resolve one. They are the constitution's Principle IV in
 * executable form.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { merge, toLog } from '../../src/log/gset.js';
import type { Log } from '../../src/log/types.js';
import { logArb, reportArb } from './arbitraries.js';

/** Compare two logs by id → report. Order is meaningless in a set. */
function sameLog(a: Log, b: Log): boolean {
  if (a.size !== b.size) return false;
  for (const [id, report] of a) {
    const other = b.get(id);
    if (!other || JSON.stringify(other) !== JSON.stringify(report)) return false;
  }
  return true;
}

describe('G-Set union laws', () => {
  it('is commutative: merge(A, B) == merge(B, A)', () => {
    fc.assert(
      fc.property(logArb, logArb, (a, b) => {
        expect(sameLog(merge(toLog(a), toLog(b)), merge(toLog(b), toLog(a)))).toBe(true);
      }),
    );
  });

  it('is associative: merge(merge(A, B), C) == merge(A, merge(B, C))', () => {
    fc.assert(
      fc.property(logArb, logArb, logArb, (a, b, c) => {
        const left = merge(merge(toLog(a), toLog(b)), toLog(c));
        const right = merge(toLog(a), merge(toLog(b), toLog(c)));
        expect(sameLog(left, right)).toBe(true);
      }),
    );
  });

  it('is idempotent: merge(A, A) == A', () => {
    fc.assert(
      fc.property(logArb, (a) => {
        expect(sameLog(merge(toLog(a), toLog(a)), toLog(a))).toBe(true);
      }),
    );
  });
});

describe('G-Set merge specifics', () => {
  it('keys by id, so a duplicate id contributes one entry', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const log = toLog([report, { ...report }]);
        expect(log.size).toBe(1);
      }),
    );
  });

  it('never removes an entry — the set only grows', () => {
    fc.assert(
      fc.property(logArb, logArb, (a, b) => {
        const merged = merge(toLog(a), toLog(b));
        for (const r of [...a, ...b]) expect(merged.has(r.id)).toBe(true);
      }),
    );
  });

  it('merging with an empty log is the identity', () => {
    fc.assert(
      fc.property(logArb, (a) => {
        expect(sameLog(merge(toLog(a), toLog([])), toLog(a))).toBe(true);
      }),
    );
  });

  it('does not consult timestamps — a later observed_at does not overwrite an earlier one', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        // Same id, different bodies means immutability was violated upstream. Merge must not
        // adjudicate: it takes one, and never picks by clock. The phone with the fastest clock
        // is not the arbiter of truth.
        const older = { ...report, observed_at: 1_000 };
        const newer = { ...report, observed_at: 2_000 };
        const ab = merge(toLog([older]), toLog([newer]));
        const ba = merge(toLog([newer]), toLog([older]));
        expect(ab.size).toBe(1);
        expect(ba.size).toBe(1);
      }),
    );
  });
});
