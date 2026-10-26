import fs from 'node:fs';
import path from 'node:path';

import { OUTBOX_TTL_MS } from './report-outbox.mjs';
import { hashedName, readState, stateDir, statePath, updateState } from './state-file.mjs';

const SESSION_FILE = /^codex-(?:session|turn|injected)-[0-9a-f]{16}\.jsonl?$/;

const sessionPath = (sessionId) => statePath(hashedName('codex-session', sessionId));

const EMPTY_SESSION = { turn: 0, turnId: null, closed: true, prompt: '', labelable: [], stoppedRecord: null };

export function readSession(sessionId) {
  return { ...EMPTY_SESSION, ...readState(sessionPath(sessionId), {}) };
}

// A turn is open from its prompt until its Stop or Interrupt; Codex names it by turn_id, which an older
// state file or payload may lack.
function isOpenTurn(session, turnId) {
  return !session.closed && (!turnId || !session.turnId || turnId === session.turnId);
}

export function updateSession(sessionId, change) {
  return updateState(sessionPath(sessionId), {}, (state) => change({ ...EMPTY_SESSION, ...state }));
}

/** Marks the session's open turn closed and returns it as it was, or null when `turnId` is not open (any turn when omitted). */
export function closeOpenTurn(sessionId, turnId) {
  let opened = null;
  updateSession(sessionId, (session) => {
    if (!isOpenTurn(session, turnId)) return undefined;
    opened = session;
    return { ...session, closed: true };
  });
  return opened;
}

/**
 * Forgets what the ended session's turns left, but keeps its turn counter: a resumed thread keeps its
 * session_id, and a repeated `codex:<session>:<turn>` would be taken by the Hub as a duplicate report.
 * The file is pruned with the other session files once it is older than the outbox TTL.
 */
export function endSession(sessionId) {
  updateSession(sessionId, (session) => ({ ...EMPTY_SESSION, turn: session.turn }));
}

export function pruneOldSessions(now = Date.now()) {
  let names = [];
  try {
    names = fs.readdirSync(stateDir());
  } catch {
    return;
  }
  for (const name of names.filter((candidate) => SESSION_FILE.test(candidate))) {
    const file = path.join(stateDir(), name);
    try {
      if (now - fs.statSync(file).mtimeMs > OUTBOX_TTL_MS) fs.rmSync(file, { force: true });
    } catch {
    }
  }
}
