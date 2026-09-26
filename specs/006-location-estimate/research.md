# Research: Location Estimate

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-25

Each entry: **Decision**, **Rationale**, **Alternatives considered**. Numbers quoted from the
prototype come from `node` runs of a throwaway script on the maintainer's laptop. They are
simulated hunts and prove self-consistency only (spec FR-039). The real numbers come from the
reference-hunt suite the tasks build.

---

## R1. Model: a posterior on a grid

**Decision**: Treat each active report as a likelihood over the ground and multiply them over a
uniform prior. Represent the result on a square grid of cells in a local flat projection. The 90%
region is the smallest set of cells that together hold 90% of the probability (a highest-density
region), found by sorting cells by probability.

**Rationale**: Every report kind already has a clear claim that maps to a likelihood: a wedge, a
distance ring, a cleared circle, a spot. A grid handles all four kinds, multi-modal evidence, and
the floor rule (R3) with the same arithmetic. The region falls out of the grid directly, and the
region's probability is exact by construction, which makes FR-003 and FR-036 true by definition,
not by approximation. The grid is also easy to explain in `docs/estimate.md`.

**Alternatives considered**:
- *Least-squares triangulation of bearings, with an error ellipse*: bearings only. It cannot use
  signal-strength or "heard nothing" reports, so Principle II rules it out. An ellipse also cannot
  show two places.
- *Particle filter*: randomness makes FR-018 (same region on every device) depend on a seeded RNG
  and sample count. It gives no gain over a grid for one stationary transmitter.
- *Polygon intersection of wedges*: gives a hard shape with no probability. It cannot state "9 in
  10", and one wrong wedge empties the intersection.

## R2. Likelihood for each report kind

**Decision**: One kernel per kind. Each kernel is at most 1 and at least its floor (R3). Every
constant is a named value in `values.ts` (R8).

| Kind | Kernel | Named values |
|---|---|---|
| `bearing` | Angular: von Mises in the offset between the stated heading and the direction from observer to cell. κ = 1/σ², σ = the half-width from the existing Q table × `BEARING_SIGMA_FRACTION` (0.5, so the drawn wedge holds about 95%). Distance: 1 up to 90% of the stated range, linear to 0 at the range itself over its last `BEARING_RANGE_TAPER` (10%). The fade sits inside the range so nothing lands past it (FR-004a). | `BEARING_SIGMA_FRACTION`, `BEARING_RANGE_TAPER`, `BEARING_FLOOR` |
| `omni` | Log-normal ring in distance: exp(−(ln(d/m))² / 2s²). The median distance m comes from the strength bucket (weak 1–3, medium 4–6, strong 7–9). Beyond `OMNI_REACH_KM` the kernel is 0. | `OMNI_MEDIAN_KM` {weak 8, medium 2, strong 0.4}, `OMNI_LOG_SD` 1.2, `OMNI_REACH_KM` 40, `OMNI_FLOOR` |
| `null` | 1 − (1 − floor) × c(d). c is 1 inside `NULL_CLEAR_INNER_KM` (0.5), falls linearly to 0 at `NULL_CLEAR_OUTER_KM` (1.5). | `NULL_CLEAR_INNER_KM`, `NULL_CLEAR_OUTER_KM`, `NULL_FLOOR` |
| `fix` | Gaussian spot, σ = `FIX_SIGMA_KM` (0.1). | `FIX_SIGMA_KM`, `FIX_FLOOR` |

Bearings use `heading_true`. A confidence digit with no agreed width uses the widest width, as the
wedge already does (`WIDEST_HALF_WIDTH_DEGREES`). Range comes from the existing `rangeMiles`.
Nothing reads `observed_at`, `clock_offset_ms`, `position_accuracy_m`, `position_source`, or the
relay fields (FR-006, FR-008, FR-009). A unit test pins this by building the kernel input type with
those fields absent.

**Rationale**:
- *Bearing*: the wedge the map draws is the reporter's claim. Setting σ to half the half-width
  makes the wedge the ~95% band of the kernel, so the estimate never trusts a bearing more than its
  wedge says (FR-014). The range cut makes FR-004a literal: beyond the stated range, the bearing
  adds nothing but its floor.
- *Omni*: the clarified rule is "louder means probably closer, loosely". A log-normal ring with a
  wide spread (s = 1.2 is a factor of about 3.3 either way at one standard deviation) says exactly
  that, and it lets a weak report say "probably not right here" as well. Comparing two observers
  needs no extra rule: each report's ring does the work. The medians are rough 2 m band figures for
  a fox of 0.5–5 W heard on a handheld. They are the least certain values in the model, and the
  wide spread is the honest response.
- *Null*: the spec says "when unsure, rule out less". 0.5 km fully cleared and 1.5 km partly
  cleared is conservative for a handheld on a 2 m fox. The null floor is the highest of the four
  (R3), because intermittent sources and terrain shadow make silence the least reliable claim.
- *Fix*: a find is the strongest evidence a hunt can hold (FR-005). 100 m covers "I'm standing at
  it" plus a phone position error.

**Alternatives considered**:
- *Gaussian angular kernel*: it needs a wrapped form near ±180°. Von Mises is periodic by
  construction and costs one dot product per cell.
- *Omni as a hard disc ("heard, so within X km")*: it discards strength, which weakens Principle II
  and contradicts the clarified answer.
- *Weighting by `position_accuracy_m`*: log-format §8 forbids it, and so does FR-009.

## R3. The floor (FR-040), and its value

**Decision**: Every kernel has a floor: `BEARING_FLOOR` 0.02, `OMNI_FLOOR` 0.1, `FIX_FLOOR` 0.02,
`NULL_FLOOR` 0.25. A cell a report contradicts keeps at least that fraction of the likelihood the
report gives its best cell. So one report can cut an area's odds by at most 50:1 (bearing, fix),
10:1 (omni), or 4:1 (null).

**Rationale**: The floor is what stops one report from ruling out an area the others support. It
trades region size against robustness. Prototype runs (bearing-only simulated hunts):

| `BEARING_FLOOR` | Coverage, honest reports only (1,000 hunts) | Coverage with one confidently wrong bearing (300 hunts) | Mean region area, wrong-bearing hunts |
|---|---|---|---|
| 0.001 | 92.8% | 88.0% | 8.3 km² |
| 0.01 | 97.1% | 95.3% | 10.9 km² |
| **0.02** | **98.2%** | **97.7%** | **14.3 km²** |
| 0.05 | 99.3% | 99.7% | 29.0 km² |

With a near-zero floor, the model alone is calibrated (92.8% against a 90% claim). That shows the
kernels match the simulation. 0.02 keeps SC-012 above 90% with room to spare while only doubling
the region against 0.001. 0.05 doubles it again for little gain. The other floors are set by how
much each claim deserves: an omni ring is vaguer than a wedge, and silence is the least reliable
claim of all.

**Alternatives considered**:
- *Drop outliers (reject any report beyond a residual cut)*: this silently discards a report,
  which the spec forbids. It also needs an order, and order breaks FR-018.
- *No floor*: fails FR-040 by definition. At 0.001 the wrong-bearing coverage already falls below
  90%.

## R4. Domain, grid, and refinement

**Decision**:
1. **Projection**: local equirectangular, centred on the midpoint of the bounding box of the
   positive reports' observer positions. Midpoint of a min/max box, so it does not depend on
   report order.
2. **Domain**: only cells inside the *positive support* carry prior mass. A cell is in support when
   at least one bearing, omni or fix kernel is above twice its floor there. Cells outside support
   have zero prior. "Heard nothing" never creates support (FR-004c, FR-015).
3. **Grid**: `GRID_CELLS_PER_SIDE` = 128. Pass 1 covers the square bounding box of all positive
   supports. Pass 2 re-grids the square box of pass 1's 99.9% region (`REFINE_LEVEL`), padded by
   `REFINE_PAD_FRACTION` (10%) plus one cell. The region, its probability, and the warnings come
   from pass 2.

**Rationale**:
- Without the support mask, floor-level cells far from any evidence fill the 90% region with flat,
  tied cells. In the prototype that made a single bearing's region spill across empty bounding-box
  corners chosen by tie-break order. With the mask, a single bearing's region is the central part
  of its wedge over its full length. That matches FR-011 and spec scenario 2.
- A 32-mile bearing makes a ~100 km domain. At 128 cells that is ~800 m per cell, too coarse for a
  find. The refine pass brings a tight region down to metres without a larger grid.
- The flat projection is off by well under 1° of bearing within 50 km of the centre. The narrowest
  wedge the interface can claim is 16° wide, so the error is invisible against any claim.

**Alternatives considered**:
- *One 512² grid*: 16× the work of 128² for the same result in almost every hunt.
- *Refine each region separately*: better for far-apart regions, but more code. The single refine
  box is accepted, and two regions 50 km apart keep pass-1 resolution, which is still honest.
- *Geodesic distances per cell*: slower, and it gains nothing at these scales.

## R5. Same region on every device (FR-018, SC-005)

**Decision**: The estimate kernel uses only operations that ECMAScript defines exactly: `+ − × ÷`,
comparisons, `Math.sqrt`, `Math.floor`, `Math.abs`, `Math.min`, `Math.max`. It carries its own
`exp`, `ln`, `sin`, `cos` and `atan2` in `detmath.ts`, built from those operations only (range
reduction plus fixed-degree polynomials). Reports are sorted by `id` before any arithmetic. Ties in
cell order break by cell index.

**Rationale**: ECMA-262 specifies Number `+ − × ÷` as IEEE 754 binary64 with round-to-nearest-even,
so they produce the same bits in V8, JavaScriptCore and SpiderMonkey. It also forbids fusing them
into FMA. `Math.sqrt` is exact too: §21.3.2.33 returns "𝔽(the square root of ℝ(n))", the correctly
rounded value. The note in §21.3.2 names `exp`, `log`, `sin`, `cos`, `atan2`, `hypot` and `pow`
among the functions that are "not precisely specified", and engines really do differ in the last
bit. A one-bit
difference can move a boundary cell across the 90% cut, and then an iPhone and an Android phone
draw different regions from the same reports. Owning the functions makes that impossible. The cost
is ~100 lines and a test that compares them with `Math` to within 1e-12 relative error.

A source-scan unit test fails if any file under `web/src/estimate/` calls a `Math.` function
outside the exact set. The e2e suite also runs the same reference hunts in `chromium` and
`mobile-safari` (WebKit) and compares a SHA-256 of the canonical result (SC-005).

**Alternatives considered**:
- *Quantize the posterior before sorting*: this shrinks the problem but does not remove it. A value
  near a quantization edge still flips.
- *Fixed-point integer arithmetic throughout*: exact, but it needs a fixed-point `exp` and `ln`
  anyway, and it is harder to read than binary64 with owned functions.
- *Accept small differences and define "same" with a tolerance*: FR-018 says "the same region", and
  a warning that shows on one phone and not another is exactly what a participant would notice.

## R6. Warning metrics and thresholds (FR-010 to FR-012a, FR-034)

**Decision**: Four measured values. Each is exposed on the result (FR-036), and each has one named
threshold.

| Warning | Measured value | Threshold | Initial value |
|---|---|---|---|
| Too few reports (FR-010) | Count of active positive reports: `bearing`, `omni`, `fix` | `TOO_FEW_REPORTS` | 3 (fewer triggers) |
| All point the same way (FR-011) | Angular span of positive observers as seen from the probability-weighted centre of the largest region: 360° minus the largest gap between their directions | `NARROW_SPREAD_DEG` | 30 (less triggers) |
| More than one place (FR-012) | Share of total probability held by the second-largest region | `SECOND_PLACE_SHARE` | 0.15 (at least triggers) |
| One report conflicts (FR-012a) | Lowest normalized agreement over all active reports, where agreement = (E[kernel under the posterior] − floor) / (1 − floor), so 0 means the report rejects the whole estimate and 1 means it fully supports it | `CONFLICT_AGREEMENT`, divided by the number of active reports | 0.1 (less triggers) |

Observers within `SPREAD_NEAR_KM` (0.5) of the centre are left out of the span, and when one is
present the spread warning does not apply. A station standing at the fox, or a find, is the best
geometry a hunt can have. The spread metric also needs at least two positive observers more than
`SAME_PLACE_KM` (0.05) apart, or the warning applies: three bearings from one spot cannot fix a
distance.

**Rationale**:
- *Count*: Principle I says "fewer than three reports". Silence cannot point at anything (FR-015),
  so counting nulls would let five "heard nothing" reports and one bearing claim good geometry.
- *Spread*: this is the classic DF geometry measure. It covers bearings and signal strength
  equally, which is why the copy says "reports", not "bearings". 30° is where two crossing
  bearings' distance error grows past about twice their angular error.
- *Second place*: regions come from connected components (R7), so "more than one place" is literal.
  15% keeps a speck at the edge of the 90% cut from raising a warning, while a real second
  candidate always does.
- *Conflict*: normalizing by the floor puts all four kinds on one scale, so a "heard nothing" at the
  centre of the region counts as a conflict just as a bearing pointing away does. The measure is an
  aggregate minimum, and no per-report value leaves the module, so FR-026 holds by construction.
  The level is divided by the number of active reports (a Bonferroni split): compared against the
  level itself, the lowest of several honest reports falls short by luck. Implementation measured
  the undivided level raising the warning on about 10% of simulated honest hunts of 2–14 reports,
  and the divided level on about 1%. A confidently wrong bearing among 16 honest reports still
  raises it, because its agreement is close to 0.

**Alternatives considered**:
- *Geometric dilution of precision from bearing crossing angles*: bearings only, so Principle II
  rules it out as the sole measure.
- *Leave-one-out conflict (re-run without each report)*: exact, but 500 extra grids at 500 reports.
  The expectation is a single pass over the region.
- *Detecting multiple places with peak finding*: plateaus and ridges make peaks unstable.
  Connected components of the 90% region are what the map draws anyway.

## R7. From cells to map regions

**Decision**: Label the 90% cells into connected components (8-connected, scan order, so labels are
deterministic). For each component, contour the pass-2 probability grid restricted to that
component at the probability of the last cell admitted to the 90% set, using `d3-contour` (marching
squares). Convert back to longitude/latitude with the inverse projection. Round coordinates to 1e-6°.
Each component becomes one region, carrying its polygon and its probability.

**Rationale**: Contouring the probability itself, not a 0/1 mask, gives smooth edges that follow the
real density, not staircase cell edges. `d3-contour` is small (~4 kB), dependency-free apart from
`d3-array`, deterministic, and returns GeoJSON MultiPolygons with holes. That matters: a "heard
nothing" in the middle of a region makes a hole.

**Alternatives considered**:
- *Draw the cells as squares*: blocky, and it looks like false precision at the edges.
- *Own marching-squares code*: ~120 lines to maintain for what a well-used library already does.
- *Convex hull per region*: hides holes and bulges, so the map would claim ground the reports
  cleared.

## R8. One documented place for the values (FR-033 to FR-035, FR-037)

**Decision**: `web/src/estimate/values.ts` exports one frozen object. Each field carries its value,
unit, and a doc comment giving the reason. No other file under `web/src/estimate/` may contain a
numeric literal except 0, 1, 2 and 0.5. ESLint `no-magic-numbers` enforces this, scoped to that
directory, with `values.ts` and `detmath.ts` exempt. `detmath.ts` holds polynomial coefficients,
which are mathematics, not tuning. `docs/estimate.md` explains the model and links the values file
without copying any number.

**Rationale**: A lint rule turns "no such value may appear anywhere else" from a review habit into a
CI failure. Keeping the reasons beside the values means a change to one is a change to the other in
the same diff.

**Alternatives considered**:
- *A JSON file*: no place for reasons, and no types.
- *Numbers in the docs page as well*: two copies of a table agree right up until one is edited. This
  repo already learned that lesson with the Q table (`confidence.ts`).

## R9. Reference hunts (FR-038, FR-039, SC-001)

**Decision**:
- `web/tests/reference/simulate.ts` generates simulated hunts from a list of named, seeded
  scenarios. It draws each report's error from the same distribution the report's stated confidence
  claims (R2), using a small seeded PRNG (mulberry32). Every scenario records its fox position and
  the label `simulated`.
- The required scenarios (FR-038): one bearing; two crossing; two nearly parallel; three from one
  spot; two groups pointing at two places; only "heard nothing"; only signal strength and "heard
  nothing"; two conflicting finds; one confidently wrong bearing among correct ones; a "heard
  nothing" at the fox; a 500-report hunt.
- A calibration batch: 1,000 random hunts from fixed seeds. SC-001 is measured on this batch.
- `web/tests/reference/recorded/` holds recorded hunts: a log export plus a confirmed fox position,
  labelled `recorded`. It is empty today and has a README saying how to add one.
- The suite prints its coverage line with the simulated/recorded split, so every claim about
  SC-001 says what it rests on (FR-039).

**Rationale**: Fixed seeds make the suite deterministic, so a failure is a change, not bad luck. A
1,000-hunt batch gives a 95% interval of about ±1.5 points around the measured coverage, enough to
tell 90% from 88%.

**Alternatives considered**:
- *Committing generated JSON fixtures*: large diffs on every generator change, and nothing gained
  over seeds.
- *Random seeds on every run*: a flaky SC-001.

## R10. Where it runs (FR-017, FR-020, FR-021, SC-002)

**Decision**: Run the estimate in a dedicated module Web Worker, loaded with Vite's `?worker&url`
import (the pattern `basemap.ts` already uses for MapLibre). The main thread sends the active
reports, reduced to the fields the kernels read, and gets back the result. Requests coalesce: while
one runs, only the latest pending request is kept, and a result for an older generation is dropped.
The worker is created only while the estimate is on (FR-031).

**Offline**: the worker script is not referenced from `index.html`, so the service worker's shell
list does not include it. At startup, the app issues one `fetch` of the worker URL in the
background, whether or not the estimate is on. The cache-first handler stores it. A participant who
first turns the estimate on with no signal still gets it, if the app loaded once online since the
release. An e2e test covers exactly this path.

**Performance**: the prototype took 233 ms for 500 active reports (150 bearings, 150 omni, 200
nulls) on an Apple laptop, with naive support testing. A mid-range phone is roughly 4–6× slower,
which gives about 1–1.4 s. The real kernel culls each report to its support box and evaluates the
support test once per cell, not once per report. SC-002 is checked in e2e under Chromium CPU
throttling at 4×.

**Rationale**: A worker is the only way to guarantee FR-021 at 500 reports. Report entry stays on a
thread the estimate never touches.

**Alternatives considered**:
- *Main thread, time-sliced*: every slice still competes with the compass dial's 60 fps.
- *WebAssembly*: faster, but it needs a toolchain in `web/`, and R5's exact-arithmetic argument
  would have to be made again for a second language.
- *Relying on the shell precache*: it cannot see the worker, as shown above.

## R11. The on/off setting and the tour

**Decision**:
- The meta store key `estimate_enabled` holds the setting, next to `relay_mode`. It is
  device-scoped and not keyed by hunt, following the same rule. Missing means off (FR-029).
- Settings gains a toggle, "Show where the fox probably is", in the device-switch group, sending
  `estimate_toggled {enabled}` through the existing `track()` (FR-041).
- The tour's `estimate` step keeps its sample while the estimate is off or has no region, and adds
  one line naming the Settings switch. While the estimate is on and a region exists, the step drops
  the sample and spotlights the map.

**Rationale**: It reuses the relay switch's storage, sheet, and analytics pattern, so there is
nothing new to learn or review.

**Alternatives considered**:
- *A map-corner toggle*: faster to reach, but it adds a control to the primary view that most
  hunters will never use, and the spec puts it in Settings.

## R12. Drawing the region (FR-013, FR-023, FR-024)

**Decision**:
- A new GeoJSON source and three layers, inserted *below* the wedge layers so every report draws
  on top (FR-023):
  1. A fill with a diagonal hatch pattern. The pattern is generated at runtime into an `ImageData`
     and added with `map.addImage`, which needs no new CSP source. Low opacity.
  2. A solid outline, 3 px, over a 5 px halo in the map's surface colour, for bright light.
  3. A line-placed text label along the outline: "fox probably inside · about 9 in 10". It runs
     along the edge, never at a centre point, so nothing reads as a spot (FR-002).
- One colour token, `--estimate`, chosen outside the twelve observer swatches and checked by the
  existing contrast test in both themes. Shape (hatch plus outline) carries the meaning, and colour
  only helps (FR-024).
- Warnings are status-bar chips of the existing `warn` family, shown only while the estimate is on
  (FR-032):
  - "Too few reports to trust the shading yet"
  - "Reports all point the same way — distance unknown"
  - "The reports disagree"
  - "Nothing points at the fox yet" (FR-015; `dim` family, since it is a state, not a caution)

**Rationale**: The status bar is where the constitution's "never a footer, tooltip, or dismissible
modal" content already lives. A hatch reads in sunlight and under colour-vision deficiency where a
tint alone would not.

**Alternatives considered**:
- *A gradient fill (dense in the middle)*: it implies a most-likely point, which FR-002 forbids.
- *Warnings drawn on the map near the region*: they would collide with report labels, and the status
  bar is already the agreed home.

## R13. Words (FR-003, FR-016, SC-007)

**Decision**: Extend `tests/unit/vocabulary.test.ts` with a second banned list for estimate
surfaces: *probability, credible, confidence interval, posterior, likelihood, Bayesian, sigma,
percent, %, HPD, grid, kernel*. Participant copy uses "probably", "about 9 in 10",
"shading", "reports".

**Rationale**: The existing test already guards NRQ, DFS and PHG. The same mechanism covers the new
words.

**Alternatives considered**: *Review alone*: a review is exactly what SC-007 asks to verify, and the
test makes the verification repeatable.
