/**
 * The named reference hunts FR-038 requires, each with what the estimate must do on it.
 *
 * Every poor-geometry condition (FR-010 to FR-012), a hunt of only "heard nothing", a hunt of only
 * signal strength and "heard nothing", two conflicting finds, and one confidently wrong bearing.
 * All simulated, all seeded (FR-039).
 */
import type { EstimateReport } from '../../src/estimate/types.js';
import {
  bearingAt,
  fixAt,
  foxFor,
  FIVE_HUNDRED,
  mixedHunt,
  honestNull,
  Ids,
  mulberry32,
  nullAt,
  offset,
  omniAt,
  type ReferenceExpectation,
  type ReferenceHunt,
} from './simulate.js';

function scenario(
  name: string,
  seed: number,
  expect: ReferenceExpectation,
  build: (ctx: { rng: () => number; ids: Ids; fox: ReturnType<typeof foxFor> }) => EstimateReport[],
): ReferenceHunt {
  const rng = mulberry32(seed);
  const ids = new Ids(seed);
  const fox = foxFor(rng);
  return { name, source: 'simulated', fox, reports: build({ rng, ids, fox }), expect };
}

export const SCENARIOS: ReferenceHunt[] = [
  scenario(
    'one-bearing',
    101,
    { status: 'estimate', foxInside: true, warnings: ['too_few'] },
    ({ rng, ids, fox }) => [bearingAt(rng, ids, fox, { from: 200, km: 5, q: 4, r: 3 })],
  ),

  scenario(
    'two-crossing',
    102,
    { status: 'estimate', foxInside: true, absent: ['narrow_spread'], regions: 1 },
    ({ rng, ids, fox }) => [
      bearingAt(rng, ids, fox, { from: 180, km: 4, q: 5 }),
      bearingAt(rng, ids, fox, { from: 270, km: 4, q: 5 }),
    ],
  ),

  // Two observers half a kilometre apart, 8 km from the fox: their bearings differ by about 3.6°.
  scenario(
    'two-nearly-parallel',
    103,
    { status: 'estimate', warnings: ['narrow_spread'] },
    ({ rng, ids, fox }) => [
      bearingAt(rng, ids, fox, { from: 180, km: 8, q: 5 }),
      bearingAt(rng, ids, fox, { from: 180 + (0.5 / 8) * (180 / Math.PI), km: 8, q: 5 }),
    ],
  ),

  scenario(
    'three-from-one-spot',
    104,
    { status: 'estimate', warnings: ['narrow_spread'] },
    ({ rng, ids, fox }) => {
      const spot = offset(fox, 45, 6);
      return [0, 1, 2].map(() => ({
        ...bearingAt(rng, ids, fox, { from: 45, km: 6, q: 4 }),
        position: spot,
      }));
    },
  ),

  scenario(
    'two-groups',
    105,
    { status: 'estimate', foxInside: true, warnings: ['disagree'], regions: 2 },
    ({ rng, ids, fox }) => {
      const elsewhere = offset(fox, 90, 10);
      const group = (at: typeof fox) =>
        [0, 120, 240].map((from) => bearingAt(rng, ids, at, { from, km: 2, q: 5, r: 1 }));
      return [...group(fox), ...group(elsewhere)];
    },
  ),

  scenario('heard-nothing-only', 106, { status: 'none', regions: 0 }, ({ rng, ids, fox }) => [
    honestNull(rng, ids, fox, 8),
    honestNull(rng, ids, fox, 8),
    honestNull(rng, ids, fox, 8),
  ]),

  scenario(
    'signal-strength-and-heard-nothing',
    107,
    { status: 'estimate', foxInside: true },
    ({ ids, fox }) => [
      omniAt(ids, fox, { from: 30, bucket: 'strong', km: 0.4 }),
      omniAt(ids, fox, { from: 150, bucket: 'medium', km: 2 }),
      omniAt(ids, fox, { from: 260, bucket: 'weak', km: 7 }),
      nullAt(ids, fox, { from: 300, km: 5 }),
      nullAt(ids, fox, { from: 100, km: 4 }),
    ],
  ),

  scenario(
    'two-conflicting-finds',
    108,
    { status: 'estimate', foxInside: true, warnings: ['disagree'], regions: 2 },
    ({ rng, ids, fox }) => [fixAt(rng, ids, fox, fox), fixAt(rng, ids, fox, offset(fox, 120, 3))],
  ),

  scenario(
    'one-wrong-bearing',
    109,
    { status: 'estimate', foxInside: true, warnings: ['disagree'] },
    ({ rng, ids, fox }) => [
      bearingAt(rng, ids, fox, { from: 0, km: 3, q: 5 }),
      bearingAt(rng, ids, fox, { from: 120, km: 3, q: 5 }),
      bearingAt(rng, ids, fox, { from: 240, km: 3, q: 5 }),
      bearingAt(rng, ids, fox, { from: 60, km: 3, q: 5, errorDeg: 90 }),
    ],
  ),

  scenario(
    'heard-nothing-at-the-fox',
    110,
    { status: 'estimate', foxInside: true, warnings: ['disagree'] },
    ({ rng, ids, fox }) => [
      bearingAt(rng, ids, fox, { from: 10, km: 1.5, q: 5 }),
      bearingAt(rng, ids, fox, { from: 100, km: 1.5, q: 5 }),
      bearingAt(rng, ids, fox, { from: 190, km: 1.5, q: 5 }),
      bearingAt(rng, ids, fox, { from: 280, km: 1.5, q: 5 }),
      nullAt(ids, fox, { from: 0, km: 0 }),
    ],
  ),

  // A hunt of a realistic size — most hunts hold under 20 reports — with one confidently wrong
  // bearing among honest reports of every kind. Sharing the conflict level across the reports must
  // not hide a report that rejects the estimate outright (FR-012a).
  (() => {
    const crowd = mixedHunt(
      112,
      { bearings: 6, heard: 5, nulls: 5 },
      'one-wrong-bearing-in-a-crowd',
    );
    const rng = mulberry32(113);
    const wrong = bearingAt(rng, new Ids(113), crowd.fox, { from: 45, km: 3, q: 5, errorDeg: 90 });
    return {
      ...crowd,
      reports: [...crowd.reports, wrong],
      expect: { status: 'estimate' as const, warnings: ['disagree' as const] },
    };
  })(),

  // SC-002's size, not a typical hunt: most hunts hold under 20 reports. It stays for speed and
  // for FR-038; its fox is not asserted inside, since one hunt is one draw of a 9-in-10 claim.
  { ...mixedHunt(111, FIVE_HUNDRED, 'five-hundred'), expect: { status: 'estimate' } },
];
