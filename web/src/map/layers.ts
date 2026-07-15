/**
 * Rendering the log.
 *
 * | Kind | Drawn as | Constraint |
 * |---|---|---|
 * | `bearing` | Sector, width from confidence, length from range | Never an unbounded ray |
 * | `omni` | Marker, strength legible | **Must not imply a direction** |
 * | `null` | Marker, distinct from omni | **Must not imply the target is elsewhere** |
 * | `fix` | Marker | |
 *
 * Every report shows its observer's callsign and colour and when it was taken. A relayed report
 * is visibly marked and names the entering operator too. A `placed` position is visibly distinct
 * from a `measured` one.
 *
 * **Nothing here reads report age.** No fading, no ranking, no time filtering (FR-012a).
 */
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import type { FoldResult } from '../log/fold.js';
import { ambiguousCallsigns, colourFor, displayName } from '../log/colour.js';
import { displayTime, type ClockOffset } from '../log/clock.js';
import { isRelayed, type ObservationReport } from '../log/types.js';
import { wedgeFor } from './wedge.js';

/** What the map shows about a report, independent of how it is styled. */
export interface ReportProperties {
  report_id: string;
  kind: ObservationReport['kind'];
  /** Callsign, with the collision suffix only when a collision actually exists. */
  label: string;
  colour: string;
  /** Derived, never stored: observer.callsign !== entered_by.callsign. */
  relayed: boolean;
  /** Present only on a relayed report: who typed it. */
  entered_by?: string;
  placed: boolean;
  /** The reporter's own timestamp. Never rewritten. */
  observed_at: number;
  /** Corrected for the authoring device's known clock error, for display only. */
  display_at: number;
  /** True when the authoring device never measured its clock — not the same as an offset of 0. */
  clock_unknown: boolean;
  /** True when the authoring device knew its clock was more than two minutes out. */
  clock_suspect: boolean;
  /** omni only. */
  strength_s?: number;
}

const SKEW_WARNING_MS = 2 * 60 * 1_000;

export interface RenderedLog {
  /** Bearing wedges. */
  wedges: FeatureCollection<Polygon, ReportProperties>;
  /** omni, null and fix, as markers at a position. */
  markers: FeatureCollection<Point, ReportProperties>;
}

/**
 * Turns a fold into what the map draws. Pure — same log, same output, on every device.
 */
export function render(fold: FoldResult): RenderedLog {
  const ambiguous = ambiguousCallsigns(fold.active);

  const wedges: Feature<Polygon, ReportProperties>[] = [];
  const markers: Feature<Point, ReportProperties>[] = [];

  for (const report of fold.active) {
    const properties = propertiesOf(report, ambiguous);

    if (report.kind === 'bearing') {
      const wedge = wedgeFor(report);
      wedges.push({ ...wedge, properties });
      continue;
    }

    // omni, null and fix are all a marker at a position and nothing more. There is no arrow, no
    // cone, and no circle: interpreting how much ground a null report kills is fusion, and P1
    // draws no circle because there is no fusion.
    markers.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [report.position.lon, report.position.lat] },
      properties,
    });
  }

  return {
    wedges: { type: 'FeatureCollection', features: wedges },
    markers: { type: 'FeatureCollection', features: markers },
  };
}

function propertiesOf(
  report: ObservationReport,
  ambiguous: ReadonlySet<string>,
): ReportProperties {
  const offset: ClockOffset = report.clock_offset_ms;
  const relayed = isRelayed(report);

  return {
    report_id: report.id,
    kind: report.kind,
    // The callsign is the identifier; colour is only an aid. FR-012 requires the callsign on every
    // report, so identity never rests on colour alone — which matters, because with twelve
    // swatches a hunt of eight will usually contain a collision.
    label: displayName(report.observer.callsign, report.entered_by.participant_id, ambiguous),
    colour: colourFor(report.observer.callsign),
    relayed,
    ...(relayed ? { entered_by: report.entered_by.callsign } : {}),
    placed: report.position_source === 'placed',
    observed_at: report.observed_at,
    display_at: displayTime(report.observed_at, offset),
    clock_unknown: offset === null,
    clock_suspect: offset !== null && Math.abs(offset) > SKEW_WARNING_MS,
    ...(report.kind === 'omni' ? { strength_s: report.payload.strength_s } : {}),
  };
}
