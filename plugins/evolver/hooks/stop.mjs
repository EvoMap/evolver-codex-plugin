#!/usr/bin/env node
import { DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { hostProcess } from '../lib/process-owner.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { modelOf } from '../lib/session-distill.mjs';
import { closeOpenTurn, readSession, updateSession } from '../lib/session-state.mjs';
import { closeTurn, continueTurn } from '../lib/turn-end.mjs';

const ownerPid = () => hostProcess()?.pid ?? null;

function endTurn(sessionId, session, input) {
  const { reuses, queued, record } = closeTurn({
    sessionId,
    session,
    reasonKind: 'completed',
    answer: input.last_assistant_message,
    model: modelOf(input),
    projectDir: projectDirOf(input),
    ownerPid,
  });
  updateSession(sessionId, (state) => ({ ...state, labelable: reuses, stoppedRecord: record }));
  if (queued) startInBackground([DRAIN_TASK]);
}

function isContinuationOf(session, input) {
  return input.stop_hook_active === true && session.closed && session.stoppedRecord && session.turnId === input.turn_id;
}

runHook('Stop', (input) => {
  const sessionId = sessionIdOf(input);
  if (!sessionId) return '';
  const opened = closeOpenTurn(sessionId, input.turn_id);
  if (opened) {
    endTurn(sessionId, opened, input);
    return '';
  }
  const session = readSession(sessionId);
  if (!isContinuationOf(session, input)) return '';
  const record = continueTurn({ sessionId, session, answer: input.last_assistant_message, model: modelOf(input), ownerPid });
  updateSession(sessionId, (state) => ({ ...state, stoppedRecord: record }));
  return '';
});
