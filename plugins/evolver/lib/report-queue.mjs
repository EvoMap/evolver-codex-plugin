import { withQueued } from './report-outbox.mjs';
import { deliverPending } from './reuse.mjs';
import { appendStateLine, readState, statePath, takeStateLines, withLock, writeState } from './state-file.mjs';

const MAX_DRAIN_ROUNDS = 5;

export const outboxPath = () => statePath('codex-reports-outbox.json');
const queuePath = () => statePath('codex-reports-queue.jsonl');

export function queueReports(queued) {
  for (const entry of queued) appendStateLine(queuePath(), entry);
}

function attemptedEntries(before, after) {
  return Object.fromEntries(Object.entries(after).filter(([key, entry]) => before[key] !== entry));
}

// Hooks only append to the queue file; the one worker holding the outbox lock
// owns the outbox, and only the attempted entries are merged back, so a slow
// drain never rolls the file back.
export function drainOutbox(ledgers, clock = () => Date.now()) {
  return withLock('codex-outbox', async () => {
    const attempted = new Set();
    for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
      const { lines: queued, commit } = takeStateLines(queuePath());
      const now = clock();
      const outbox = withQueued(readState(outboxPath(), {}), queued, now);
      writeState(outboxPath(), outbox);
      commit();
      const due = Object.fromEntries(Object.entries(outbox).filter(([key]) => !attempted.has(key)));
      for (const key of Object.keys(due)) attempted.add(key);
      const delivered = await deliverPending(ledgers, due, now);
      writeState(outboxPath(), { ...readState(outboxPath(), {}), ...attemptedEntries(due, delivered) });
      if (queued.length === 0) return;
    }
  });
}
