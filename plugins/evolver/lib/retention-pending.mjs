import crypto from 'node:crypto';
import fs from 'node:fs';

import { OUTBOX_TTL_MS } from './report-outbox.mjs';
import { ABSENT, retentionOf } from './retention.mjs';
import { retentionReportOf } from './reuse.mjs';
import { appendStateLine, statePath, takeStateLines } from './state-file.mjs';

const pendingPath = () => statePath('codex-retention-pending.jsonl');

export function contentHashOf(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return ABSENT;
  }
}

export function rememberForRetention({ sessionId, projectDir, reuses, editedBefore, now = Date.now() }) {
  if (reuses.length === 0 || editedBefore.size === 0) return;
  const files = [...editedBefore].map(([file, before]) => ({ path: file, before, after: contentHashOf(file) }));
  appendStateLine(pendingPath(), { sessionId, projectDir, reuses, files, atMs: now });
}

export function takeDueRetentions({ sessionId, projectDir, now = Date.now() }) {
  const { lines, commit } = takeStateLines(pendingPath(), now);
  const pending = lines.filter((entry) => now - entry.atMs <= OUTBOX_TTL_MS);
  const isDue = (entry) => entry.projectDir === projectDir && entry.sessionId !== sessionId;
  for (const entry of pending.filter((candidate) => !isDue(candidate))) appendStateLine(pendingPath(), entry);
  return { due: pending.filter(isDue), commit };
}

export function retentionReportsOf(entry) {
  const verdict = retentionOf(entry.files.map((file) => ({ ...file, now: contentHashOf(file.path) }))).class;
  return entry.reuses
    .map((reuse) => retentionReportOf(reuse, verdict))
    .filter((report) => report !== null)
    .map((report) => ({ report, sessionId: entry.sessionId }));
}
