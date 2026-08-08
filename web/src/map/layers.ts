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
import { ambiguousCallsigns, colourFor, labelFor } from '../log/colour.js';
import { displayTime, isSkewed, type ClockOffset } from '../log/clock.js';
import { isRelayed, type ObservationReport } from '../log/types.js';
import { wedgeFor } from './wedge.js';

/** What the map shows about a report, independent of how it is styled. */
export interface ReportProperties {
  report_id: string;
  kind: ObservationReport['kind'];
  /** Callsign, with the collision suffix only when a collision actually exists. */
  label: string;
  /**
   * What the map draws beside the report: the callsign, plus every caveat that must not wait for a
   * tap — the voice hop and its operator (FR-012b), and a position nobody measured (FR-008).
   *
   * Multi-line. Distinct from `label`, which is one line and names the observer only.
   */
  map_label: string;
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
  /**
   * omni only: how strong the signal was, as the raw on-air digit.
   *
   * Named for the claim rather than the protocol field it comes from, because the map styles on it
   * and every string in a rendering module is one copy-paste from a screen.
   */
  strength?: number;
  /** bearing only: both frames of the heading, verbatim from the payload, for the detail popup
   *  (005 FR-010). Stored values, never recomputed — one report renders one way on every client. */
  heading_true?: number;
  heading_magnetic?: number;
}

/**
 * The popup's heading line: both frames, each labeled, whole degrees (005 display contract §2 —
 * sub-degree digits would out-precise a compass that is honest to maybe a degree). Rounding folds
 * so 359.6 reads 0°, never 360°.
 */
export function bearingDetailLine(headingTrue: number, headingMagnetic: number): string {
  const whole = (v: number): number => Math.round(v) % 360;
  return `Bearing ${whole(headingTrue)}° true (${whole(headingMagnetic)}° on a magnetic compass)`;
}

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

function propertiesOf(report: ObservationReport, ambiguous: ReadonlySet<string>): ReportProperties {
  const offset: ClockOffset = report.clock_offset_ms;
  const relayed = isRelayed(report);
  const placed = report.position_source === 'placed';

  // The callsign is the identifier; colour is only an aid. FR-012 requires the callsign on every
  // report, so identity never rests on colour alone — which matters, because with twelve
  // swatches a hunt of eight will usually contain a collision.
  const label = labelFor(report, ambiguous);

  return {
    report_id: report.id,
    kind: report.kind,
    label,
    map_label: mapLabel(label, relayed ? report.entered_by.callsign : undefined),
    colour: colourFor(report.observer.callsign),
    relayed,
    ...(relayed ? { entered_by: report.entered_by.callsign } : {}),
    placed,
    observed_at: report.observed_at,
    display_at: displayTime(report.observed_at, offset),
    clock_unknown: offset === null,
    // `isSkewed`, not a second copy of the two minutes FR-009c names: the chip that warns the
    // reporter and the caveat this puts on their report have to mean the same thing forever.
    clock_suspect: isSkewed(offset),
    ...(report.kind === 'omni' ? { strength: report.payload.strength_s } : {}),
    ...(report.kind === 'bearing'
      ? {
          heading_true: report.payload.heading_true,
          heading_magnetic: report.payload.heading_magnetic,
        }
      : {}),
  };
}

/**
 * The text drawn beside a report.
 *
 * The voice hop stays in the primary view: a relayed report crossed the place where error
 * enters, its outline dashes to mark it, and only words can say who carried it. The
 * hand-placed caveat moved to the detail popup by maintainer call (feedback round 3): with
 * placement being the normal entry method for whole classes of hunters, "set by hand" on
 * every such report was clutter drowning the caveat that matters more — `placed` still
 * travels on the feature and the popup still says it.
 */
function mapLabel(label: string, enteredBy: string | undefined): string {
  const lines = [label];
  // Names the operator as well as marking the hop — a shape can mark it, but only words can say who.
  if (enteredBy) lines.push(`via ${enteredBy}`);
  return lines.join('\n');
}
