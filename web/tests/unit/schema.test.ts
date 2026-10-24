/**
 * The reader's contract, docs/schema/report.v1.schema.json, against the three things that must
 * agree with it: the prose spec's own examples, everything this client authors, and the bodies a
 * hostile poster can get past a relay that never reads them.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { isReport } from '../../src/log/validate.js';
import { fold } from '../../src/log/fold.js';
import { toLog } from '../../src/log/gset.js';
import { render } from '../../src/map/layers.js';
import {
  decodeWire,
  emit,
  encodeBearing,
  encodeNull,
  toWireFields,
} from '../../src/aprs/mapping.js';
import type { BearingReport, NullReport } from '../../src/log/types.js';
import { bearingReportArb, nullReportArb, reportArb } from './arbitraries.js';

const valid: NullReport = {
  v: 1,
  id: '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
  hunt_code: 'quiet-fox-8821-h7k2',
  kind: 'null',
  observer: { callsign: 'KI7XYZ' },
  position: { lat: 48.7519, lon: -122.4787 },
  position_source: 'measured',
  observed_at: 1_784_092_800_000,
  clock_offset_ms: null,
  entered_by: { participant_id: '3c9a1b2d-0e4f-4a5b-8c6d-7e8f9a0b1c2d', callsign: 'KI7XYZ' },
  payload: {},
};

/** `valid` with one path replaced, or removed when `value` is undefined. */
function poisoned(path: string, value?: unknown): unknown {
  const body = structuredClone(valid) as unknown as Record<string, unknown>;
  const keys = path.split('.');
  const last = keys.pop()!;
  let parent = body;
  for (const key of keys) parent = parent[key] as Record<string, unknown>;
  if (value === undefined) Reflect.deleteProperty(parent, last);
  else parent[last] = value;
  return body;
}

describe('log-format.md examples', () => {
  // §2's report and §3's payloads, in document order. If the prose and the schema disagree, the
  // doc a third party reads is describing reports this client refuses to draw.
  const doc = readFileSync('../docs/log-format.md', 'utf8');
  const section = doc.slice(doc.indexOf('## 2. Report'), doc.indexOf('## 4. Merge'));
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]!));
  const [report, ...payloads] = blocks;
  const kinds = ['bearing', 'omni', 'null', 'fix', 'retraction'] as const;

  it('has one example per kind', () => {
    expect(payloads).toHaveLength(kinds.length);
  });

  for (const [i, kind] of kinds.entries()) {
    it(`the ${kind} example is a readable report`, () => {
      expect(isReport({ ...report, kind, payload: payloads[i] })).toBe(true);
    });
  }
});

describe('everything this client writes is readable', () => {
  it('authored reports of every kind', () => {
    fc.assert(fc.property(reportArb, (report) => isReport(report)));
  });

  it('ingested reports carrying their wire fields', () => {
    fc.assert(
      fc.property(bearingReportArb, nullReportArb, (bearing: BearingReport, heard: NullReport) => {
        const bearingWire = toWireFields(decodeWire(emit(encodeBearing(bearing.payload))));
        const nullWire = toWireFields(decodeWire(emit(encodeNull())));
        return (
          isReport({ ...bearing, wire: bearingWire }) &&
          isReport({ ...heard, wire: nullWire }) &&
          isReport({ ...heard, wire: { format: 'third-party', raw: '}W7ABC>APRS:hello' } })
        );
      }),
    );
  });

  it('keeps fields it does not recognise, including the retired bearing provenance (§3, §10)', () => {
    expect(isReport({ ...valid, some_future_field: { nested: true } })).toBe(true);
    fc.assert(
      fc.property(bearingReportArb, (bearing) =>
        isReport({
          ...bearing,
          payload: { ...bearing.payload, heading_source: 'compass', compass_accuracy_deg: 12 },
        }),
      ),
    );
  });
});

describe('bodies the relay accepts and the fold must not', () => {
  const cases: [string, unknown][] = [
    // The finding's proof of concept: everything present except whose observation it is.
    ['no observer', poisoned('observer')],
    ['no entered_by', poisoned('entered_by')],
    ['a null payload', poisoned('payload', null)],
    ['a null lat', poisoned('position.lat', null)],
    ['a string lat', poisoned('position.lat', '48.7')],
    ['a lat off the planet', poisoned('position.lat', 91)],
    ['a fractional observed_at', poisoned('observed_at', 1.5)],
    ['a version this reader cannot know', poisoned('v', 2)],
    ['a kind outside the vocabulary', poisoned('kind', 'triangulation')],
    ['a retraction naming nothing', { ...valid, kind: 'retraction', payload: {} }],
    ['an omni with no strength', { ...valid, kind: 'omni', payload: {} }],
    ['an omni claiming it heard nothing', { ...valid, kind: 'omni', payload: { strength_s: 0 } }],
    [
      'a bearing beyond the compass',
      {
        ...valid,
        kind: 'bearing',
        payload: {
          heading_true: 1e308,
          heading_magnetic: 0,
          declination: 0,
          wmm_epoch: 'WMM2025',
          confidence_q: 4,
          max_range_r: 3,
        },
      },
    ],
    ['a wire that is not an object', poisoned('wire', 'DFS0460')],
    ['not an object at all', 'report'],
  ];

  for (const [name, body] of cases) {
    it(`refuses ${name}`, () => {
      expect(isReport(body)).toBe(false);
    });
  }

  it('one poisoned body leaves the rest of the picture standing', () => {
    const poison = {
      ...(poisoned('observer') as object),
      id: '4c592c05-3411-4899-a4cb-ba8ba3ed520f',
    };
    const log = toLog([poison as { id: string }, valid]);

    const folded = fold(log);
    expect(folded.active.map((r) => r.id)).toEqual([valid.id]);
    expect(render(folded).markers.features).toHaveLength(1);
    // Still a member: id_digest is computed over the log, and the relay holds this id too.
    expect([...log.keys()]).toContain(poison.id);
  });
});
