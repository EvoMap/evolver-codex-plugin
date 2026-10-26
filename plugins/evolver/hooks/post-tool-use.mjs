#!/usr/bin/env node
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { readSession } from '../lib/session-state.mjs';
import { noteToolResult } from '../lib/turn-record.mjs';

// A turn closed by its Stop still records under its own turn_id, for the continuation a blocking Stop hook starts.
function isRecording(session, turnId) {
  return !session.closed || (Boolean(turnId) && session.turnId === turnId);
}

runHook('PostToolUse', (input) => {
  const sessionId = sessionIdOf(input);
  if (sessionId && isRecording(readSession(sessionId), input.turn_id)) noteToolResult(sessionId, input);
  return '';
});
