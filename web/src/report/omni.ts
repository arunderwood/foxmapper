/**
 * Signal-strength entry — the report a hunter with a stock antenna and no training can file.
 *
 * This is Principle II in one file: it needs no directional antenna, and it is evidence in the
 * same log, rendered on the same map, entered from the same surface as a bearing.
 */
import type { OmniReport, StrengthS } from '../log/types.js';
import { envelope, type AuthorContext } from './author.js';

/**
 * Three buckets, at the meaningful midpoints of the operators' own scale (DF.TXT), in their words.
 *
 * Nine steps would imply a precision that an S-meter reading called from memory in the cold does
 * not have — it is a judgement, not a measurement.
 */
export const STRENGTH_CHOICES = [
  { s: 2 as StrengthS, label: 'Faint — I can tell it is there' },
  { s: 5 as StrengthS, label: 'Clear — some noise, easy to copy' },
  { s: 8 as StrengthS, label: 'Full quieting — loud and clean' },
] as const;

export interface OmniEntry extends AuthorContext {
  strength_s: StrengthS;
}

/** `s = 0` is not valid here. Nothing heard is a `null` report — a hunter does not think of
 *  silence as "strength zero", so the interface has a distinct affordance for it. */
export function composeOmni(entry: OmniEntry): OmniReport {
  return {
    ...envelope(entry),
    kind: 'omni',
    payload: { strength_s: entry.strength_s },
  };
}
