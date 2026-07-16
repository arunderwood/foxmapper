/**
 * The log is a grow-only set of immutable reports keyed by a random UUID.
 *
 * This file is the whole CRDT. A G-Set *is* the trivial CRDT, which is why no library is used —
 * and why one would be actively wrong here: a library's binary wire format would violate
 * Principle IV's "the log format MUST be documented and reimplementable by a third party".
 */
import type { Log, Report } from './types.js';

export function toLog(reports: Iterable<Report>): Log {
  const log = new Map<string, Report>();
  for (const report of reports) if (!log.has(report.id)) log.set(report.id, report);
  return log;
}

/**
 * merge(A, B) = A ∪ B, keyed by id. That is the entire algorithm.
 *
 * A duplicate id is the same report — take either; they are byte-identical by construction,
 * because nothing ever edits a report. Never merge by timestamp, and never implement
 * last-write-wins: there is no register to overwrite, and introducing one would make the phone
 * with the fastest clock the arbiter of truth.
 */
export function merge(a: Log, b: Log): Log {
  const merged = new Map<string, Report>(a);
  for (const [id, report] of b) if (!merged.has(id)) merged.set(id, report);
  return merged;
}

export function mergeAll(logs: Iterable<Log>): Log {
  let acc: Log = new Map<string, Report>();
  for (const log of logs) acc = merge(acc, log);
  return acc;
}

/** Add one report. Adding a known id is a no-op, which is what makes retry-forever safe. */
export function add(log: Log, report: Report): Log {
  if (log.has(report.id)) return log;
  return new Map(log).set(report.id, report);
}
