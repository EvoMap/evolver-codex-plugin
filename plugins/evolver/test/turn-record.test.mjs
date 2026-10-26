import assert from 'node:assert/strict';
import { test } from 'node:test';

import { patchApplied, patchedPaths } from '../lib/apply-patch.mjs';
import { noteOf, turnRecordOf } from '../lib/turn-record.mjs';

const PATCH = [
  '*** Begin Patch',
  '*** Add File: src/lru.js',
  '+export const cache = new Map();',
  '*** Update File: src/old.js',
  '*** Move to: src/new.js',
  '@@',
  '-const a = 1;',
  '+const a = 2;',
  '*** Delete File: src/gone.js',
  '*** End Patch',
].join('\n');

test('a patch names every file it touches, and says whether it applied', () => {
  assert.deepEqual(patchedPaths(PATCH), ['src/lru.js', 'src/old.js', 'src/new.js', 'src/gone.js']);
  assert.equal(patchApplied('Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:'), true);
  assert.equal(patchApplied('Exit code: 1\nOutput:\napply_patch verification failed'), false);
});

test('a turn record keeps commands, checks with their verdict, touched paths and the files applied patches edited', () => {
  const record = turnRecordOf([
    { kind: 'before', path: '/p/src/lru.js', hash: 'absent' },
    noteOf({ tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_response: 'lru.js' }),
    noteOf({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: 'AssertionError: expected 1 to equal 2' }),
    noteOf({ tool_name: 'apply_patch', tool_input: { command: PATCH }, tool_response: 'Exit code: 0\nSuccess.' }),
    noteOf({ tool_name: 'apply_patch', tool_input: { command: PATCH }, tool_response: 'Exit code: 1\nOutput:\nfailed' }),
    noteOf({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: 'ℹ pass 3\nℹ fail 0' }),
    { kind: 'before', path: '/p/src/lru.js', hash: 'later' },
  ]);
  assert.deepEqual(record.commands, ['ls src', 'npm test', 'npm test']);
  assert.deepEqual(record.checks, [{ command: 'npm test', failed: true }, { command: 'npm test', failed: false }]);
  assert.deepEqual(record.edits, ['src/lru.js', 'src/old.js', 'src/new.js', 'src/gone.js']);
  assert.equal(record.changedLines, 3, 'only the applied patch counts its added and removed lines');
  assert.equal(record.paths.filter((file) => file === 'src/lru.js').length, 2);
  assert.deepEqual([...record.editedBefore], [['/p/src/lru.js', 'absent']]);
  assert.equal(record.answer, '');
});

test('a patch applied through the shell counts as an edit, beside the command and the check it ran with', () => {
  const command = `apply_patch <<'PATCH'\n${PATCH}\nPATCH\nnode --test`;
  const record = turnRecordOf([noteOf({ tool_name: 'Bash', tool_input: { command }, tool_response: 'Success. Updated the following files:\nA src/lru.js\nℹ pass 1\nℹ fail 0' })]);
  assert.deepEqual(record.commands, [command]);
  assert.deepEqual(record.checks, [{ command: command.slice(0, 200), failed: false }]);
  assert.deepEqual(record.edits, ['src/lru.js', 'src/old.js', 'src/new.js', 'src/gone.js']);
  assert.ok(record.paths.includes('src/new.js'));
});

const RUNNING = 'Chunk ID: 4f2a1c\nWall time: 10.0021 seconds\nProcess running with session ID 7\nOriginal token count: 18\nOutput:\n▶ uploader\n  ✔ retries once (2.1ms)\n';
const FINISHED_FAILING = '  ✖ gives up after three tries (3.4ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\nℹ tests 40\nℹ pass 39\nℹ fail 1\n';
const FINISHED_EXITED = 'Chunk ID: 9b0e77\nWall time: 4.2010 seconds\nProcess exited with code 1\nOriginal token count: 9\nOutput:\nℹ tests 40\nℹ pass 40\n';
const bash = (output, callId = 'call_suite') => noteOf({ tool_name: 'Bash', tool_use_id: callId, tool_input: { command: 'npm test' }, tool_response: output });

test('a check still running at its wait limit is pending: it counts as not run until the turn sees it end', () => {
  const pending = turnRecordOf([bash(RUNNING)]);
  assert.deepEqual(pending.checks, []);
  assert.deepEqual(pending.commands, ['npm test']);
});

test('the completion Codex reports for the same call resolves the pending check, without a second command', () => {
  const failed = turnRecordOf([bash(RUNNING), bash(FINISHED_FAILING)]);
  assert.deepEqual(failed.checks, [{ command: 'npm test', failed: true }]);
  assert.deepEqual(failed.commands, ['npm test']);
  const exited = turnRecordOf([bash(RUNNING), noteOf({ tool_name: 'Bash', tool_use_id: 'other', tool_input: { command: 'npm test' }, tool_response: FINISHED_EXITED.replace('Process exited', 'Process running with session ID 7\nProcess exited') })]);
  assert.equal(exited.checks.length, 0, 'a later poll that is still running stays pending');
  assert.deepEqual(turnRecordOf([bash(RUNNING), bash(FINISHED_EXITED)]).checks, [{ command: 'npm test', failed: true }]);
});
