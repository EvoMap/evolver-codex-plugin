import { readState, statePath, updateState } from './state-file.mjs';

const distillLogPath = () => statePath('codex-distill-log.json');

/** A distillation runs in a background process, so its outcome is kept for `evolver-status` to show. */
export function recordDistill(sessionId, { status, error }, now = Date.now()) {
  updateState(distillLogPath(), {}, (log) => ({
    last: { sessionId, status, ...(error && { error: String(error).slice(0, 300) }), at: new Date(now).toISOString() },
    counts: { ...log.counts, [status]: (log.counts?.[status] ?? 0) + 1 },
  }));
}

export function readDistillLog() {
  return readState(distillLogPath(), {});
}
