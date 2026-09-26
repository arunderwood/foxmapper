/**
 * Every word a participant reads about the estimate (contracts/display-surfaces.md §1–§4).
 *
 * Hunter language only (FR-016): "probably", "about 9 in 10", "shading", "reports". The statistics
 * behind them stay out of sight, and `tests/unit/vocabulary.test.ts` fails any that leaks in (SC-007).
 * Nothing here suggests the estimate is fit for life-safety search (FR-027).
 */
import type { WarningKind } from './types.js';

export const ESTIMATE_SWITCH_LABEL = 'Show where the fox probably is';

export const ESTIMATE_SWITCH_NOTE =
  'Shades the ground the reports point to. Leave it off to read the reports yourself.';

/** Drawn along the region's edge, never at a point inside it (FR-002, FR-003). */
export const REGION_LABEL = 'fox probably inside · about 9 in 10';

export const WARNING_TEXT: Readonly<Record<WarningKind, string>> = {
  too_few: 'Too few reports to trust the shading yet',
  narrow_spread: 'Reports all point the same way — distance unknown',
  disagree: 'The reports disagree',
};

/** A state, not a caution: nothing has heard the fox yet (FR-015). */
export const NOTHING_YET_TEXT = 'Nothing points at the fox yet';

/** The tour's pointer to the switch, shown while the estimate is off. */
export const TOUR_SETTINGS_LINE = `Turn it on in Settings: ${ESTIMATE_SWITCH_LABEL}.`;
