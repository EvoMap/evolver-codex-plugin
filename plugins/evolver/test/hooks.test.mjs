import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { deadPid, fakeProxy, readJson, runHook, sandboxHome, waitFor, writeProxySettings } from './helpers/sandbox.mjs';

const ASSET_ID = 'sha256:40c6ec437967f3ce0a2101857736b95d2770a014f452752a9421db2bee223f37';
const LRU_ASSET = {
  asset_id: ASSET_ID,
  short_title: 'LRU cache in Node.js',
  similarity: 0.8,
  strategy: [
    'Create `lru-cache.js` exporting the cache class',
    'Back it with a `Map` so lookups stay O(1)',
    'Evict the oldest entry with `keys().next()` once over capacity',
    'Run `node --test` to confirm the eviction order',
  ],
};
const LRU_PATCH = [
  '*** Begin Patch',
  '*** Add File: lru-cache.js',
  '+export class LruCache {',
  '+  #entries = new Map();',
  '+  evict() { this.#entries.delete(this.#entries.keys().next().value); }',
  '+}',
  '*** End Patch',
].join('\n');
const FAILED_RUN = 'not ok 1 - evicts the oldest\nAssertionError: expected 1 to equal 2\n';
const PASSED_RUN = 'ℹ tests 2\nℹ pass 2\nℹ fail 0\n';

let sandbox = null;
let proxy = null;

afterEach(async () => {
  await proxy?.close();
  sandbox?.cleanup();
  sandbox = null;
  proxy = null;
});

async function startSandbox({ assets = [LRU_ASSET], env = {} } = {}) {
  sandbox = sandboxHome();
  Object.assign(sandbox.env, env);
  proxy = await fakeProxy({ assets });
  writeProxySettings(sandbox.home, { url: proxy.url });
}

function session(id) {
  const cwd = join(sandbox.home, 'project');
  mkdirSync(cwd, { recursive: true });
  const base = { session_id: id, cwd, transcript_path: null, model: 'gpt-test', permission_mode: 'default' };
  let turn = 0;
  const turnId = () => `${id}-turn-${turn}`;
  const tool = (name, input, response) => ({ ...base, turn_id: turnId(), tool_name: name, tool_use_id: `call-${Math.random()}`, tool_input: input, tool_response: response });
  return {
    cwd,
    start: (source = 'startup') => runHook('session-start', { ...base, hook_event_name: 'SessionStart', source }, sandbox.env),
    prompt: (prompt, { sameTurn = false } = {}) => {
      if (!sameTurn) turn += 1;
      return runHook('user-prompt-submit', { ...base, hook_event_name: 'UserPromptSubmit', turn_id: turnId(), prompt }, sandbox.env);
    },
    shell: (command, output, callId) => runHook('post-tool-use', { ...tool('Bash', { command }, output), ...(callId && { tool_use_id: callId }), hook_event_name: 'PostToolUse' }, sandbox.env),
    patch: async (patch, response = 'Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nA lru-cache.js\n') => {
      await runHook('pre-tool-use', { ...tool('apply_patch', { command: patch }), hook_event_name: 'PreToolUse' }, sandbox.env);
      writeFileSync(join(cwd, 'lru-cache.js'), 'export class LruCache {}\n');
      await runHook('post-tool-use', { ...tool('apply_patch', { command: patch }, response), hook_event_name: 'PostToolUse' }, sandbox.env);
    },
    stop: (answer, { continuation = false, transcriptPath = null } = {}) => runHook('stop', { ...base, hook_event_name: 'Stop', turn_id: turnId(), transcript_path: transcriptPath, stop_hook_active: continuation, last_assistant_message: answer }, sandbox.env),
    interrupt: () => runHook('interrupt', { ...base, hook_event_name: 'Interrupt', turn_id: turnId() }, sandbox.env),
    end: () => runHook('session-end', { session_id: id, cwd, transcript_path: null, hook_event_name: 'SessionEnd', reason: 'other' }, sandbox.env),
  };
}

const statePath = (name) => join(sandbox.home, '.evolver', 'state', name);
const candidates = () => readJson(statePath('codex-distill-pending.json'), {});
const fakeCodexCalls = () => readFileSync(join(sandbox.home, 'fake-codex.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

async function lruTurn(s) {
  const injected = await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.patch(LRU_PATCH);
  await s.shell('node --test', FAILED_RUN);
  await s.shell('node --test 2>&1 | tail -5', PASSED_RUN);
  await s.stop('LRU 缓存写好了，测试通过。');
  return injected;
}

async function verifiedTurn(s, prompt = 'add a retry to the uploader') {
  await s.prompt(prompt);
  await s.shell('npm test', PASSED_RUN);
  await s.stop('Retries added; npm test passes.');
}

test('a recalled strategy rides the prompt as additional context and ends with "Apply them where they fit."', async () => {
  await startSandbox();
  const output = await session('s-recall').prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');

  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  const context = output.hookSpecificOutput.additionalContext;
  assert.equal(context, [
    '[Evolution Memory] LRU cache in Node.js (EvoMap network):',
    ...LRU_ASSET.strategy.map((step, index) => `${index + 1}. ${step}`),
    '',
    'Apply them where they fit.',
  ].join('\n'));
  assert.doesNotMatch(context, /evolver_/);
  assert.deepEqual(proxy.of('/asset/fetch'), [{ text: '用 Node 写一个 LRU cache，带 get/set 和淘汰' }]);
});

test('session start adds nothing to the context when Evolver is set up', async () => {
  await startSandbox();
  assert.deepEqual(await session('s-quiet').start(), {});
});

test('the turn end reports the strategy as used with the turn\'s own evidence, and the reused turn is a candidate too', async () => {
  await startSandbox();
  const s = session('s-lru');
  await lruTurn(s);

  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.deepEqual(report, {
    asset_id: ASSET_ID,
    outcome: 'success',
    task_id: 'codex:s-lru:1',
    reason: 'Injected by Evolver into Codex turn 1; last test passed after failing earlier.',
    evidence: { tier: 'L1', applied: 'used', check: { kind: 'test', passed: true, fail_then_pass: true }, aborted: false, stage: 'immediate' },
  });
  assert.equal(candidates()['s-lru']?.turn, 1);
});

test('a turn that reused a strategy ends with a one-line summary for the person, priced from its transcript', async () => {
  await startSandbox();
  const s = session('s-summary');
  const transcriptPath = join(sandbox.home, 'rollout.jsonl');
  writeFileSync(transcriptPath, [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 's-summary-turn-1' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 90_000, cached_input_tokens: 20_000, output_tokens: 5_000 } } } },
  ].map((event) => JSON.stringify(event)).join('\n'));
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.patch(LRU_PATCH);
  await s.shell('node --test', PASSED_RUN);

  assert.deepEqual(await s.stop('LRU 缓存写好了，测试通过。', { transcriptPath }), {
    systemMessage: '✓ Goal reached (last check passed: node --test) · reused EvoMap strategy "LRU cache in Node.js" · est. ~49k tokens saved (≈$0.44) · this turn used 75k fresh tokens',
  });
});

test('a turn that reused nothing ends without a summary', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-plain');
  await s.prompt('add a retry to the uploader');
  await s.shell('npm test', PASSED_RUN);
  assert.deepEqual(await s.stop('Done.'), {});
});

test('evolver-status in the prompt box is answered by the hook, kept from the model, and opens no turn', async () => {
  await startSandbox();
  const s = session('s-command');
  const answer = await s.prompt('evolver-status');
  assert.equal(answer.decision, 'block');
  assert.match(answer.reason, /^Evolver Codex plugin status\n/);
  assert.match(answer.reason, /OK Proxy: running/);
  assert.equal(answer.hookSpecificOutput, undefined, 'nothing reaches the model');
  assert.deepEqual(proxy.of('/asset/fetch'), [], 'a command recalls nothing');

  await lruTurn(s);
  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.equal(report.task_id, 'codex:s-command:1', 'the command was not counted as a turn');
});

test("evolver-distill distills this session's verified turn in the background, and evolver-status shows how it ended", async () => {
  await startSandbox({ assets: [] });
  const s = session('s-distill-now');
  await verifiedTurn(s);
  assert.match((await s.prompt('evolver-distill the backoff')).reason, /in the background/);

  const [body] = await waitFor(() => proxy.of('/conversation/distill'));
  assert.equal(body.trigger, 'session_end');
  await waitFor(() => Object.keys(candidates()).length === 0);
  await waitFor(async () => /last distillation sent for s-distill-now/.test((await s.prompt('evolver-status')).reason));
  assert.match((await s.prompt('evolver-distill')).reason, /Nothing to distill yet/);
});

test('a correction in the next prompt sends an L3 follow-up under :correction', async () => {
  await startSandbox();
  const s = session('s-fix');
  await lruTurn(s);
  await s.prompt('还是报错，不对');
  const correction = await waitFor(() => proxy.of('/asset/reuse-result').find((report) => report.task_id.endsWith(':correction')));
  assert.deepEqual(correction, {
    asset_id: ASSET_ID,
    outcome: 'failed',
    task_id: 'codex:s-fix:1:correction',
    reason: "The person's next prompt read as correction of the turn that reused this strategy.",
    evidence: { tier: 'L3', applied: 'used', stage: 'correction' },
  });
});

test('the next session in the same project reports whether the edits were kept, under :retention', async () => {
  await startSandbox();
  await lruTurn(session('s-first'));
  await waitFor(() => proxy.of('/asset/reuse-result'));
  await session('s-second').start();
  const retention = await waitFor(() => proxy.of('/asset/reuse-result').find((report) => report.task_id.endsWith(':retention')));
  assert.equal(retention.task_id, 'codex:s-first:1:retention');
  assert.equal(retention.outcome, 'success');
});

test('an interrupted turn reports its strategy as aborted, with what the turn did', async () => {
  await startSandbox();
  const s = session('s-cut');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.shell('node --test', PASSED_RUN);
  await s.interrupt();
  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.equal(report.task_id, 'codex:s-cut:1');
  assert.equal(report.evidence.aborted, true);
  assert.deepEqual(report.evidence.check, { kind: 'test', passed: true, fail_then_pass: false });
  assert.deepEqual(candidates(), {});
});

test('a turn still open at session end ended on an error: Codex interrupts a running one first', async () => {
  await startSandbox();
  const s = session('s-gone');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.end();
  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.deepEqual(report, {
    asset_id: ASSET_ID,
    outcome: 'failed',
    task_id: 'codex:s-gone:1',
    reason: 'Injected by Evolver into Codex turn 1; no check ran.',
    evidence: { tier: 'none', applied: 'used', aborted: false, stage: 'immediate' },
  });
});

test('an interrupted turn is reported once, and the session end that follows adds nothing', async () => {
  await startSandbox();
  const s = session('s-quit');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.interrupt();
  await s.end();
  await waitFor(() => proxy.of('/asset/reuse-result'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(proxy.of('/asset/reuse-result').length, 1);
  assert.equal(proxy.of('/asset/reuse-result')[0].evidence.aborted, true);
});

test('a resumed thread keeps counting turns after its session end, so task ids never repeat', async () => {
  await startSandbox();
  const s = session('s-resume');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.stop('done');
  await s.end();
  await s.start('resume');
  await s.prompt('用 Node 再写一个 LRU cache 的测试，覆盖淘汰顺序');
  await s.stop('done again');
  const reports = await waitFor(() => (proxy.of('/asset/reuse-result').length >= 2 ? proxy.of('/asset/reuse-result') : null));
  assert.deepEqual(reports.map((report) => report.task_id).sort(), ['codex:s-resume:1', 'codex:s-resume:2']);
});

test('a Stop continuation joins the turn: its failed check drops the candidate, a passing one writes it', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-continue');
  await verifiedTurn(s);
  assert.ok(candidates()['s-continue']);
  await s.shell('npm test', FAILED_RUN);
  await s.stop('Retries added.', { continuation: true });
  assert.deepEqual(candidates(), {});
  await s.shell('npm test', PASSED_RUN);
  await s.stop('Retries added; npm test passes again.', { continuation: true });
  assert.deepEqual(candidates()['s-continue'].commands, ['npm test', 'npm test', 'npm test']);
  assert.equal(candidates()['s-continue'].answer, 'Retries added; npm test passes again.');
});

test('a test suite still running when the turn ends is no evidence: no L1 report and no candidate', async () => {
  await startSandbox();
  const s = session('s-long');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.shell('npm test', 'Chunk ID: 4f2a1c\nWall time: 10.0021 seconds\nProcess running with session ID 7\nOriginal token count: 18\nOutput:\n▶ lru\n  ✔ evicts the oldest (1.2ms)\n', 'call_suite');
  await s.stop('The suite is still running.');
  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.equal(report.evidence.tier, 'none');
  assert.equal(report.evidence.check, undefined);
  assert.match(report.reason, /no check ran/);
});

test('every hook answers JSON on stdout, which Stop requires', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-json');
  await s.prompt('add a retry to the uploader');
  assert.deepEqual(await s.shell('npm test', PASSED_RUN), {});
  assert.deepEqual(await s.stop('done'), {});
  assert.deepEqual(await s.end(), {});
});

test('a turn that ended on an error is reported failed when the next prompt arrives', async () => {
  await startSandbox();
  const s = session('s-error');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.prompt('continue with the README');
  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.equal(report.task_id, 'codex:s-error:1');
  assert.equal(report.outcome, 'failed');
  assert.equal(report.evidence.aborted, false);
});

test('a steered prompt in the same turn opens no new turn', async () => {
  await startSandbox();
  const s = session('s-steer');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  assert.deepEqual(await s.prompt('also add a size getter please', { sameTurn: true }), {});
  await s.stop('done');
  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.equal(report.task_id, 'codex:s-steer:1');
});

test("a killed session's open strategies are reported aborted at the next session start", async () => {
  await startSandbox();
  mkdirSync(statePath(''), { recursive: true });
  writeFileSync(statePath('codex-injected-0000000000000000.json'), JSON.stringify({
    'sha256:orphan': { turn: 4, injectedAt: Date.now(), title: 'a', sessionId: 's-killed', pid: deadPid() },
  }));
  await session('s-next').start();
  const [report] = await waitFor(() => proxy.of('/asset/reuse-result'));
  assert.equal(report.asset_id, 'sha256:orphan');
  assert.equal(report.task_id, 'codex:s-killed:4');
  assert.deepEqual(report.evidence, { tier: 'none', applied: 'used', aborted: true, stage: 'immediate' });
});

test('a verified turn becomes the candidate; a failed check leaves none, and a correction drops it', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-candidate');
  await s.prompt('fix the flaky upload');
  await s.shell('npm test', FAILED_RUN);
  await s.stop('Still failing.');
  assert.deepEqual(candidates(), {}, 'failed_check');

  await verifiedTurn(s);
  const candidate = candidates()['s-candidate'];
  assert.equal(candidate.prompt, 'add a retry to the uploader');
  assert.deepEqual(candidate.commands, ['npm test']);
  assert.deepEqual(candidate.model, { model: 'gpt-test' });
  assert.equal(candidate.turn, 2);

  await s.prompt('不对，这样不行');
  assert.deepEqual(candidates(), {});
});

test('the session end distills its candidate once through codex exec, outside the conversation', async () => {
  await startSandbox({ assets: [] });
  const s = session('s-distill');
  await verifiedTurn(s);
  assert.equal(proxy.of('/conversation/distill').length, 0, 'nothing runs at turn end');
  await s.end();

  const [body] = await waitFor(() => proxy.of('/conversation/distill'));
  assert.equal(body.platform, 'codex');
  assert.equal(body.trigger, 'session_end');
  assert.equal(body.user_prompt, 'add a retry to the uploader');
  assert.equal(body.final_answer, 'Retries added; npm test passes.');
  assert.deepEqual(body.strategy, ['Measure.', 'Back off.']);
  assert.deepEqual(body.execution, { trace: [{ command: 'npm test', exit: 0 }] });
  assert.equal(body.persist, true);
  assert.equal(body.publish, false);
  assert.equal(body.distill_usage.inputTokens, 900);
  await waitFor(() => Object.keys(candidates()).length === 0);

  const [call] = fakeCodexCalls();
  assert.equal(call.args[0], 'exec');
  assert.deepEqual(call.args.slice(call.args.indexOf('-m'), call.args.indexOf('-m') + 2), ['-m', 'gpt-test']);
  assert.ok(call.args.includes('hooks') && call.args.includes('shell_tool'));
  assert.match(call.prompt, /## Task\nadd a retry to the uploader/);
});

test('an unparsed answer keeps the candidate for the next session start, which claims and distills it', async () => {
  await startSandbox({ assets: [], env: { FAKE_CODEX_ANSWER: 'not json' } });
  const s = session('s-retry');
  await verifiedTurn(s);
  await s.end();
  await waitFor(() => candidates()['s-retry']?.attempts === 1);
  assert.equal(candidates()['s-retry'].claimedBy, null);

  delete sandbox.env.FAKE_CODEX_ANSWER;
  await session('s-after').start();
  await waitFor(() => proxy.of('/conversation/distill'));
  await waitFor(() => Object.keys(candidates()).length === 0);
});

test("a killed session's candidate is claimed and distilled by the next session start; an idle one is left alone", async () => {
  await startSandbox({ assets: [] });
  const candidate = (pid, at) => ({ prompt: 'p', commands: ['npm test'], paths: [], checks: [], answer: 'a', model: { model: 'gpt-test' }, turn: 1, pid, attempts: 0, at });
  mkdirSync(statePath(''), { recursive: true });
  writeFileSync(statePath('codex-distill-pending.json'), JSON.stringify({ 's-killed': candidate(deadPid(), 1), 's-idle': candidate(process.pid, 2) }));

  await session('s-next').start();
  await waitFor(() => proxy.of('/conversation/distill'));
  await waitFor(() => !candidates()['s-killed']);
  assert.ok(candidates()['s-idle']);
  assert.equal(proxy.of('/conversation/distill').length, 1);
});
