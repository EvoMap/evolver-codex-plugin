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

test('the eight dsh commands are commands when a prompt is exactly one, with or without a leading slash', () => {
  for (const name of ['status', 'search', 'distill', 'evolve', 'sync', 'review', 'run', 'solidify']) {
    assert.equal(promptCommandOf(`evolver-${name}`)?.name, `evolver-${name}`);
  }
  assert.deepEqual(promptCommandOf('  /evolver-status \n'), { name: 'evolver-status', args: [] });
  assert.deepEqual(promptCommandOf('evolver-search flaky redis test'), { name: 'evolver-search', args: ['flaky', 'redis', 'test'] });
  assert.deepEqual(promptCommandOf('evolver-run --dry-run'), { name: 'evolver-run', args: ['--dry-run'] });
  assert.equal(promptCommandOf('evolver-status 怎么看'), null, 'text after a command without arguments is a question');
  assert.equal(promptCommandOf('what does evolver-status show?'), null);
  assert.equal(promptCommandOf('evolver-statusx'), null);
  assert.equal(promptCommandOf('evolver-unknown'), null);
});

const deps = (overrides = {}) => ({
  sessionId: 's1',
  status: async () => 'Evolver Codex plugin status',
  search: async (text) => ({ ok: true, data: { text } }),
  startDistill: () => assert.fail('nothing to distill'),
  runCli: () => assert.fail('no engine command'),
  ...overrides,
});

test('status and search are answered to the person; search without text says how to use it', async () => {
  assert.deepEqual(await answerPromptCommand(promptCommandOf('evolver-status'), deps()), { blockReason: 'Evolver Codex plugin status' });
  assert.match((await answerPromptCommand(promptCommandOf('evolver-search flaky test'), deps())).blockReason, /"text": "flaky test"/);
  assert.match((await answerPromptCommand(promptCommandOf('evolver-search'), deps())).blockReason, /^Usage: evolver-search/);
});

test("distill starts this session's candidate in the background with the focus, or says there is none", async () => {
  restoreHome = freshHome();
  assert.match((await answerPromptCommand(promptCommandOf('evolver-distill'), deps())).blockReason, /Nothing to distill yet/);

  rememberCandidate('s1', candidateOf({ prompt: 'add a retry', record: { checks: [], commands: ['npm test'], paths: [], edits: [], answer: 'Done.' }, model: { model: 'gpt-test' }, turn: 1 }));
  const started = [];
  const { blockReason } = await answerPromptCommand(promptCommandOf('evolver-distill the backoff'), deps({ startDistill: (...args) => started.push(args) }));
  assert.match(blockReason, /in the background; evolver-status shows how it ended/);
  assert.deepEqual(started, [['s1', 'the backoff']]);
});

test('the engine commands go to the CLI with their arguments and answer with its output', async () => {
  const ran = [];
  const runCli = async (args) => {
    ran.push(args);
    return { kind: 'success', text: 'synced 3 assets' };
  };
  assert.deepEqual(await answerPromptCommand(promptCommandOf('evolver-sync --dry-run'), deps({ runCli })), { blockReason: 'synced 3 assets' });
  assert.deepEqual(ran, [['sync', '--dry-run']]);
});

test('evolve is the one command for the model: its instruction, with the focus, becomes the turn context', async () => {
  const { context, blockReason } = await answerPromptCommand(promptCommandOf('evolver-evolve the retry'), deps());
  assert.equal(blockReason, undefined);
  assert.match(context, /^Take a deliberate evolution step for the current task\./);
  assert.match(context, /`evolver-distill` distills it now/);
  assert.match(context, /\n\nFocus: the retry$/);
});
