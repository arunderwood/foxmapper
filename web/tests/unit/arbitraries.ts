/** Shared fast-check arbitraries for the log property suites. */
import fc from 'fast-check';
import type {
  BearingReport,
  ConfidenceQ,
  FixReport,
  MaxRangeR,
  NullReport,
  OmniReport,
  Report,
  RetractionReport,
  StrengthS,
  WireDigit,
} from '../../src/log/types.js';
import { FORMAT_VERSION } from '../../src/log/types.js';

export const uuidArb = fc.uuid({ version: 4 });

export const callsignArb = fc.constantFrom(
  'KI7XYZ',
  'W7ABC',
  'N0CALL',
  'VE3QRP',
  'KD7FOX',
  'AA1BB',
);

export const digitArb = fc.constantFrom<WireDigit>(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
export const confidenceQArb = fc.constantFrom<ConfidenceQ>(3, 4, 5);
export const maxRangeRArb = fc.constantFrom<MaxRangeR>(1, 3, 5);
export const strengthSArb = fc.constantFrom<StrengthS>(2, 5, 8);

const latArb = fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true });
const lonArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });
const headingArb = fc.double({ min: 0, max: 359.9, noNaN: true, noDefaultInfinity: true });

/** The envelope every report carries, independent of kind. */
function baseArb() {
  return fc.record({
    v: fc.constant<typeof FORMAT_VERSION>(FORMAT_VERSION),
    id: uuidArb,
    hunt_code: fc.constantFrom('quiet-fox-8821', 'brisk-owl-3310'),
    observer: fc.record({ callsign: callsignArb }),
    position: fc.record({ lat: latArb, lon: lonArb }),
    position_source: fc.constantFrom('measured' as const, 'placed' as const),
    observed_at: fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }),
    clock_offset_ms: fc.option(fc.integer({ min: -600_000, max: 600_000 }), { nil: null }),
    entered_by: fc.record({ participant_id: uuidArb, callsign: callsignArb }),
  });
}

export const bearingReportArb: fc.Arbitrary<BearingReport> = fc
  .tuple(
    baseArb(),
    fc.record({
      heading_true: headingArb,
      heading_magnetic: headingArb,
      declination: fc.double({ min: -30, max: 30, noNaN: true, noDefaultInfinity: true }),
      wmm_epoch: fc.constant('WMM2025'),
      heading_source: fc.constantFrom('compass' as const, 'manual' as const),
      confidence_q: confidenceQArb,
      max_range_r: maxRangeRArb,
    }),
  )
  .map(([base, payload]) => ({ ...base, kind: 'bearing' as const, payload }));

export const omniReportArb: fc.Arbitrary<OmniReport> = fc
  .tuple(baseArb(), strengthSArb)
  .map(([base, strength_s]) => ({ ...base, kind: 'omni' as const, payload: { strength_s } }));

export const nullReportArb: fc.Arbitrary<NullReport> = baseArb().map((base) => ({
  ...base,
  kind: 'null' as const,
  payload: {},
}));

export const fixReportArb: fc.Arbitrary<FixReport> = baseArb().map((base) => ({
  ...base,
  kind: 'fix' as const,
  payload: {},
}));

export function retractionOfArb(targetId: fc.Arbitrary<string>): fc.Arbitrary<RetractionReport> {
  return fc.tuple(baseArb(), targetId).map(([base, retracts_id]) => ({
    ...base,
    kind: 'retraction' as const,
    payload: { retracts_id },
  }));
}

/** Every kind our interface can author. */
export const observationReportArb: fc.Arbitrary<Report> = fc.oneof(
  bearingReportArb,
  omniReportArb,
  nullReportArb,
  fixReportArb,
);

export const reportArb: fc.Arbitrary<Report> = fc.oneof(
  observationReportArb,
  retractionOfArb(uuidArb),
);

/** A log with unique ids — the G-Set invariant. */
export const logArb: fc.Arbitrary<Report[]> = fc
  .array(reportArb, { maxLength: 30 })
  .map(dedupeById);

export function dedupeById(reports: Report[]): Report[] {
  const seen = new Map<string, Report>();
  for (const r of reports) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}
