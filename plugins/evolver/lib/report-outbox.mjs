export const OUTBOX_TTL_MS = 8 * 24 * 60 * 60 * 1000;

const keyOf = (report) => `${report.task_id}\0${report.asset_id}`;

function pruned(outbox, now) {
  return Object.fromEntries(Object.entries(outbox ?? {}).filter(([, entry]) => now - Number(entry?.queuedAt) <= OUTBOX_TTL_MS));
}

export function withQueued(outbox, queued, now) {
  const kept = pruned(outbox, now);
  for (const { report, sessionId } of queued) {
    kept[keyOf(report)] ??= { report, sessionId, queuedAt: now, attempts: 0 };
  }
  return kept;
}

export const SENT = 'sent';
export const REJECTED = 'rejected';
export const RETRY = 'retry';

export function isSettled(entry) {
  return Boolean(entry.sentAt || entry.rejectedAt);
}

function settlementOf({ verdict, reason, status, receipt }, now) {
  if (verdict === SENT) return { sentAt: now, ...(receipt && { receipt }) };
  if (verdict === REJECTED) return { rejectedAt: now, rejection: { reason, ...(status !== undefined && { status }) } };
  return {};
}

export function withAttempt(outbox, key, attempt, now) {
  const entry = outbox[key];
  if (!entry) return outbox;
  const local = attempt.isLocal ? { localAt: now } : {};
  return { ...outbox, [key]: { ...entry, attempts: entry.attempts + 1, ...local, ...settlementOf(attempt, now) } };
}
