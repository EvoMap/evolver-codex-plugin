import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { answerPromptCommand, promptCommandOf } from '../lib/prompt-commands.mjs';
import { candidateOf, rememberCandidate } from '../lib/session-distill.mjs';
import { freshHome } from './helpers/sandbox.mjs';

let restoreHome = null;

afterEach(() => {
  restoreHome?.();
  restoreHome = null;
});

test('only a prompt that is exactly a command is one, with or without a leading slash', () => {
  assert.deepEqual(promptCommandOf('evolver-status'), { name: 'evolver-status', args: [] });
  assert.deepEqual(promptCommandOf('  /evolver-status \n'), { name: 'evolver-status', args: [] });
  assert.deepEqual(promptCommandOf('evolver-search flaky redis test'), { name: 'evolver-search', args: ['flaky', 'redis', 'test'] });
  assert.deepEqual(promptCommandOf('evolver-distill the backoff'), { name: 'evolver-distill', args: ['the', 'backoff'] });
  assert.equal(promptCommandOf('evolver-status 怎么看'), null, 'text after a command without arguments is a question');
  assert.equal(promptCommandOf('what does evolver-status show?'), null);
  assert.equal(promptCommandOf('evolver-sync'), null, 'the long-running commands stay in the terminal');
  assert.equal(promptCommandOf('evolver-statusx'), null);
});

const deps = (overrides = {}) => ({
  sessionId: 's1',
  status: async () => 'Evolver Codex plugin status',
  search: async (text) => ({ ok: true, data: { text } }),
  startDistill: () => assert.fail('nothing to distill'),
  ...overrides,
});

test('status and search answer from the Proxy; search without text says how to use it', async () => {
  assert.equal(await answerPromptCommand(promptCommandOf('evolver-status'), deps()), 'Evolver Codex plugin status');
  assert.match(await answerPromptCommand(promptCommandOf('evolver-search flaky test'), deps()), /"text": "flaky test"/);
  assert.match(await answerPromptCommand(promptCommandOf('evolver-search'), deps()), /^Usage: evolver-search/);
});

test("distill starts this session's candidate in the background with the focus, or says there is none", async () => {
  restoreHome = freshHome();
  assert.match(await answerPromptCommand(promptCommandOf('evolver-distill'), deps()), /Nothing to distill yet/);

  rememberCandidate('s1', candidateOf({ prompt: 'add a retry', record: { checks: [], commands: ['npm test'], paths: [], edits: [], answer: 'Done.' }, model: { model: 'gpt-test' }, turn: 1 }));
  const started = [];
  const answer = await answerPromptCommand(promptCommandOf('evolver-distill the backoff'), deps({ startDistill: (...args) => started.push(args) }));
  assert.match(answer, /in the background; evolver-status shows how it ended/);
  assert.deepEqual(started, [['s1', 'the backoff']]);
});
