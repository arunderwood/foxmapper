/**
 * Report authoring.
 *
 * Every report our interface can author must satisfy the honesty cap and the attribution rule.
 * Both are checkable here, before a browser or a hilltop is involved.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { composeBearing, CONFIDENCE_CHOICES, RANGE_CHOICES } from '../../src/report/bearing.js';
import { composeOmni, STRENGTH_CHOICES } from '../../src/report/omni.js';
import { composeHeardNothing } from '../../src/report/heard_nothing.js';
import { composeFix } from '../../src/report/fix.js';
import { relayContext } from '../../src/report/relay.js';
import { canRetract, composeRetraction } from '../../src/report/retract.js';
import { encodeBearing, encodeNull, encodeOmni } from '../../src/aprs/mapping.js';
import { fold } from '../../src/log/fold.js';
import { toLog } from '../../src/log/gset.js';
import { isRelayed, type BearingReport } from '../../src/log/types.js';
import { wedgeFor } from '../../src/map/wedge.js';
import type { AuthorContext } from '../../src/report/author.js';
import { confidenceQArb, maxRangeRArb, strengthSArb } from './arbitraries.js';

const ME = '11111111-1111-4111-8111-111111111111';

const context: AuthorContext = {
  huntCode: 'quiet-fox-8821-h7k2',
  identity: { participant_id: ME, callsign: 'KI7XYZ' },
  position: { lat: 48.7519, lon: -122.4787 },
  position_source: 'measured',
  position_accuracy_m: 8,
  observed_at: 1_784_092_800_000,
  clock_offset_ms: null,
};

const draft = { heading_magnetic: 256.2 };

describe('the envelope', () => {
  it('gives every report a distinct random id', () => {
    // Never content-derived: two operators relaying one voice call produce reports that may
    // serialize identically, and both must survive.
    const ids = new Set(Array.from({ length: 200 }, () => composeFix(context).id));
    expect(ids.size).toBe(200);
  });

  it('records observed_at, not the time it was typed', () => {
    const earlier = 1_784_000_000_000;
    expect(composeFix({ ...context, observed_at: earlier }).observed_at).toBe(earlier);
  });

  it('carries a null clock offset through rather than coalescing it to zero', () => {
    expect(composeFix(context).clock_offset_ms).toBeNull();
    expect(composeFix({ ...context, clock_offset_ms: 0 }).clock_offset_ms).toBe(0);
  });

  it('never writes a colour into the log', () => {
    // Colour is derived. Storing it would let two reports name one observer in two colours.
    const report = composeFix(context);
    expect(JSON.stringify(report)).not.toMatch(/colou?r/i);
  });

  it('never writes a relayed flag into the log', () => {
    const report = composeFix(context);
    expect(report).not.toHaveProperty('relayed');
  });
});

describe('bearing entry', () => {
  it('records magnetic, true, the declination and the model epoch', () => {
    // A log storing only heading_true would assert a conversion it cannot show its work for.
    const report = composeBearing({ ...context, draft, confidence_q: 4, max_range_r: 3 });

    expect(report.payload.heading_magnetic).toBeCloseTo(256.2);
    expect(report.payload.wmm_epoch).toBe('WMM2025');
    // Bellingham is about 15.2° east, so true is magnetic plus roughly that.
    expect(report.payload.declination).toBeCloseTo(15.2, 0);
    expect(report.payload.heading_true).toBeCloseTo(256.2 + report.payload.declination, 5);
  });

  it('always converts to true north — both platforms give magnetic', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 359.9, noNaN: true }), (magnetic) => {
        const report = composeBearing({
          ...context,
          draft: { ...draft, heading_magnetic: magnetic },
          confidence_q: 4,
          max_range_r: 3,
        });
        expect(report.payload.heading_true).toBeGreaterThanOrEqual(0);
        expect(report.payload.heading_true).toBeLessThan(360);
        expect(report.payload.declination).not.toBe(0);
      }),
    );
  });

  it('normalises a heading that wraps past north', () => {
    const report = composeBearing({
      ...context,
      draft: { ...draft, heading_magnetic: 350 },
      confidence_q: 4,
      max_range_r: 3,
    });
    // 350 + ~15.2 = ~5.2, not 365.2.
    expect(report.payload.heading_true).toBeLessThan(20);
  });

  it('records a bearing, never where the number came from (003 FR-010)', () => {
    // A bearing is a bearing: a compass freeze, a dial twist and a typed figure are the same fact.
    const report = composeBearing({ ...context, draft, confidence_q: 4, max_range_r: 3 });
    expect(Object.keys(report.payload).sort()).toEqual(
      ['confidence_q', 'declination', 'heading_magnetic', 'heading_true', 'max_range_r', 'wmm_epoch'].sort(),
    );
    expect(report.payload).not.toHaveProperty('heading_source');
    expect(report.payload).not.toHaveProperty('compass_accuracy_deg');
    // Nothing about the origin leaks into the serialized log either.
    expect(JSON.stringify(report)).not.toMatch(/heading_source|compass_accuracy/);
  });

  it('produces the same payload however the heading was set (SC-006/SC-008)', () => {
    // Frozen, twisted, typed — only heading_magnetic differs; no field names the source.
    const frozen = composeBearing({ ...context, draft: { heading_magnetic: 256.2 }, confidence_q: 4, max_range_r: 3 });
    const typed = composeBearing({ ...context, draft: { heading_magnetic: 100.0 }, confidence_q: 4, max_range_r: 3 });
    const { heading_true: _ft, heading_magnetic: _fm, declination: _fd, ...frozenRest } = frozen.payload;
    const { heading_true: _tt, heading_magnetic: _tm, declination: _td, ...typedRest } = typed.payload;
    expect(frozenRest).toEqual(typedRest);
  });

  it('still accepts a legacy payload that carries the removed fields (back-compat)', () => {
    // Readers MUST ignore heading_source/compass_accuracy_deg, not choke on them.
    const legacy: BearingReport = {
      ...composeBearing({ ...context, draft, confidence_q: 4, max_range_r: 3 }),
    };
    const withOldFields = {
      ...legacy,
      payload: { ...legacy.payload, heading_source: 'compass', compass_accuracy_deg: 12 },
    } as unknown as BearingReport;
    // The one consumer that reads a bearing payload — the wedge — renders it unchanged.
    expect(() => wedgeFor(withOldFields)).not.toThrow();
    expect(wedgeFor(withOldFields)).toEqual(wedgeFor(legacy));
  });

  it('offers exactly three confidence buttons and three range buttons', () => {
    // Ten targets is unhittable with a gloved thumb inside ten seconds (SC-001a).
    expect(CONFIDENCE_CHOICES).toHaveLength(3);
    expect(RANGE_CHOICES).toHaveLength(3);
  });

  it('speaks no protocol vocabulary in its labels — SC-008', () => {
    const labels = [...CONFIDENCE_CHOICES, ...RANGE_CHOICES].map((c) => c.label).join(' ');
    expect(labels).not.toMatch(/\b(NRQ|DFS|PHG)\b/i);
    expect(labels).not.toMatch(/\d/);
  });

  it('emits only Q in {3,4,5} and R in {1,3,5}, whatever the buttons offer', () => {
    fc.assert(
      fc.property(confidenceQArb, maxRangeRArb, (q, r) => {
        const report = composeBearing({ ...context, draft, confidence_q: q, max_range_r: r });
        const wire = encodeBearing(report.payload);
        expect([3, 4, 5]).toContain(wire.q);
        expect([1, 3, 5]).toContain(wire.r);
        expect(wire.n).toBe(9);
      }),
    );
  });

  it('every offered button maps to an allowed digit', () => {
    for (const { q } of CONFIDENCE_CHOICES) expect([3, 4, 5]).toContain(q);
    for (const { r } of RANGE_CHOICES) expect([1, 3, 5]).toContain(r);
  });
});

describe('the reports a stock antenna can file', () => {
  it('signal strength offers three buttons at the operators own midpoints', () => {
    expect(STRENGTH_CHOICES).toHaveLength(3);
    expect(STRENGTH_CHOICES.map((c) => c.s)).toEqual([2, 5, 8]);
  });

  it('an omni report never encodes as strength zero', () => {
    fc.assert(
      fc.property(strengthSArb, (s) => {
        expect(encodeOmni(composeOmni({ ...context, strength_s: s }).payload).s).not.toBe(0);
      }),
    );
  });

  it('heard-nothing is the string "null" on the wire and s=0 on the air', () => {
    const report = composeHeardNothing(context);
    expect(report.kind).toBe('null');
    expect(JSON.parse(JSON.stringify(report)).kind).toBe('null');
    expect(report.payload).toEqual({});
    expect(encodeNull().s).toBe(0);
  });

  it('heard-nothing needs no antenna, no heading and no training', () => {
    // Principle II: kind + position + time is the whole claim.
    const report = composeHeardNothing(context);
    expect(Object.keys(report.payload)).toHaveLength(0);
  });

  it('a find does not close the hunt', () => {
    const found = composeFix(context);
    const later = composeHeardNothing(context);
    const result = fold(toLog([found, later]));
    expect(result.found).toBe(true);
    // Reports continue after found goes true.
    expect(result.active).toHaveLength(2);
  });

  it('two conflicting finds both stand', () => {
    const mine = composeFix(context);
    const theirs = composeFix({
      ...context,
      identity: { participant_id: '2', callsign: 'W7ABC' },
      position: { lat: 48.8, lon: -122.5 },
    });
    // The system does not adjudicate.
    expect(fold(toLog([mine, theirs])).active).toHaveLength(2);
  });
});

describe('relayed entry — SC-011', () => {
  const relayed = relayContext(context, {
    observerCallsign: 'w7abc',
    observerPosition: { lat: 48.9, lon: -122.6 },
    observedAt: 1_784_000_000_000,
  });

  it('attributes the observation to the observer, never to who typed it', () => {
    // 0 relayed reports attributed to the operator who typed them.
    const report = composeBearing({ ...relayed, draft, confidence_q: 4, max_range_r: 3 });
    expect(report.observer.callsign).toBe('W7ABC');
    expect(report.entered_by.callsign).toBe('KI7XYZ');
    expect(isRelayed(report)).toBe(true);
  });

  it('uses the observers position, not net controls', () => {
    const report = composeFix(relayed);
    expect(report.position).toEqual({ lat: 48.9, lon: -122.6 });
    expect(report.position_source).toBe('placed');
    // Net control's GPS accuracy is not the observer's, and carrying it would claim a fix that
    // never happened.
    expect(report.position_accuracy_m).toBeUndefined();
  });

  it('uses the observers time, not when it was typed', () => {
    expect(composeFix(relayed).observed_at).toBe(1_784_000_000_000);
  });

  it('the observer need not be a participant', () => {
    // A voice-only operator with a radio and no phone appears on the map having never joined.
    const report = composeFix(relayed);
    expect(report.observer).toEqual({ callsign: 'W7ABC' });
    expect(report.observer).not.toHaveProperty('participant_id');
  });

  it('net control relaying their own observation is not relayed', () => {
    const own = relayContext(context, {
      observerCallsign: 'KI7XYZ',
      observerPosition: { lat: 48.9, lon: -122.6 },
      observedAt: 1_784_000_000_000,
    });
    expect(isRelayed(composeFix(own))).toBe(false);
  });

  it('every kind can be relayed', () => {
    expect(isRelayed(composeOmni({ ...relayed, strength_s: 5 }))).toBe(true);
    expect(isRelayed(composeHeardNothing(relayed))).toBe(true);
    expect(isRelayed(composeFix(relayed))).toBe(true);
  });
});

describe('retraction', () => {
  it('appends a fact rather than removing anything', () => {
    const original = composeFix(context);
    const retraction = composeRetraction(context, original.id);
    const log = toLog([original, retraction]);

    // The retracted report stays in the log forever.
    expect(log.size).toBe(2);
    expect(log.has(original.id)).toBe(true);
    expect(fold(log).active).toHaveLength(0);
  });

  it('is offered to whoever entered the report', () => {
    expect(canRetract(composeFix(context), ME)).toBe(true);
    expect(canRetract(composeFix(context), 'someone-else')).toBe(false);
  });

  it('is offered for a relayed report to the operator who entered it', () => {
    // The observer has no device in the hunt and could not retract it.
    const relayed = composeFix(
      relayContext(context, {
        observerCallsign: 'W7ABC',
        observerPosition: { lat: 48.9, lon: -122.6 },
        observedAt: 1_784_000_000_000,
      }),
    );
    expect(canRetract(relayed, ME)).toBe(true);
  });

  it('is not offered for a retraction', () => {
    const retraction = composeRetraction(context, 'some-id');
    expect(canRetract(retraction, ME)).toBe(false);
  });

  it('works when its target has not arrived yet', () => {
    const retraction = composeRetraction(context, 'never-arrives');
    const result = fold(toLog([retraction]));
    expect(result.retracted.has('never-arrives')).toBe(true);
    expect(result.active).toHaveLength(0);
  });
});
