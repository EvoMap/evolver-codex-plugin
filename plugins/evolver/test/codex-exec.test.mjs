import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { answerOfEvents, codexExecArguments, codexModelRunner } from '../lib/codex-exec.mjs';
import { freshHome } from './helpers/sandbox.mjs';

const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));

test('codex exec runs headless on the session model with hooks, plugins and the shell turned off', () => {
  const args = codexExecArguments('gpt-test', '/tmp/x');
  assert.equal(args[0], 'exec');
  for (const flag of ['--ephemeral', '--json', '--skip-git-repo-check', '--ignore-rules']) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.deepEqual(args.filter((arg, index) => args[index - 1] === '--disable'), ['hooks', 'plugins', 'shell_tool', 'apps', 'multi_agent']);
  assert.deepEqual(args.slice(-5), ['-m', 'gpt-test', '-C', '/tmp/x', '-']);
});

test('the answer is the last agent message and the usage that of the turn', () => {
  const events = [
    { type: 'item.completed', item: { type: 'error', message: 'metadata' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'first' } },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"summary":"s"}' } },
    { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3, reasoning_output_tokens: 0 } },
  ].map((event) => JSON.stringify(event)).join('\n');
  assert.deepEqual(answerOfEvents(`${events}\nnot json`), {
    answer: '{"summary":"s"}',
    usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 0 },
  });
});

test('the runner sends the prompt on stdin and reads the answer off the events', async (t) => {
  t.after(freshHome());
  const { answer, usage } = await codexModelRunner({ executable: FAKE_CODEX })('gpt-test', 'the prompt', AbortSignal.timeout(5_000));
  assert.equal(JSON.parse(answer).title, 'Retry uploads');
  assert.equal(usage.outputTokens, 120);
});

test('a missing codex executable rejects with ENOENT', async () => {
  await assert.rejects(codexModelRunner({ executable: '/nonexistent/codex' })('m', 'p', AbortSignal.timeout(5_000)), { code: 'ENOENT' });
});
