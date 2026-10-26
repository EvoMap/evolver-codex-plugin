#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { forgetSession, takeUnreported } from '../lib/injected-assets.mjs';
import { hostProcess } from '../lib/process-owner.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { closeCandidate } from '../lib/session-distill.mjs';
import { closeOpenTurn, endSession } from '../lib/session-state.mjs';
import { abortedReports, closeTurn } from '../lib/turn-end.mjs';
import { forgetTurnRecord } from '../lib/turn-record.mjs';

// Codex interrupts a running turn (and runs Interrupt) before SessionEnd, so a turn still open here ended
// on an error; what is still unreported after it goes out as aborted.
function closeFailedTurn(sessionId, input) {
  const session = closeOpenTurn(sessionId);
  if (session) closeTurn({ sessionId, session, reasonKind: 'error', answer: '', model: null, projectDir: projectDirOf(input) });
}

// SessionEnd gets three seconds at most, so it only settles state on disk; the closed candidate is distilled
// by the detached worker it starts, or claimed by the next session start if that worker fails.
runHook('SessionEnd', (input) => {
  const sessionId = sessionIdOf(input);
  if (!sessionId) return '';
  closeFailedTurn(sessionId, input);
  queueReports(abortedReports(takeUnreported(sessionId, Infinity)));
  closeCandidate(sessionId);
  forgetTurnRecord(sessionId);
  endSession(sessionId);
  forgetSession(sessionId);
  startInBackground([DRAIN_TASK, DISTILL_TASK], { codexExecutable: hostProcess()?.executable });
  return '';
});
