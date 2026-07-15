/**
 * "I hear nothing here."
 *
 * **Negative evidence, and it is first-class.** On the air this is the high-volume report, because
 * far more stations fail to hear a transmitter than hear it — and it is what eliminates territory.
 * The format it maps to (`DFS` with `s = 0`) was built for exactly this in the 1990s.
 *
 * The module is `heard_nothing.ts` because `null` is a reserved word in JS. **The wire value stays
 * the string `"null"`.** Nobody fixes it.
 */
import type { NullReport } from '../log/types.js';
import { envelope, type AuthorContext } from './author.js';

export const LABEL = 'I hear nothing here';

/** Kind + position + time is the whole claim. The payload is empty and that is complete. */
export function composeHeardNothing(entry: AuthorContext): NullReport {
  return { ...envelope(entry), kind: 'null', payload: {} };
}
