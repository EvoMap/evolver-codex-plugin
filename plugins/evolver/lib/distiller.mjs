import {
  claimLeftoverCandidates, claimSessionCandidate, distillCandidate, dueCandidates, isCurrentCandidate, settleCandidate,
} from './session-distill.mjs';

export const DISTILL_TIMEOUT_MS = 120_000;
const CURRENT_POLL_MS = 1_000;

// The correction that drops a candidate arrives in another hook process, so a running distillation watches
// the candidate file and stops itself once its candidate is no longer the one on disk.
function cancelWhenReplaced(sessionId, candidate, pollMs) {
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (!isCurrentCandidate(sessionId, candidate)) controller.abort();
  }, pollMs);
  timer.unref();
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

export async function distillDue({ sessionId, candidate }, { proxyFetch, runModel, focus = '', timeoutMs = DISTILL_TIMEOUT_MS, pollMs = CURRENT_POLL_MS }) {
  const cancel = cancelWhenReplaced(sessionId, candidate, pollMs);
  try {
    const isCurrent = () => isCurrentCandidate(sessionId, candidate);
    const outcome = await distillCandidate({ proxyFetch, runModel, candidate, focus, timeoutMs, cancel: cancel.signal, isCurrent });
    settleCandidate(sessionId, candidate, { sent: outcome.status === 'sent' });
    return outcome;
  } finally {
    cancel.stop();
  }
}

/** Every leftover candidate this process could claim, one at a time. */
export async function distillLeftovers(deps) {
  const outcomes = [];
  for (const due of claimLeftoverCandidates()) outcomes.push({ sessionId: due.sessionId, ...(await distillDue(due, deps)) });
  return outcomes;
}

/** One session's candidate now; `running` when another live process is already distilling it. */
export async function distillSession(sessionId, deps) {
  const [claimed] = claimSessionCandidate(sessionId);
  if (claimed) return distillDue(claimed, deps);
  return dueCandidates({ sessionId }).length > 0 ? { status: 'running' } : { status: 'nothing' };
}
