import { UNKNOWN } from './applied.mjs';
import { checkEvidenceOf } from './checks.mjs';
import { REJECTED, RETRY, SENT, isSettled, withAttempt } from './report-outbox.mjs';
import { outcomeOfReason } from './turn-outcomes.mjs';

const LABEL_OUTCOMES = { correction: 'failed', praise: 'success' };
const RETENTION_OUTCOMES = { kept: 'success', reverted: 'failed' };
const RECEIPT_FIELDS = ['eligible', 'counted', 'weight', 'reason'];

function turnTaskId(sessionId, turn) {
  return `codex:${sessionId || 'unknown'}:${turn ?? 'unknown'}`;
}

// The Hub has no `unknown`, and `unused` carries a soft negative there; a
// partial reuse at tier none weighs nothing either way.
const UNKNOWN_APPLIED_AS = 'partial';

function immediateEvidenceOf({ checks, applied, reasonKind }) {
  const check = checkEvidenceOf(checks);
  const isKnown = applied !== UNKNOWN;
  return {
    tier: check && isKnown ? 'L1' : 'none',
    applied: isKnown ? applied : UNKNOWN_APPLIED_AS,
    ...(check && { check }),
    aborted: reasonKind === 'aborted',
    stage: 'immediate',
  };
}

function immediateOutcomeOf(evidence, reasonKind) {
  if (evidence.check) return evidence.check.passed ? 'success' : 'failed';
  return outcomeOfReason(reasonKind) ?? 'failed';
}

function checkPhrase(check) {
  if (!check) return 'no check ran';
  const result = check.passed ? 'passed' : 'failed';
  return `last ${check.kind} ${result}${check.fail_then_pass ? ' after failing earlier' : ''}`;
}

function reportOf({ assetId, taskId, outcome, reason, evidence }) {
  return { asset_id: assetId, outcome, task_id: taskId, reason, evidence };
}

export function immediateReportOf({ asset, sessionId, turn, reasonKind, checks, applied }) {
  const evidence = immediateEvidenceOf({ checks, applied, reasonKind });
  return reportOf({
    assetId: asset.assetId,
    taskId: turnTaskId(sessionId, turn),
    outcome: immediateOutcomeOf(evidence, reasonKind),
    reason: `Injected by Evolver into Codex turn ${turn}; applied: ${applied}; ${checkPhrase(evidence.check)}.`,
    evidence,
  });
}

export function reportedReuseOf(report) {
  return { assetId: report.asset_id, applied: report.evidence.applied, taskId: report.task_id };
}

export function correctionReportOf(reuse, label) {
  if (!LABEL_OUTCOMES[label]) return null;
  return reportOf({
    ...reuse,
    taskId: `${reuse.taskId}:correction`,
    outcome: LABEL_OUTCOMES[label],
    reason: `The person's next prompt read as ${label} of the turn that reused this strategy.`,
    evidence: { tier: 'L3', applied: reuse.applied, stage: 'correction' },
  });
}

export function retentionReportOf(reuse, retentionClass) {
  if (!RETENTION_OUTCOMES[retentionClass]) return null;
  return reportOf({
    ...reuse,
    taskId: `${reuse.taskId}:retention`,
    outcome: RETENTION_OUTCOMES[retentionClass],
    reason: `By the next session the files the turn edited were ${retentionClass}.`,
    evidence: { tier: 'L2', applied: reuse.applied, stage: 'retention' },
  });
}

// A Proxy older than `terminal` says `hub 400` or `hub 422` for a request the
// Hub refused as invalid. `hub 404` stays retryable: the Hub may not serve the
// route yet.
const REJECTED_BY_HUB = /^hub (?:400|422)\b/;

function isRejection(data) {
  return data?.terminal === true || REJECTED_BY_HUB.test(String(data?.reason ?? ''));
}

function isTaken(data) {
  return data?.recorded !== false || data?.reason === 'duplicate_report';
}

function receiptOf(data) {
  return Object.fromEntries(RECEIPT_FIELDS.filter((field) => data?.[field] !== undefined).map((field) => [field, data[field]]));
}

export function deliveryOf(result) {
  if (result?.ok !== true) return { verdict: RETRY };
  if (isRejection(result.data)) return { verdict: REJECTED, reason: String(result.data.reason ?? 'rejected'), status: result.data.status };
  if (!isTaken(result.data)) return { verdict: RETRY };
  return { verdict: SENT, receipt: receiptOf(result.data) };
}

async function postToHub(proxyFetch, report) {
  try {
    return deliveryOf(await proxyFetch('POST', '/asset/reuse-result', report));
  } catch {
    return { verdict: RETRY };
  }
}

function isLocalRecordDue({ report, localAt }, delivery) {
  return !localAt && delivery.verdict !== REJECTED && report.evidence.tier !== 'none';
}

async function recordedLocally(recordLocally, { report, sessionId }) {
  return recordLocally({ assetId: report.asset_id, outcome: report.outcome, sessionId }).catch(() => false);
}

async function attemptOf(ledgers, entry) {
  const delivery = await postToHub(ledgers.proxyFetch, entry.report);
  const isLocal = isLocalRecordDue(entry, delivery) && (await recordedLocally(ledgers.recordLocally, entry));
  return { ...delivery, isLocal };
}

export async function deliverPending(ledgers, outbox, now) {
  let delivered = outbox;
  for (const [key, entry] of Object.entries(outbox)) {
    if (isSettled(entry)) continue;
    delivered = withAttempt(delivered, key, await attemptOf(ledgers, entry), now);
  }
  return delivered;
}
