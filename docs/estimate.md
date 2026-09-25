# The location estimate

The map can shade where the fox probably is. The shading combines every active report in the hunt:
bearings, signal-strength reports, "heard nothing" reports, and finds. Each participant turns it on
for their own device in **Settings → Show where the fox probably is**. It is off by default, and
turning it on or off changes nothing for anyone else.

This page explains the model in words. Every number the model uses lives in one file,
[`web/src/estimate/values.ts`](../web/src/estimate/values.ts), beside the reason for its value. This
page names those values and does not repeat them, so the two cannot disagree.

## What the map shows

- **One or more hatched regions.** Together they hold `REGION_LEVEL` of the estimate's probability.
  The label along each edge says so in words: "fox probably inside · about 9 in 10".
- **Never a point.** There is no centre mark, no most-likely spot, no gradient that peaks in the
  middle, and no coordinates. A point invites a hunter to drive to it, and a point says nothing about
  how sure anyone is.
- **Every report stays on top.** The region draws beneath every wedge, marker and label.
- **Warnings in the status bar**, for exactly as long as their condition holds. They are never in a
  tooltip and cannot be dismissed. See [Warnings](#warnings).

## Where it is computed

On each device, from the reports that device holds, in a background worker, so report entry never
waits for it. The hunt server never computes, stores or sends an estimate. The estimate is never
written to the log ([log-format.md](log-format.md)): it is recomputed from the log whenever the log
changes.

Two devices that hold the same reports draw the same region, to the byte (see
[Same region on every phone](#same-region-on-every-phone)). Two devices that hold different reports
draw different regions, and each one is honest about what it holds.

## How each report counts

The estimate starts from "the fox could be anywhere the reports reach" and lets each report reshape
it. Each report kind makes one claim about the ground, called its **kernel**: a number between the
report's **floor** and 1 at every point. The estimate multiplies every report's kernel together.

| Report | Its claim | Named values |
|---|---|---|
| Bearing | The fox is probably along this heading, within the stated range. The spread matches the wedge the map draws, so the estimate never trusts a bearing more than its wedge says. Beyond the stated range the bearing fades out and then adds nothing. A confidence digit with no agreed width counts at the widest width, as the wedge does. | `BEARING_SIGMA_FRACTION`, `BEARING_RANGE_TAPER`, `BEARING_FLOOR` |
| Signal strength | Louder means probably closer, loosely. Each strength bucket has a most likely distance, with a spread wide enough to cover mismatched radios and antennas. Past a reach limit it says nothing. | `OMNI_STRENGTH_BUCKETS`, `OMNI_MEDIAN_KM`, `OMNI_LOG_SD`, `OMNI_REACH_KM`, `OMNI_FLOOR` |
| Heard nothing | The fox is probably not right here. It clears a small circle fully and a larger one partly. It never makes any other place more likely. | `NULL_CLEAR_INNER_KM`, `NULL_CLEAR_OUTER_KM`, `NULL_FLOOR` |
| Found it | Strong evidence at the finder's position. It feeds the estimate like any other report, so a wrong find can be outweighed, and two conflicting finds make two regions. | `FIX_SIGMA_KM`, `FIX_FLOOR` |

What the estimate never reads: a report's time, its clock offset, the phone's position accuracy,
whether the position was placed by hand, and whether the report was relayed. A week-old report counts
the same as a fresh one; a participant who no longer believes a report retracts it. Retracted reports
do not count at all.

### The floor

No single report can rule out ground the other reports support. Each kernel has a floor: a place a
report contradicts keeps at least that share of what the report gives its best place. One confidently
wrong bearing therefore cannot shrink the region onto the wrong place. It can only raise the "reports
disagree" warning. Silence is the least reliable claim, so "heard nothing" has the highest floor.

### Where the fox can be

Only ground that some bearing, signal-strength report or find points at can hold the fox
(`SUPPORT_FLOOR_MULTIPLE`). "Heard nothing" never creates ground. A hunt of only "heard nothing"
reports draws no region, and says that nothing points at the fox yet.

## The region

The ground is divided into a square grid of cells (`GRID_CELLS_PER_SIDE`). The region is the
smallest set of cells that holds `REGION_LEVEL` of the probability, taken most probable first. Cells
that touch each other form one region. Cells that do not touch form separate regions, so two groups
of reports that point at two places draw two regions, never one blob between them.

The grid is computed twice. The first pass covers every report's reach. The second pass re-grids the
box that holds nearly all of the first pass's probability (`REFINE_LEVEL`, `REFINE_PAD_FRACTION`),
so a tight region is drawn at a fine scale without a larger grid. Each region's outline follows the
probability itself, so its edge is smooth, and a "heard nothing" inside a region can cut a hole in it.

## Warnings

| Chip | When | Named value |
|---|---|---|
| Too few reports to trust the shading yet | Fewer bearings, signal-strength reports and finds than the threshold. "Heard nothing" does not count: silence points at nothing. | `TOO_FEW_REPORTS` |
| Reports all point the same way — distance unknown | The reporting stations, seen from the region, span a narrow angle. It does not apply when a station stands at the region, and it always applies when every station stands in one place. | `NARROW_SPREAD_DEG`, `SPREAD_NEAR_KM`, `SAME_PLACE_KM` |
| The reports disagree | A second region holds a large share of the probability, **or** some report agrees with the estimate so little that it is contradicting it. The chip never says which report: the estimate does not rank or label reports or participants. | `SECOND_PLACE_SHARE`, `CONFLICT_AGREEMENT` |
| Nothing points at the fox yet | No bearing, signal-strength report or find exists. This is a state, not a caution. | — |

A report's **agreement** is how strongly it supports the estimate, on one scale for every kind: 0
when it rejects the whole estimate, 1 when it fully supports it. Only the lowest agreement leaves the
estimate, as one number. The conflict level is shared across all active reports: every honest report
falls short now and then by luck, and the lowest of several would otherwise read as a conflict. A
report that rejects the estimate outright has an agreement near 0 and still raises the warning.

## Same region on every phone

JavaScript engines agree exactly on `+ − × ÷` and on `Math.sqrt`, but not on `Math.exp`, `Math.log`,
`Math.sin`, `Math.cos` or `Math.atan2`: those may differ in the last bit between an iPhone and an
Android phone. One bit can move a cell across the edge of the region. So the estimate carries its own
versions of those five functions ([`detmath.ts`](../web/src/estimate/detmath.ts)), built only from
operations every engine computes identically. Reports are sorted by id before any arithmetic, and
ties break by cell index. A test fails any other `Math` call in the estimate's code, and the e2e suite
checks that Chromium and WebKit draw the same bytes as the engine run on its own.

Devices on different releases can draw different regions from the same reports, if the values
changed between the releases. The reports themselves are never affected.

## Reference hunts

The model is tested against **reference hunts**: sets of reports with a known fox position.

- **Simulated** hunts are generated from fixed seeds
  ([`web/tests/reference/`](../web/tests/reference/)). Each report's error is drawn from the
  distribution its own stated confidence claims: a bearing misses by the spread its wedge implies, a
  signal strength is drawn from how well each bucket fits the true distance, and a "heard nothing" is
  filed only where silence is honest. A named scenario covers each warning condition, a hunt of only
  "heard nothing", a hunt of only signal strength and "heard nothing", two conflicting finds, one
  confidently wrong bearing, the same among a realistic crowd of honest reports, and a 500-report
  hunt that exists to test speed. A large random batch of hunts of 2–14 reports, the size most hunts
  are, measures how often the fox lies inside the region, and how often an honest report is read as
  a conflict.
- **Recorded** hunts are real hunts with a confirmed fox position. There are none yet. See
  [`web/tests/reference/recorded/README.md`](../web/tests/reference/recorded/README.md) to add one.

**A simulated hunt proves the estimate agrees with its own assumptions. It does not prove the
estimate is right in the field.** Every coverage figure says which kind of hunt it rests on.

## Changing a value

Only maintainers change the values, in a release.

1. Edit one value in `values.ts`, and its reason.
2. Run the reference hunts:
   `cd web && npx vitest run tests/unit/reference-hunts.test.ts --reporter=verbose`.
3. Accept the change only if every check still passes. Put the old and new coverage lines in the
   pull request.

Participants cannot change any value, and a hunt cannot carry its own.

## Limits

The estimate is an argument built from what people reported, and it is no better than what they
reported. It assumes one fox that does not move and that transmits often enough to be heard. It takes
each report's stated confidence at face value. It is not fit for search and rescue or any life-safety
use.
