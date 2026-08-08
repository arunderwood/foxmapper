# Contract: Heading Display Surfaces

**Feature**: 005-true-north-bearings | Governs: `map-view.ts` (popup), `settings.ts`, plus the
labeling rule for any surface that shows a heading number

## 1. The universal labeling rule (FR-002)

Anywhere a heading number is rendered, its reference is visible adjacent to it, in the words
"true" / "magnetic" — never a lone number, never an abbreviation (°T/°M are CalTopo's idiom, not
this app's voice), never protocol vocabulary. Default (non-entry) surfaces display **true only**;
magnetic appears exactly twice in the whole app outside entry: the report popup's paired value and
nowhere else. Current audit of number-rendering surfaces: the dial field (entry contract), the
report popup (below), the settings line (below). The tour and landing demo render wedges without
numerals and need no change; any future numeral inherits this rule.

## 2. Report popup: both values (FR-010, Story 3 scenario 2)

Bearing popups gain one line, from the stored payload (never recomputed):

```
Bearing 235° true (220° on a magnetic compass)
```

- Whole degrees (R9), `Math.round(x) % 360` so 359.6 shows as 0, never 360.
- `heading_true` and `heading_magnetic` as logged — the line must render identically on every
  client for the same report (Principle IV), which stored-values-only guarantees.
- Position in the popup: after the time line, before the caveat lines — it is the report's
  content, not a caveat.
- Non-bearing popups are unchanged.

## 3. Settings declination line (FR-009/FR-010, SC-005)

The settings sheet gains a short section, computed at sheet-open from the device's current
position (or the hand-placed position — the same position a report would use), fully offline:

```
Magnetic north is about 15° east of true north here.
Bearings on the map are true north; a handheld compass reads magnetic.
```

- "east" when declination > 0, "west" when < 0; `|d| < 0.5°` → "Magnetic and true north line up
  here." with no second line change.
- Model vintage appears here and only here, plainly: appended "Using the 2025 magnetic model." —
  derived from `wmm_epoch`-style model name, no "WMM" on screen (FR-012).
- Stale model (FR-009): append "That model is out of date, so this could be off by a fraction of
  a degree." — stated, not alarming, never hidden.
- No position available (no fix, nothing placed): the section says "Set where you are to see the
  local difference between true and magnetic north." rather than disappearing — an absent section
  is a mystery, an explained absence is not.
- The word "declination" MAY appear here only if immediately defined by the sentence around it;
  the default copy above avoids it entirely.

## 4. Vocabulary boundary (FR-012, Principle V)

Allowed on participant surfaces: "true north", "magnetic", "magnetic compass", "the 2025 magnetic
model". Not allowed: "declination" (except §3's guarded case), "WMM", epoch identifiers, "NRQ",
"DFS", "PHG", "geomagnetic". Test: a vocabulary unit test extends the existing `vocabulary.test.ts`
deny-list with the new strings.

## 5. Honesty constraints (Principle I)

- Labels state frames; they must not add precision. Whole-degree rounding on non-entry surfaces
  (R9).
- Wedge geometry, confidence wording, range wording, and every existing uncertainty surface are
  byte-identical after this feature. A diff that touches them is out of contract.
