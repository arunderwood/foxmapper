/**
 * Colour derivation per contracts/log-format.md § Observer colour is derived, not stored.
 *
 * Two devices disagreeing about who is orange is Principle IV's "computed identically on every
 * client" failing visibly, which is why the algorithm is specified to the byte and tested here.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { PALETTE, ambiguousCallsigns, colourFor, displayName, suffixFor } from '../../src/log/colour.js';
import { toLog } from '../../src/log/gset.js';
import { fold } from '../../src/log/fold.js';
import type { Report } from '../../src/log/types.js';
import { bearingReportArb, callsignArb, uuidArb } from './arbitraries.js';

describe('colour is a pure function of the callsign', () => {
  it('same callsign → same swatch, every time', () => {
    fc.assert(
      fc.property(callsignArb, (cs) => {
        expect(colourFor(cs)).toBe(colourFor(cs));
      }),
    );
  });

  it('normalises case and surrounding whitespace', () => {
    fc.assert(
      fc.property(callsignArb, (cs) => {
        expect(colourFor(`  ${cs.toLowerCase()}  `)).toBe(colourFor(cs));
      }),
    );
  });

  it('always returns a swatch from the normative palette', () => {
    fc.assert(
      fc.property(fc.string(), (cs) => {
        expect(PALETTE).toContain(colourFor(cs));
      }),
    );
  });

  it('matches the specified algorithm on a fixed vector', () => {
    // Pins the byte-level spec: be_u32(SHA-256(utf8(upper(trim(cs))))[0..4]) mod len(PALETTE).
    // A third-party reimplementation must land on the same swatch or the contract has failed.
    expect(colourFor('KI7XYZ')).toBe(PALETTE[expectedIndex('KI7XYZ')]);
  });
});

/** Independent restatement of the spec, so the test does not just re-run the implementation. */
function expectedIndex(callsign: string): number {
  const digest = createHash('sha256').update(callsign.trim().toUpperCase(), 'utf8').digest();
  return digest.readUInt32BE(0) % PALETTE.length;
}

describe('duplicate callsign detection', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';

  function selfReport(id: string, callsign: string, participantId: string): Report {
    return {
      v: 1,
      id,
      hunt_code: 'quiet-fox-8821',
      kind: 'null',
      observer: { callsign },
      position: { lat: 48.75, lon: -122.47 },
      position_source: 'measured',
      observed_at: 1_784_092_800_000,
      clock_offset_ms: null,
      entered_by: { participant_id: participantId, callsign },
      payload: {},
    };
  }

  it('a lone callsign gets no suffix', () => {
    const log = toLog([selfReport('a0000000-0000-4000-8000-000000000001', 'KI7XYZ', A)]);
    expect(ambiguousCallsigns(fold(log).active)).toEqual(new Set());
    expect(displayName('KI7XYZ', A, new Set())).toBe('KI7XYZ');
  });

  it('two participants sharing a callsign both get a suffix', () => {
    const log = toLog([
      selfReport('a0000000-0000-4000-8000-000000000001', 'KI7XYZ', A),
      selfReport('a0000000-0000-4000-8000-000000000002', 'KI7XYZ', B),
    ]);
    const ambiguous = ambiguousCallsigns(fold(log).active);
    expect(ambiguous).toEqual(new Set(['KI7XYZ']));
    expect(displayName('KI7XYZ', A, ambiguous)).toBe('KI7XYZ ·11');
    expect(displayName('KI7XYZ', B, ambiguous)).toBe('KI7XYZ ·22');
  });

  it('a merely-relayed callsign does NOT trigger the suffix', () => {
    // Net control relaying KI7XYZ puts their own participant_id in entered_by. Counting it
    // would flag a collision between KI7XYZ and themselves every time somebody relays them.
    const own = selfReport('a0000000-0000-4000-8000-000000000001', 'KI7XYZ', A);
    const relayed: Report = {
      ...own,
      id: 'a0000000-0000-4000-8000-000000000003',
      observer: { callsign: 'KI7XYZ' },
      entered_by: { participant_id: B, callsign: 'W7NET' },
    };
    expect(ambiguousCallsigns(fold(toLog([own, relayed])).active)).toEqual(new Set());
  });

  it('a suffix is the first 2 hex chars of the entering participant_id', () => {
    expect(suffixFor(A)).toBe('11');
    expect(suffixFor(B)).toBe('22');
  });

  it('colour does not distinguish duplicates — same callsign, same colour, by construction', () => {
    expect(colourFor('KI7XYZ')).toBe(colourFor('KI7XYZ'));
  });

  it('detection reads only active reports', () => {
    fc.assert(
      fc.property(bearingReportArb, uuidArb, (report, retractionId) => {
        fc.pre(retractionId !== report.id);
        const self = { ...report, entered_by: { ...report.entered_by, callsign: report.observer.callsign } };
        const retraction: Report = {
          ...self,
          id: retractionId,
          kind: 'retraction',
          payload: { retracts_id: self.id },
        };
        expect(ambiguousCallsigns(fold(toLog([self, retraction])).active)).toEqual(new Set());
      }),
    );
  });
});
