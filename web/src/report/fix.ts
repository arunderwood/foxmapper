/**
 * "I found it, here, then."
 *
 * The one kind with **no on-air format**. APRS101 (including the full symbol and DTI tables),
 * DF.TXT, omnidf.txt and the 1.1 and 1.2 addenda contain no convention for "transmitter found".
 * Principle V requires an existing format *where one exists*; none does, so this defines minimal
 * new semantics and says so rather than bending an unrelated format to fit.
 */
import type { FixReport } from '../log/types.js';
import { envelope, type AuthorContext } from './author.js';

export const LABEL = 'Found it';

/**
 * Makes `found` true by fold. It does **not** close the hunt, does not stop reports, and does not
 * win against a second `fix` — two conflicting finds both stand, and the system does not
 * adjudicate.
 */
export function composeFix(entry: AuthorContext): FixReport {
  return { ...envelope(entry), kind: 'fix', payload: {} };
}
