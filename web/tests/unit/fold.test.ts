/**
 * Fold properties per contracts/log-format.md § The fold.
 *
 * Principle IV requires derived state be "computed identically from the same log on every
 * client". Order-independence is what makes that true on a network that reorders, so it is a
 * property test rather than a hope.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fold } from '../../src/log/fold.js';
import { toLog } from '../../src/log/gset.js';
import type { Report } from '../../src/log/types.js';
import {
  bearingReportArb,
  dedupeById,
  fixReportArb,
  logArb,
  observationReportArb,
  retractionOfArb,
  uuidArb,
} from './arbitraries.js';

/** The fold's output, compared structurally. `active` is a set, so compare by sorted id. */
function foldSignature(reports: Report[]) {
  const result = fold(toLog(reports));
  return {
    found: result.found,
    activeIds: [...result.active].map((r) => r.id).sort(),
    retractedIds: [...result.retracted].sort(),
    observers: [...result.observers].sort(),
  };
}

/** A log where some retractions genuinely target reports that are present. */
const logWithRealRetractionsArb = fc
  .array(observationReportArb, { minLength: 1, maxLength: 15 })
  .chain((observations) => {
    const present = dedupeById(observations);
    const targetIds = present.map((r) => r.id);
    return fc
      .array(retractionOfArb(fc.constantFrom(...targetIds)), { maxLength: 8 })
      .map((retractions) => dedupeById([...present, ...retractions]));
  });

describe('fold order-independence', () => {
  it('fold(shuffle(log)) == fold(log)', () => {
    fc.assert(
      fc.property(logWithRealRetractionsArb, (reports) => {
        const shuffled = [...reports].reverse();
        expect(foldSignature(shuffled)).toEqual(foldSignature(reports));
      }),
    );
  });

  it('holds under an arbitrary permutation, not just reversal', () => {
    fc.assert(
      fc.property(logWithRealRetractionsArb, fc.integer(), (reports, seed) => {
        const shuffled = [...reports].sort(
          (a, b) => ((a.id + String(seed)) < (b.id + String(seed)) ? -1 : 1),
        );
        expect(foldSignature(shuffled)).toEqual(foldSignature(reports));
      }),
    );
  });
});

describe('fold retraction semantics', () => {
  it('a retraction arriving BEFORE its target still retracts it', () => {
    // The rule the contract calls the single most important one: networks reorder, and a device
    // may hold a retraction before the report it names. Walk-and-mark passes every other test
    // and fails this one.
    fc.assert(
      fc.property(bearingReportArb, uuidArb, (target, retractionId) => {
        const retraction: Report = {
          ...target,
          id: retractionId,
          kind: 'retraction',
          payload: { retracts_id: target.id },
        };
        fc.pre(retractionId !== target.id);

        const retractionFirst = fold(toLog([retraction, target]));
        const targetFirst = fold(toLog([target, retraction]));

        expect([...retractionFirst.active]).toHaveLength(0);
        expect([...targetFirst.active]).toHaveLength(0);
      }),
    );
  });

  it('a retraction whose target never arrives is inert, not an error', () => {
    fc.assert(
      fc.property(retractionOfArb(uuidArb), observationReportArb, (retraction, unrelated) => {
        fc.pre(retraction.payload.retracts_id !== unrelated.id);
        fc.pre(retraction.id !== unrelated.id);

        const result = fold(toLog([retraction, unrelated]));
        expect([...result.active].map((r) => r.id)).toEqual([unrelated.id]);
        expect(result.retracted.has(retraction.payload.retracts_id)).toBe(true);
      }),
    );
  });

  it('retractions are never themselves active', () => {
    fc.assert(
      fc.property(logArb, (reports) => {
        for (const r of fold(toLog(reports)).active) expect(r.kind).not.toBe('retraction');
      }),
    );
  });

  it('a retracted fix does not leave the target found', () => {
    fc.assert(
      fc.property(fixReportArb, uuidArb, (found, retractionId) => {
        fc.pre(retractionId !== found.id);
        const retraction: Report = {
          ...found,
          id: retractionId,
          kind: 'retraction',
          payload: { retracts_id: found.id },
        };
        expect(fold(toLog([found])).found).toBe(true);
        expect(fold(toLog([found, retraction])).found).toBe(false);
      }),
    );
  });
});

describe('fold union laws', () => {
  it('is idempotent: fold(A ∪ A) == fold(A)', () => {
    fc.assert(
      fc.property(logWithRealRetractionsArb, (a) => {
        expect(foldSignature([...a, ...a])).toEqual(foldSignature(a));
      }),
    );
  });

  it('is commutative: fold(A ∪ B) == fold(B ∪ A)', () => {
    fc.assert(
      fc.property(logWithRealRetractionsArb, logWithRealRetractionsArb, (a, b) => {
        const ab = dedupeById([...a, ...b]);
        const ba = dedupeById([...b, ...a]);
        expect(foldSignature(ab)).toEqual(foldSignature(ba));
      }),
    );
  });
});

describe('fold identity rules', () => {
  it('two identical relayed reports both survive — they are not deduplicated', () => {
    // Two operators hearing one voice call each relay it. The system cannot know they describe
    // one observation, and collapsing them would destroy a real report.
    fc.assert(
      fc.property(bearingReportArb, uuidArb, (report, secondId) => {
        fc.pre(secondId !== report.id);
        const twin = { ...report, id: secondId };
        expect([...fold(toLog([report, twin])).active]).toHaveLength(2);
      }),
    );
  });

  it('is age-neutral: shifting every timestamp changes nothing', () => {
    fc.assert(
      fc.property(logWithRealRetractionsArb, fc.integer({ min: -1e9, max: 1e9 }), (reports, d) => {
        const shifted = reports.map((r) => ({ ...r, observed_at: r.observed_at + d }));
        const before = foldSignature(reports);
        const after = foldSignature(shifted);
        expect(after.activeIds).toEqual(before.activeIds);
        expect(after.found).toEqual(before.found);
      }),
    );
  });

  it('derives observers from active reports only', () => {
    fc.assert(
      fc.property(bearingReportArb, uuidArb, (report, retractionId) => {
        fc.pre(retractionId !== report.id);
        const retraction: Report = {
          ...report,
          id: retractionId,
          kind: 'retraction',
          payload: { retracts_id: report.id },
        };
        expect(fold(toLog([report, retraction])).observers.size).toBe(0);
      }),
    );
  });
});
