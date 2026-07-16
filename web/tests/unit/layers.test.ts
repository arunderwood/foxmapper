/**
 * Rendering rules per data-model.md § Rendering.
 *
 * These are the constitution's visible surface: a relayed report that renders as first-hand, or a
 * null report that implies a direction, is Principle I failing where a hunter can act on it.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { render } from '../../src/map/layers.js';
import { fold } from '../../src/log/fold.js';
import { toLog } from '../../src/log/gset.js';
import { colourFor } from '../../src/log/colour.js';
import type { Report } from '../../src/log/types.js';
import { logArb, observationReportArb } from './arbitraries.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function base(id: string, kind: Report['kind']): Report {
  return {
    v: 1,
    id,
    hunt_code: 'quiet-fox-8821-h7k2',
    kind,
    observer: { callsign: 'KI7XYZ' },
    position: { lat: 48.7519, lon: -122.4787 },
    position_source: 'measured',
    observed_at: 1_784_092_800_000,
    clock_offset_ms: 0,
    entered_by: { participant_id: A, callsign: 'KI7XYZ' },
    payload: {},
  } as Report;
}

const bearing = (id: string): Report => ({
  ...base(id, 'bearing'),
  kind: 'bearing',
  payload: {
    heading_true: 271.4,
    heading_magnetic: 256.2,
    declination: 15.2,
    wmm_epoch: 'WMM2025',
    heading_source: 'compass',
    confidence_q: 4,
    max_range_r: 3,
  },
});

const renderOf = (reports: Report[]) => render(fold(toLog(reports)));

describe('each kind renders as its rule says', () => {
  it('a bearing is a bounded sector', () => {
    const { wedges, markers } = renderOf([bearing('a')]);
    expect(wedges.features).toHaveLength(1);
    expect(markers.features).toHaveLength(0);
    expect(wedges.features[0]!.geometry.type).toBe('Polygon');
  });

  it('omni, null and fix are markers that imply no direction', () => {
    // A marker at a position and nothing more: no arrow, no cone, no circle. Interpreting how
    // much ground a null report kills is fusion, and there is no fusion.
    for (const kind of ['omni', 'null', 'fix'] as const) {
      const report =
        kind === 'omni'
          ? ({ ...base('a', 'omni'), kind, payload: { strength_s: 5 } } as Report)
          : base('a', kind);
      const { wedges, markers } = renderOf([report]);

      expect(wedges.features).toHaveLength(0);
      expect(markers.features).toHaveLength(1);
      expect(markers.features[0]!.geometry.type).toBe('Point');
      // Nothing directional reaches the renderer for these kinds.
      expect(JSON.stringify(markers.features[0]!.properties)).not.toMatch(/heading|bearing/i);
    }
  });

  it('omni and null are distinguishable from each other', () => {
    const omni = { ...base('a', 'omni'), kind: 'omni', payload: { strength_s: 5 } } as Report;
    const heardNothing = base('b', 'null');
    const { markers } = renderOf([omni, heardNothing]);

    const kinds = markers.features.map((f) => f.properties.kind).sort();
    expect(kinds).toEqual(['null', 'omni']);
    // Strength is legible on an omni report and absent on a null one — silence is not "strength
    // zero" in the domain, even though it is s=0 on the wire.
    const nullFeature = markers.features.find((f) => f.properties.kind === 'null')!;
    expect(nullFeature.properties.strength_s).toBeUndefined();
    expect(markers.features.find((f) => f.properties.kind === 'omni')!.properties.strength_s).toBe(5);
  });

  it('never renders a retraction', () => {
    fc.assert(
      fc.property(logArb, (reports) => {
        const { wedges, markers } = renderOf(reports);
        for (const f of [...wedges.features, ...markers.features]) {
          expect(f.properties.kind).not.toBe('retraction');
        }
      }),
    );
  });

  it('never renders a retracted report', () => {
    const retraction: Report = {
      ...base('r', 'retraction'),
      kind: 'retraction',
      payload: { retracts_id: 'a' },
    };
    const { wedges, markers } = renderOf([bearing('a'), retraction]);
    expect([...wedges.features, ...markers.features]).toHaveLength(0);
  });
});

describe('provenance is in the primary view, not a tooltip', () => {
  it('a relayed report is marked and names the entering operator', () => {
    // FR-012b. A voice hop is where error enters, and the map must say so.
    const relayed: Report = {
      ...bearing('a'),
      observer: { callsign: 'W7ABC' },
      entered_by: { participant_id: B, callsign: 'W7NET' },
    };
    const props = renderOf([relayed]).wedges.features[0]!.properties;

    expect(props.relayed).toBe(true);
    expect(props.entered_by).toBe('W7NET');
    // The observation is attributed to the observer, never to the operator who typed it (SC-011).
    expect(props.label).toBe('W7ABC');
    expect(props.colour).toBe(colourFor('W7ABC'));
  });

  it('net control relaying their own observation is not marked relayed', () => {
    // Falls out of deriving `relayed` from the two callsigns, with no special case in the code.
    const own: Report = {
      ...bearing('a'),
      observer: { callsign: 'W7NET' },
      entered_by: { participant_id: B, callsign: 'W7NET' },
    };
    expect(renderOf([own]).wedges.features[0]!.properties.relayed).toBe(false);
  });

  it('every rendered report carries its observer callsign and colour', () => {
    fc.assert(
      fc.property(fc.array(observationReportArb, { maxLength: 8 }), (reports) => {
        const unique = [...new Map(reports.map((r) => [r.id, r])).values()];
        const { wedges, markers } = renderOf(unique);
        for (const f of [...wedges.features, ...markers.features]) {
          expect(f.properties.label.length).toBeGreaterThan(0);
          expect(f.properties.colour).toMatch(/^#[0-9a-f]{6}$/);
        }
      }),
    );
  });

  it('a placed position is distinguishable from a measured one', () => {
    const placed: Report = { ...base('a', 'fix'), position_source: 'placed' };
    expect(renderOf([placed]).markers.features[0]!.properties.placed).toBe(true);
    expect(renderOf([base('b', 'fix')]).markers.features[0]!.properties.placed).toBe(false);
  });

  it('shows the collision suffix only when two participants share a callsign', () => {
    const mine = base('a', 'fix');
    const theirs: Report = {
      ...base('b', 'fix'),
      entered_by: { participant_id: B, callsign: 'KI7XYZ' },
    };

    expect(renderOf([mine]).markers.features[0]!.properties.label).toBe('KI7XYZ');
    const labels = renderOf([mine, theirs]).markers.features.map((f) => f.properties.label).sort();
    expect(labels).toEqual(['KI7XYZ ·11', 'KI7XYZ ·22']);
  });
});

describe('time is shown with its caveat', () => {
  it('an unmeasured clock is flagged as unknown, not as correct', () => {
    // null is not zero. Rendering an unmeasured clock as accurate would be the map lying to
    // exactly the people who cannot tell.
    const props = renderOf([{ ...base('a', 'fix'), clock_offset_ms: null }]).markers.features[0]!
      .properties;
    expect(props.clock_unknown).toBe(true);
    expect(props.clock_suspect).toBe(false);
    expect(props.display_at).toBe(props.observed_at);
  });

  it('a known-bad clock is flagged and corrected for display only', () => {
    const skew = 5 * 60 * 1_000;
    const props = renderOf([{ ...base('a', 'fix'), clock_offset_ms: skew }]).markers.features[0]!
      .properties;
    expect(props.clock_suspect).toBe(true);
    // The reported time survives untouched; the correction sits beside it.
    expect(props.observed_at).toBe(1_784_092_800_000);
    expect(props.display_at).toBe(1_784_092_800_000 - skew);
  });

  it('a measured, good clock is neither unknown nor suspect', () => {
    const props = renderOf([base('a', 'fix')]).markers.features[0]!.properties;
    expect(props.clock_unknown).toBe(false);
    expect(props.clock_suspect).toBe(false);
  });
});

describe('rendering is age-neutral', () => {
  it('shifting every timestamp changes nothing but the times shown', () => {
    // FR-012a: no fading, no ranking, no filtering. An old report is evidence, not noise.
    fc.assert(
      fc.property(
        fc.array(observationReportArb, { maxLength: 6 }),
        fc.integer({ min: -1e9, max: 1e9 }),
        (reports, shift) => {
          const unique = [...new Map(reports.map((r) => [r.id, r])).values()];
          const before = renderOf(unique);
          const after = renderOf(unique.map((r) => ({ ...r, observed_at: r.observed_at + shift })));

          expect(after.wedges.features.length).toBe(before.wedges.features.length);
          expect(after.markers.features.length).toBe(before.markers.features.length);
        },
      ),
    );
  });

  it('renders identically on two devices holding the same log', () => {
    // Principle IV, stated as a render property: the map is a fold, computed identically from the
    // same log everywhere.
    fc.assert(
      fc.property(logArb, (reports) => {
        const one = renderOf(reports);
        const other = renderOf([...reports].reverse());
        const ids = (r: ReturnType<typeof renderOf>) =>
          [...r.wedges.features, ...r.markers.features].map((f) => f.properties.report_id).sort();
        expect(ids(one)).toEqual(ids(other));
      }),
    );
  });
});
