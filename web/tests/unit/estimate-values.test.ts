/**
 * The estimate values hold the relations the model depends on (data-model.md §2, Validation).
 *
 * A maintainer tuning one number (FR-037) can break a relation no single value shows: a floor of 1
 * silences a report kind, and medians that rise with strength make louder mean farther.
 */
import { describe, expect, it } from 'vitest';
import { ESTIMATE_VALUES as V } from '../../src/estimate/values.js';

describe('estimate values', () => {
  it('puts every floor strictly between 0 and 1 (FR-040)', () => {
    for (const floor of [V.BEARING_FLOOR, V.OMNI_FLOOR, V.NULL_FLOOR, V.FIX_FLOOR]) {
      expect(floor).toBeGreaterThan(0);
      expect(floor).toBeLessThan(1);
    }
  });

  it('clears fully inside a "heard nothing" before it fades', () => {
    expect(V.NULL_CLEAR_INNER_KM).toBeLessThan(V.NULL_CLEAR_OUTER_KM);
  });

  it('pulls louder reports closer (FR-004b)', () => {
    expect(V.OMNI_MEDIAN_KM.medium).toBeLessThan(V.OMNI_MEDIAN_KM.weak);
    expect(V.OMNI_MEDIAN_KM.strong).toBeLessThan(V.OMNI_MEDIAN_KM.medium);
  });

  it('orders the strength buckets without overlap', () => {
    const { weak, medium, strong } = V.OMNI_STRENGTH_BUCKETS;
    expect(weak.max).toBeLessThan(medium.min);
    expect(medium.max).toBeLessThan(strong.min);
  });

  it('holds the region at 9 in 10 (FR-003)', () => {
    expect(V.REGION_LEVEL).toBe(0.9);
    expect(V.REFINE_LEVEL).toBeGreaterThan(V.REGION_LEVEL);
  });

  it('is frozen, all the way down', () => {
    expect(Object.isFrozen(V)).toBe(true);
    expect(Object.isFrozen(V.OMNI_MEDIAN_KM)).toBe(true);
    expect(Object.isFrozen(V.OMNI_STRENGTH_BUCKETS)).toBe(true);
    expect(Object.isFrozen(V.OMNI_STRENGTH_BUCKETS.weak)).toBe(true);
  });
});
