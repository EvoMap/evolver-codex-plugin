import { readState, statePath, updateState } from './state-file.mjs';

const recallLogPath = () => statePath('codex-recall-log.json');

export function recordRecall(outcome, now = Date.now()) {
  updateState(recallLogPath(), {}, (log) => ({
    last: { ...outcome, at: new Date(now).toISOString() },
    counts: { ...log.counts, [outcome.status]: (log.counts?.[outcome.status] ?? 0) + 1 },
  }));
}

export function readRecallLog() {
  return readState(recallLogPath(), {});
}
