#!/usr/bin/env node
import { DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { closeOpenTurn, updateSession } from '../lib/session-state.mjs';
import { closeTurn } from '../lib/turn-end.mjs';

runHook('Interrupt', (input) => {
  const sessionId = sessionIdOf(input);
  const session = sessionId ? closeOpenTurn(sessionId, input.turn_id) : null;
  if (!session) return '';
  const { reuses, queued } = closeTurn({ sessionId, session, reasonKind: 'aborted', answer: '', model: null, projectDir: projectDirOf(input) });
  updateSession(sessionId, (state) => ({ ...state, labelable: reuses }));
  if (queued) startInBackground([DRAIN_TASK]);
  return '';
});
