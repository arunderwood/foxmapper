/**
 * The boundary between the log and the estimate: active reports in, kernel fields out.
 *
 * Every field the kernels do not read is dropped here — times, clock offsets, position accuracy and
 * source, observer and enterer. That is how FR-006, FR-008 and FR-009 hold by construction rather
 * than by care: a relayed report and a direct one with the same content arrive identical apart from
 * their ids, and nothing downstream can tell a placed position from a measured one.
 */
import type { ObservationReport, WireDigit } from '../log/types.js';
import type { EstimateInput, EstimateReport } from './types.js';

function toEstimateReport(report: ObservationReport): EstimateReport {
  const position = { lat: report.position.lat, lon: report.position.lon };
  switch (report.kind) {
    case 'bearing':
      return {
        kind: 'bearing',
        id: report.id,
        position,
        heading_true: report.payload.heading_true,
        confidence_q: report.payload.confidence_q as WireDigit,
        max_range_r: report.payload.max_range_r as WireDigit,
      };
    case 'omni':
      return {
        kind: 'omni',
        id: report.id,
        position,
        strength_s: report.payload.strength_s as WireDigit,
      };
    case 'null':
      return { kind: 'null', id: report.id, position };
    case 'fix':
      return { kind: 'fix', id: report.id, position };
  }
}

/** Ids compare by UTF-16 code units, which every engine orders the same way. */
export function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function toEstimateInput(
  active: readonly ObservationReport[],
  generation: number,
): EstimateInput {
  return { reports: active.map(toEstimateReport).sort(byId), generation };
}
