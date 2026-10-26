import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { answerOfEvents, codexExecArguments, codexModelRunner, enabledMcpServersOf, spawnPlanOf } from '../lib/codex-exec.mjs';
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

test("the person's own MCP servers are turned off by name for the distillation", () => {
  const args = codexExecArguments('gpt-test', '/tmp/x', { mcpServers: ['node_repl', 'docs'] });
  assert.deepEqual(args.filter((arg, index) => args[index - 1] === '-c' && arg.startsWith('mcp_servers.')), [
    'mcp_servers.node_repl.enabled=false', 'mcp_servers.docs.enabled=false',
  ]);
  assert.deepEqual(args.slice(-5), ['-m', 'gpt-test', '-C', '/tmp/x', '-']);
});

test('only enabled MCP servers with a plain name are taken from the listing; an unreadable listing is no list', () => {
  const listing = JSON.stringify([
    { name: 'node_repl', enabled: true }, { name: 'codex_app', enabled: false }, { name: 'bad name"]', enabled: true },
  ]);
  assert.deepEqual(enabledMcpServersOf(listing), ['node_repl']);
  assert.deepEqual(enabledMcpServersOf('[]'), []);
  assert.equal(enabledMcpServersOf('Error: failed to load'), null);
  assert.equal(enabledMcpServersOf('{}'), null);
});

test('the runner turns off the MCP servers Codex lists under the same flags', async (t) => {
  t.after(freshHome());
  await codexModelRunner({ executable: FAKE_CODEX })('gpt-test', 'the prompt', AbortSignal.timeout(5_000));
  const [call] = readFileSync(join(homedir(), 'fake-codex.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(call.args.includes('mcp_servers.node_repl.enabled=false'));
  assert.ok(!call.args.some((arg) => arg.startsWith('mcp_servers.codex_app')));
});

test('on Windows a codex.cmd shim starts through cmd.exe with escaped arguments; an .exe and other systems start directly', () => {
  const shim = spawnPlanOf('codex', ['exec', '-m', 'a&b'], 'win32');
  assert.equal(shim.shell, true);
  assert.deepEqual(shim.args, ['^^^"exec^^^"', '^^^"-m^^^"', '^^^"a^^^&b^^^"']);
  assert.deepEqual(spawnPlanOf('C:\\Codex\\codex.EXE', ['exec'], 'win32'), { command: 'C:\\Codex\\codex.EXE', args: ['exec'], shell: false });
  assert.deepEqual(spawnPlanOf('codex', ['exec'], 'darwin'), { command: 'codex', args: ['exec'], shell: false });
});

const execCalls = () => {
  try {
    return readFileSync(join(homedir(), 'fake-codex.log'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

test('a distillation whose MCP servers cannot be listed does not run the model', async (t) => {
  t.after(freshHome());
  process.env.FAKE_CODEX_MCP = 'Error: failed to load bootstrap configuration';
  t.after(() => delete process.env.FAKE_CODEX_MCP);
  await assert.rejects(codexModelRunner({ executable: FAKE_CODEX })('gpt-test', 'p', AbortSignal.timeout(5_000)), /could not list the MCP servers/);
  assert.deepEqual(execCalls(), []);
});

test('a distillation cancelled before its MCP servers are listed does not start the model', async (t) => {
  t.after(freshHome());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(codexModelRunner({ executable: FAKE_CODEX })('gpt-test', 'p', controller.signal), { code: 'ABORT_ERR' });
  assert.deepEqual(execCalls(), []);
});
