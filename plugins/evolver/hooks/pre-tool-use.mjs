#!/usr/bin/env node
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { noteFilesBeforePatch } from '../lib/turn-record.mjs';

runHook('PreToolUse', (input) => {
  const sessionId = sessionIdOf(input);
  if (sessionId) noteFilesBeforePatch(sessionId, input.cwd || process.cwd(), input);
  return '';
});
