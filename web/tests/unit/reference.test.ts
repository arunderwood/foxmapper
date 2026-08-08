/**
 * The north-reference rules (005, contracts/reference-entry.md §2–3).
 *
 * The dial component itself is exercised end-to-end by Playwright; what belongs here is the rule
 * table — the part where a wrong branch silently reinterprets a number in the other frame and a
 * bearing lands ~15° off with nobody the wiser. `createReferenceState` is the same instance the
 * component drives, so these tests and the screen share one implementation of the rules.
 */
import { describe, expect, it } from 'vitest';
import { createReferenceState } from '../../src/ui/compass-dial.js';
import { toTrueHeading } from '../../src/sensors/declination.js';

/** Bellingham-ish, and unmistakable in an assertion. */
const DECL = 15.5;

describe('surface defaults (contract §2)', () => {
  it('the compass-drafting sheet opens in true', () => {
    expect(createReferenceState(DECL, 'true').reference()).toBe('true');
  });

  it('the relay sheet opens in magnetic', () => {
    expect(createReferenceState(DECL, 'magnetic').reference()).toBe('magnetic');
  });
});

describe('transitions (contract §3)', () => {
  it('going live forces true, whatever was chosen before', () => {
    const ref = createReferenceState(DECL, 'true');
    ref.onSwitch(); // explicitly magnetic
    ref.onGoLive();
    expect(ref.reference()).toBe('true');
  });

  it('a fresh typed number lands magnetic — the empty-state rule', () => {
    const ref = createReferenceState(DECL, 'true');
    ref.onTypeFresh();
    expect(ref.reference()).toBe('magnetic');
  });

  it('the empty-state rule never overrides an explicit chip choice', () => {
    // Net control taps "enter as true north" and then types: the number is true, as chosen.
    const ref = createReferenceState(DECL, 'magnetic');
    ref.onSwitch(); // explicitly true
    ref.onTypeFresh();
    expect(ref.reference()).toBe('true');
  });

  it('going live forgets the explicit choice — it belonged to a dead value', () => {
    const ref = createReferenceState(DECL, 'true');
    ref.onSwitch(); // explicitly magnetic
    ref.onGoLive(); // sensor takes over: true again
    ref.onTypeFresh(); // fresh typing after live is hand entry again
    expect(ref.reference()).toBe('magnetic');
  });

  it('the chip flips the frame each tap', () => {
    const ref = createReferenceState(DECL, 'magnetic');
    expect(ref.other()).toBe('true');
    ref.onSwitch();
    expect(ref.reference()).toBe('true');
    ref.onSwitch();
    expect(ref.reference()).toBe('magnetic');
  });
});

describe('conversion (contract §3, §5)', () => {
  const ref = createReferenceState(DECL, 'magnetic');

  it('converts by exactly the declination — once, never twice (FR-004)', () => {
    // The switch-preview number for 220° magnetic: 235.5° true, not 251.0.
    expect(ref.convert(220, 'magnetic', 'true')).toBeCloseTo(235.5, 10);
    expect(ref.convert(220, 'magnetic', 'true')).not.toBeCloseTo(220 + 2 * DECL, 1);
  });

  it('same-frame conversion only normalizes', () => {
    expect(ref.convert(365, 'true', 'true')).toBeCloseTo(5, 10);
  });

  it('switching there and back restores the number — no drift a flip could accumulate', () => {
    for (const heading of [0, 0.1, 90, 220, 344.5, 359.9]) {
      expect(ref.convert(ref.convert(heading, 'magnetic', 'true'), 'true', 'magnetic')).toBeCloseTo(
        heading,
        10,
      );
    }
  });

  it('preserves the physical direction across the flip', () => {
    // 344.5° magnetic and 0° true are the same direction under +15.5° declination — the
    // screenshot case, as the chip preview must show it.
    expect(ref.convert(344.5, 'magnetic', 'true')).toBeCloseTo(0, 10);
    expect(toTrueHeading(344.5, DECL)).toBeCloseTo(0, 10);
  });
});
