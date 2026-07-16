/**
 * Retraction.
 *
 * A correction is not an edit — it is a new fact naming another report's id. That is what keeps
 * merge trivial: the log stays a G-Set rather than becoming a 2P-Set, so no conflict can arise and
 * no participant is ever asked to resolve one.
 */
import type { Report, RetractionReport } from '../log/types.js';
import { envelope, type AuthorContext } from './author.js';

export const RETRACT_LABEL = 'Take that back';

/**
 * Appends a retraction. It removes nothing: the retracted report stays in the log forever, and any
 * correct implementation can still see it.
 */
export function composeRetraction(context: AuthorContext, retractsId: string): RetractionReport {
  return { ...envelope(context), kind: 'retraction', payload: { retracts_id: retractsId } };
}

/**
 * Retractable by whoever **entered** it, not by the observer — including a relayed report, whose
 * observer has no device in the hunt and could not retract it if they wanted to.
 *
 * This is not enforced server-side and cannot be: anyone with the code can append anything. It is
 * what the interface offers, not a permission.
 */
export function canRetract(report: Report, participantId: string): boolean {
  return report.kind !== 'retraction' && report.entered_by.participant_id === participantId;
}
