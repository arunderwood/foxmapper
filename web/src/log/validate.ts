/**
 * The reader's half of the format contract: docs/schema/report.v1.schema.json, compiled at build
 * time by scripts/generate-validator.mjs.
 *
 * A report body is whatever any holder of the hunt code chose to post — the relay never reads it.
 * Every field the fold and the map dereference is therefore checked here first, because one body
 * that throws inside the fold blanks the map for every participant who holds it.
 */
import validate from './report-validator.gen.js';
import type { Report } from './types.js';

export function isReport(entry: unknown): entry is Report {
  return validate(entry);
}
