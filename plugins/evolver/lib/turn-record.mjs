import path from 'node:path';

import { patchApplied, patchedContent, patchedPaths, patchOf } from './apply-patch.mjs';
import { contentHashOf } from './retention-pending.mjs';
import { appendStateLine, hashedName, removeState, statePath, takeStateLines } from './state-file.mjs';
import { isVerificationCommand, runningSessionOf, shellCheckFailed } from './verification.mjs';

export const SHELL_TOOL = 'Bash';
export const PATCH_TOOL = 'apply_patch';

const TURN_EDITED_MAX_CHARS = 200_000;
const CHECK_COMMAND_MAX_CHARS = 200;
const PATH_KEYS = ['path', 'file_path'];

const recordPath = (sessionId) => statePath(hashedName('codex-turn', sessionId, 'jsonl'));

function freshTurnRecord() {
  return { checks: [], commands: [], paths: [], edits: [], editedBefore: new Map(), answer: '' };
}

export function noteFilesBeforePatch(sessionId, cwd, { tool_name: name, tool_input: input }) {
  for (const edited of patchedPaths(patchOf(name, input?.command))) {
    const file = path.resolve(cwd, edited);
    appendStateLine(recordPath(sessionId), { kind: 'before', path: file, hash: contentHashOf(file) });
  }
}

function patchFields(patch, response) {
  if (!patch) return {};
  return { paths: patchedPaths(patch), content: patchApplied(response) ? patchedContent(patch) : '' };
}

// A command still running at its wait limit has no verdict yet. Codex reports its completion later as another
// Bash PostToolUse for the same call (from the `write_stdin` poll that saw it exit), which resolves it; a check
// still pending when the turn ends counts as not run.
function shellNote(command, output, callId) {
  const patched = patchFields(patchOf(SHELL_TOOL, command), output);
  const base = { kind: 'command', command, callId, ...patched };
  const execSession = runningSessionOf(output);
  if (execSession !== null) return { ...base, pending: true, execSession };
  if (!isVerificationCommand(command)) return base;
  return { ...base, check: { command: command.slice(0, CHECK_COMMAND_MAX_CHARS), failed: shellCheckFailed(output) } };
}

function patchNote(patch, response) {
  return { kind: 'patch', paths: [], ...patchFields(patch, response) };
}

function otherToolNote(input) {
  return {
    kind: 'tool',
    ...(typeof input?.command === 'string' && { command: input.command }),
    paths: PATH_KEYS.map((key) => input?.[key]).filter((value) => typeof value === 'string'),
  };
}

export function noteOf({ tool_name: name, tool_input: input, tool_response: response, tool_use_id: callId }) {
  if (name === SHELL_TOOL && typeof input?.command === 'string') return shellNote(input.command, response, callId);
  if (name === PATCH_TOOL) return patchNote(patchOf(PATCH_TOOL, input?.command), response);
  return otherToolNote(input);
}

export function noteToolResult(sessionId, toolUse) {
  appendStateLine(recordPath(sessionId), noteOf(toolUse));
}

function resolvesPending(pending, note) {
  return pending.some((earlier) => (note.callId && earlier.callId === note.callId) || (note.execSession !== undefined && earlier.execSession === note.execSession));
}

function addNote(record, note, pending) {
  if (note.kind === 'before') {
    if (!record.editedBefore.has(note.path)) record.editedBefore.set(note.path, note.hash);
    return;
  }
  const isCompletion = resolvesPending(pending, note);
  if (note.pending) pending.push(note);
  if (typeof note.command === 'string' && !isCompletion) record.commands.push(note.command);
  if (note.check) record.checks.push(note.check);
  record.paths.push(...(note.paths ?? []));
  const editedChars = record.edits.reduce((total, edit) => total + edit.length, 0);
  const kept = String(note.content ?? '').slice(0, TURN_EDITED_MAX_CHARS - editedChars);
  if (kept) record.edits.push(kept);
}

export function turnRecordOf(notes) {
  const record = freshTurnRecord();
  const pending = [];
  for (const note of notes) addNote(record, note, pending);
  return record;
}

/** What the turn did, as its tool hooks noted it; the notes leave the disk once taken. */
export function takeTurnRecord(sessionId) {
  const { lines, commit } = takeStateLines(recordPath(sessionId));
  commit();
  return turnRecordOf(lines);
}

export function forgetTurnRecord(sessionId) {
  removeState(recordPath(sessionId));
}
