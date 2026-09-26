/**
 * The estimate's input carries only what the kernels read (FR-006, FR-008, FR-009).
 *
 * A report's age, clock, position accuracy, hand placement and relay hop never reach the estimate,
 * so nothing downstream can weight by them, however it is later changed.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toEstimateInput } from '../../src/estimate/input.js';
import type { ObservationReport } from '../../src/log/types.js';
import { observationReportArb } from './arbitraries.js';

const DROPPED = [
  'observed_at',
  'clock_offset_ms',
  'position_accuracy_m',
  'position_source',
  'observer',
  'entered_by',
];

const activeArb = fc.array(observationReportArb, { maxLength: 20 }) as fc.Arbitrary<
  ObservationReport[]
>;

function keysDeep(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]);
}

describe('toEstimateInput', () => {
  it('drops every time, clock, accuracy, placement and relay field', () => {
    fc.assert(
      fc.property(activeArb, (active) => {
        const input = toEstimateInput(active, 1);
        const keys = new Set(input.reports.flatMap(keysDeep));
        return DROPPED.every((key) => !keys.has(key));
      }),
    );
  });

  it('gives the same output whatever order the reports come in', () => {
    fc.assert(
      fc.property(activeArb, fc.integer(), (active, seed) => {
        const shuffled = [...active].sort((a, b) => (a.id + seed < b.id + seed ? 1 : -1));
        expect(toEstimateInput(shuffled, 7)).toEqual(toEstimateInput(active, 7));
      }),
    );
  });

  it('sorts by id', () => {
    fc.assert(
      fc.property(activeArb, (active) => {
        const ids = toEstimateInput(active, 0).reports.map((r) => r.id);
        return ids.every((id, i) => i === 0 || ids[i - 1]! <= id);
      }),
    );
  });

  it('maps a relayed report and a direct one with the same content alike', () => {
    fc.assert(
      fc.property(observationReportArb, (report) => {
        const direct = {
          ...report,
          entered_by: { participant_id: 'p-direct', callsign: report.observer.callsign },
          position_source: 'measured',
          position_accuracy_m: 5,
        } as ObservationReport;
        const relayed = {
          ...report,
          id: `${report.id}-relayed`,
          entered_by: { participant_id: 'p-net', callsign: 'W7NET' },
          position_source: 'placed',
          clock_offset_ms: null,
        } as ObservationReport;
        const [a] = toEstimateInput([direct], 0).reports;
        const [b] = toEstimateInput([relayed], 0).reports;
        expect({ ...b, id: a!.id }).toEqual(a);
      }),
    );
  });
});
