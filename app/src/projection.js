/**
 * The projection is the only thing a workflow *condition* can read.
 *
 * A condition is evaluated by Jira from the work item — it cannot call Relay.
 * So the closure decision has to be materialised onto the issue before anyone
 * tries to close it, and the materialised copy must carry enough information
 * for a reader to notice it is stale.
 */

export const PROJECTION_KEY = 'relay.closure';
export const OPEN_FIELD_PROPERTY = 'relay.openCommitments';

/**
 * The projection carries the management state as well as the count.
 *
 * The workflow condition reads this object — `issue.properties['relay.closure']`
 * — so `state` has to be materialised here, not looked up later: a condition
 * that cannot see a state must withhold, and "withheld because the property has
 * no state" is indistinguishable from "withheld because Relay is initialising".
 * Both are refusals, which is the safe direction, but only the second one is
 * true. Writing the state is what makes the first one stop happening.
 *
 * `state: null` when the ledger is missing is deliberate: null is not
 * `"unmanaged"`, so it refuses.
 */
export function buildProjection(ledger, counts, now = new Date().toISOString()) {
  return {
    ledgerRev: ledger?.rev ?? -1,
    ledgerUpdatedAt: ledger?.updatedAt ?? null,
    state: ledger?.state ?? null,
    open: counts.open,
    overdue: counts.overdue,
    unowned: counts.unowned,
    awaitingReview: counts.awaitingReview,
    updatedAt: now,
  };
}

/**
 * A projection is stale when the ledger has moved on without it, or when it is
 * too old to be trusted. Staleness never permits a closure — see gate.js.
 */
export function isStale(projection, ledger, { nowMs = Date.now(), maxAgeMs = 5 * 60 * 1000 } = {}) {
  if (!projection) return { stale: true, reason: 'missing' };
  // A guard is the placeholder Relay writes *before* it commits the ledger, so
  // the condition can never read zero while work is about to be saved. It is
  // conservative, not reconciled: it must be replaced by a real projection.
  if (projection.guard) return { stale: true, reason: 'guard' };
  if (!ledger) return { stale: true, reason: 'ledger_missing' };
  if (projection.ledgerRev !== ledger.rev) return { stale: true, reason: 'rev_mismatch' };
  const age = nowMs - new Date(projection.updatedAt).getTime();
  if (!Number.isFinite(age) || age > maxAgeMs) return { stale: true, reason: 'expired' };
  return { stale: false, reason: null };
}

/**
 * The P2.1 condition expression, kept only because a test still pins it.
 *
 * Superseded by `closureExpression()` in field.js. The comment that used to sit
 * here — that entity properties were not "something we have proven" — is no
 * longer true: `issue.properties['relay.closure']` was evaluated against a live
 * site and returns the object, with a missing key reading as absent rather than
 * raising. That is why the condition no longer has to name a site-specific
 * field id, and why this builder is dead weight rather than a fallback.
 */
export function conditionExpression(fieldId = 'customfield_relay_open') {
  return `issue.${fieldId} == 0`;
}
