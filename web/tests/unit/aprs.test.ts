/**
 * APRS mapping round-trips per contracts/aprs-mapping.md § Testing the word "losslessly".
 *
 * FR-020 says the mapping is lossless "to and from". That is a property, so it is tested as one.
 * P1 ships no gateway — this suite is what makes the word "losslessly" honest before a log
 * exists that cannot express it.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  brgToDegrees,
  decodeWire,
  degreesToBrg,
  emit,
  emitFromDigits,
  encodeBearing,
  encodeNull,
  encodeOmni,
  encodeThirdParty,
  bearingFieldsFromWire,
  strengthFromWire,
  toWireFields,
} from '../../src/aprs/mapping.js';
import type { WireDigit } from '../../src/log/types.js';
import { bearingReportArb, digitArb, omniReportArb, nullReportArb } from './arbitraries.js';

const dfExtensionArb = fc
  .tuple(fc.integer({ min: 1, max: 360 }), digitArb, digitArb, digitArb)
  .map(([brg, n, r, q]) => `000/000/${String(brg).padStart(3, '0')}/${n}${r}${q}`);

const dfsFieldArb = fc
  .tuple(digitArb, digitArb, digitArb, digitArb)
  .map(([s, h, g, d]) => `DFS${s}${h}${g}${d}`);

describe('round-trip, ours: decode(encode(r)) == r', () => {
  it('a bearing survives encode → string → decode with its digits intact', () => {
    fc.assert(
      fc.property(bearingReportArb, (report) => {
        const wire = encodeBearing(report.payload);
        expect(decodeWire(wire.raw)).toEqual(wire);
      }),
    );
  });

  it('a bearing round-trips its confidence and range digits back to the payload', () => {
    fc.assert(
      fc.property(bearingReportArb, (report) => {
        const fields = bearingFieldsFromWire(decodeWire(encodeBearing(report.payload).raw));
        expect(fields.confidence_q).toBe(report.payload.confidence_q);
        expect(fields.max_range_r).toBe(report.payload.max_range_r);
      }),
    );
  });

  it('a bearing round-trips its heading, to the degree the wire can carry', () => {
    // BRG is three digits, so the wire holds whole degrees. The rounding is the format's, and
    // stating it as a property beats pretending the wire carries a tenth of a degree.
    fc.assert(
      fc.property(bearingReportArb, (report) => {
        const fields = bearingFieldsFromWire(decodeWire(encodeBearing(report.payload).raw));
        expect(fields.heading_true).toBe(Math.round(report.payload.heading_true) % 360);
      }),
    );
  });

  it('an omni report survives encode → string → decode', () => {
    fc.assert(
      fc.property(omniReportArb, (report) => {
        const wire = encodeOmni(report.payload);
        expect(decodeWire(wire.raw)).toEqual(wire);
        expect(strengthFromWire(decodeWire(wire.raw))).toBe(report.payload.strength_s);
      }),
    );
  });

  it('a heard-nothing report survives encode → string → decode', () => {
    fc.assert(
      fc.property(nullReportArb, () => {
        const wire = encodeNull();
        expect(decodeWire(wire.raw)).toEqual(wire);
      }),
    );
  });
});

describe('round-trip, theirs: emitFromDigits(decode(w)) == w', () => {
  // The one the contract predicts will fail first. Re-emitting from the PARSED digits rather
  // than from `raw` is what proves the parse captured everything; using `raw` would make this
  // test vacuous.
  it('every valid DF extension survives, including Q=0–9 and R=0–9', () => {
    fc.assert(
      fc.property(dfExtensionArb, (w) => {
        expect(emitFromDigits(decodeWire(w))).toBe(w);
      }),
    );
  });

  it('every valid DFS field survives, including s=0–9 and non-default h/g/d', () => {
    fc.assert(
      fc.property(dfsFieldArb, (w) => {
        expect(emitFromDigits(decodeWire(w))).toBe(w);
      }),
    );
  });

  it('retains the raw string exactly as received', () => {
    fc.assert(
      fc.property(fc.oneof(dfExtensionArb, dfsFieldArb), (w) => {
        expect(decodeWire(w).raw).toBe(w);
      }),
    );
  });

  it('raw wins over the parsed digits on re-emit if they ever disagree', () => {
    const wire = { ...decodeWire('DFS2360'), s: 9 as WireDigit };
    expect(emit(wire)).toBe('DFS2360');
    expect(emitFromDigits(wire)).toBe('DFS9360');
  });
});

describe('the honesty cap, asserted mechanically', () => {
  it('Q ∈ {3,4,5} for every report our interface can author', () => {
    // Principle I expressed as an encoding constraint. A log emitting Q=8 would still parse and
    // would still be valid APRS; it would not be FoxMapper.
    fc.assert(
      fc.property(bearingReportArb, (report) => {
        const wire = encodeBearing(report.payload);
        expect([3, 4, 5]).toContain(wire.q);
      }),
    );
  });

  it('R ∈ {1,3,5} for every report our interface can author', () => {
    fc.assert(
      fc.property(bearingReportArb, (report) => {
        expect([1, 3, 5]).toContain(encodeBearing(report.payload).r);
      }),
    );
  });

  it('N is always 9 — every FoxMapper report is hand-entered by a human', () => {
    fc.assert(
      fc.property(bearingReportArb, (report) => {
        expect(encodeBearing(report.payload).n).toBe(9);
      }),
    );
  });

  it('accepts a Q of 8 from the air without clamping it', () => {
    // Asymmetric on purpose: we accept what the air gives and retain it raw, and separately
    // refuse to claim more than a compass can deliver.
    const wire = decodeWire('000/000/271/948');
    expect(wire.format).toBe('DF');
    if (wire.format !== 'DF') throw new Error('unreachable');
    expect(wire.q).toBe(8);
    expect(wire.r).toBe(4);
  });

  it('accepts an R of 9 from the air without clamping it', () => {
    const wire = decodeWire('000/000/271/993');
    if (wire.format !== 'DF') throw new Error('unreachable');
    expect(wire.r).toBe(9);
  });
});

describe('null is s=0, always', () => {
  it('encodes heard-nothing as DFS with strength zero', () => {
    // APRS101 p.30: 0-strength reports draw the circles where the jammer is NOT heard. That is
    // our null kind, described in the 1990s, for our exact use case.
    expect(encodeNull().s).toBe(0);
    expect(encodeNull().raw).toBe('DFS0000');
  });

  it('never emits s=0 for an omni report', () => {
    fc.assert(
      fc.property(omniReportArb, (report) => {
        expect(encodeOmni(report.payload).s).not.toBe(0);
      }),
    );
  });

  it('emits h, g and d as documented defaults on our own reports', () => {
    const wire = encodeNull();
    expect([wire.h, wire.g, wire.d]).toEqual([0, 0, 0]);
  });
});

describe('BRG degree conversion', () => {
  it('encodes north as 360, never 000', () => {
    expect(degreesToBrg(0)).toBe('360');
    expect(brgToDegrees('360')).toBe(0);
  });

  it('round-trips every whole degree', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 359 }), (deg) => {
        expect(brgToDegrees(degreesToBrg(deg))).toBe(deg);
      }),
    );
  });
});

describe('relayed reports → third-party traffic', () => {
  it('keeps the observer callsign at the head and names the entering operator separately', () => {
    // The split we derived from "a voice hop is where error enters" is the one AX.25 arrived at.
    const header = encodeThirdParty('KI7XYZ', 'W7NET', 'DFS5000');
    expect(header).toBe('}KI7XYZ>APRS,TCPIP,W7NET*:DFS5000');
  });

  it('round-trips through decode as third-party', () => {
    const raw = '}KI7XYZ>APRS,TCPIP,W7NET*:DFS5000';
    const wire = decodeWire(raw);
    expect(wire.format).toBe('third-party');
    expect(wire.raw).toBe(raw);
    expect(emitFromDigits(wire)).toBe(raw);
  });
});

/**
 * The `wire` object a report carries once ingested — log-format.md § 7.
 *
 * P1 ships no gateway, so nothing calls this at runtime. FR-006b still promises an ingested report
 * "retains the precision it arrived with", and that promise is only true if the raw digits survive
 * being put into the log's shape. Tested here rather than trusted.
 */
describe('the stored wire object', () => {
  it('keeps every digit the air handed us, including ones we cannot author', () => {
    // Q=9 (<1°) is unreachable from our interface — the cap stops at 5 — and legal on the air.
    // s=0 likewise: it is a `null` report, never an omni we could author.
    const fields = toWireFields(decodeWire('000/000/090/919'));
    expect(fields).toMatchObject({ format: 'DF', n: 9, r: 1, q: 9 });
    expect(fields.raw).toBe('000/000/090/919');

    expect(toWireFields(decodeWire('DFS0360'))).toMatchObject({
      format: 'DFS',
      s: 0,
      h: 3,
      g: 6,
      d: 0,
    });
  });

  it('carries the raw string, so a wrong parse never destroys the original', () => {
    fc.assert(
      fc.property(digitArb, digitArb, digitArb, (n, r, q) => {
        const raw = `000/000/090/${n}${r}${q}`;
        expect(toWireFields(decodeWire(raw)).raw).toBe(raw);
      }),
    );
  });

  it('keeps a third-party header whole', () => {
    const raw = '}KI7XYZ>APRS,TCPIP,W7NET*:DFS5000';
    expect(toWireFields(decodeWire(raw))).toEqual({ format: 'third-party', raw });
  });
});
