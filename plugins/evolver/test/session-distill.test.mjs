import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distillDue, distillSession } from '../lib/distiller.mjs';
import {
  argumentsOf, candidateOf, claimLeftoverCandidates, claimSessionCandidate, closeCandidate, distillCandidate, distillPrompt,
  dropCandidate, dueCandidates, isCurrentCandidate, latestCandidateSession, rememberCandidate, settleCandidate, skipReason,
} from '../lib/session-distill.mjs';
import { freshHome } from './helpers/sandbox.mjs';

const MODEL = { model: 'gpt-test' };
const GENE = { title: 'Retry uploads', summary: 'Retry a flaky upload with backoff.', strategy: '1. Measure. 2. Back off.', signals: ['retry'] };

function record(overrides = {}) {
  return { checks: [], commands: ['npm test'], paths: ['src/up.js'], edits: [], answer: 'Done: retries added.', ...overrides };
}

function fakeModel(answer = JSON.stringify(GENE)) {
  const calls = [];
  const runModel = async (model, prompt, signal) => {
    calls.push({ model, prompt });
    await runModel.hold;
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' });
    return { answer: runModel.answer ?? answer, usage: { inputTokens: 900, outputTokens: 120 } };
  };
  runModel.calls = calls;
  return runModel;
}

function recordingProxy() {
  const sent = [];
  const proxyFetch = async (method, path, body) => {
    sent.push({ path, body });
    return { ok: true, data: { id: 'gene_x' } };
  };
  return { sent, proxyFetch };
}

test('only a verified, completed turn that used tools becomes a candidate', () => {
  assert.equal(skipReason('completed', record()), null);
  assert.equal(skipReason('aborted', record()), 'not_completed');
  assert.equal(skipReason('error', record()), 'not_completed');
  assert.equal(skipReason('completed', record({ answer: '' })), 'no_answer');
  assert.equal(skipReason('completed', record({ checks: [{ command: 'npm test', failed: true }] })), 'failed_check');
  assert.equal(skipReason('completed', record({ commands: [] })), 'no_tool_use');
});

test('the prompt is a digest of the turn, never its whole history, and asks for no answer values', () => {
  const candidate = candidateOf({ prompt: 'add a retry to the uploader', record: record({ checks: [{ command: 'npm test', failed: false }] }), model: MODEL, turn: 1 });
  const prompt = distillPrompt(candidate, 'the backoff');
  assert.match(prompt, /## Task\nadd a retry to the uploader/);
  assert.match(prompt, /- npm test/);
  assert.match(prompt, /- passed: npm test/);
  assert.match(prompt, /Focus on: the backoff/);
  assert.match(prompt, /Do not include the answer itself/);
});

test('a list the model wrote as one numbered paragraph becomes steps', () => {
  assert.deepEqual(argumentsOf(JSON.stringify(GENE)).strategy, ['Measure.', 'Back off.']);
  assert.equal(argumentsOf('no json here'), null);
  assert.equal(argumentsOf('{"title":"no summary"}'), null);
});

test('a candidate is distilled on the session model and sent to the Proxy with its own cost', async () => {
  const { sent, proxyFetch } = recordingProxy();
  const candidate = candidateOf({ prompt: 'add a retry', record: record(), model: MODEL, turn: 1 });
  const runModel = fakeModel();
  const outcome = await distillCandidate({ proxyFetch, runModel, candidate, timeoutMs: 1_000 });

  assert.equal(outcome.status, 'sent');
  assert.equal(runModel.calls[0].model, 'gpt-test');
  assert.equal(sent[0].path, '/conversation/distill');
  assert.equal(sent[0].body.platform, 'codex');
  assert.equal(sent[0].body.trigger, 'session_end');
  assert.deepEqual(sent[0].body.distill_usage, { inputTokens: 900, outputTokens: 120 });
  assert.equal((await distillCandidate({ proxyFetch, runModel, candidate: { ...candidate, model: null }, timeoutMs: 1_000 })).status, 'no_model');
  const missing = async () => { throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }); };
  assert.equal((await distillCandidate({ proxyFetch, runModel: missing, candidate, timeoutMs: 1_000 })).status, 'no_model');
  const broken = async () => { throw new Error('codex exec exited 1: not logged in'); };
  assert.deepEqual(await distillCandidate({ proxyFetch, runModel: broken, candidate, timeoutMs: 1_000 }), { status: 'failed', error: 'codex exec exited 1: not logged in' });
  assert.equal((await distillCandidate({ proxyFetch, runModel: fakeModel('not json'), candidate, timeoutMs: 1_000 })).status, 'unparsed');
});

test('a candidate dropped or cancelled while the model answers is never sent, and a cancelled one without an answer is dropped', async (t) => {
  t.after(freshHome());
  const { sent, proxyFetch } = recordingProxy();
  const candidate = candidateOf({ prompt: 'add a retry', record: record(), model: MODEL, turn: 1 });
  rememberCandidate('s', candidate);
  assert.equal(isCurrentCandidate('s', candidate), true);
  rememberCandidate('s', { ...candidate, at: candidate.at + 1 });
  assert.equal(isCurrentCandidate('s', candidate), false);

  const replaced = await distillCandidate({ proxyFetch, runModel: fakeModel(), candidate, timeoutMs: 1_000, isCurrent: () => isCurrentCandidate('s', candidate) });
  const controller = new AbortController();
  const runModel = fakeModel();
  runModel.hold = new Promise((resolve) => setTimeout(resolve, 20));
  const cancelled = distillCandidate({ proxyFetch, runModel, candidate, timeoutMs: 1_000, cancel: controller.signal });
  controller.abort();

  assert.equal(replaced.status, 'dropped');
  assert.equal((await cancelled).status, 'dropped');
  assert.deepEqual(sent, []);
});

test('a correction that drops the candidate stops the distillation running in another process', async (t) => {
  t.after(freshHome());
  const { sent, proxyFetch } = recordingProxy();
  const candidate = candidateOf({ prompt: 'add a retry', record: record(), model: MODEL, turn: 1 });
  rememberCandidate('s', candidate);
  const runModel = fakeModel();
  let release;
  runModel.hold = new Promise((resolve) => { release = resolve; });
  const running = distillDue({ sessionId: 's', candidate }, { proxyFetch, runModel, pollMs: 10 });
  dropCandidate('s');
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  assert.equal((await running).status, 'dropped');
  assert.deepEqual(sent, []);
});

test("a session's candidate is due to it; another session's only once that session is over", (t) => {
  t.after(freshHome());
  rememberCandidate('live', { pid: 111, at: 1 });
  rememberCandidate('killed', { pid: 222, at: 2 });
  rememberCandidate('ended', { pid: 111, at: 3 });
  rememberCandidate('unknown-owner', { pid: null, at: 4 });
  closeCandidate('ended');
  const isGone = (pid) => pid === 222;
  assert.deepEqual(dueCandidates({ sessionId: 'live' }).map((due) => due.sessionId), ['live']);
  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 7 }).map((due) => due.sessionId), ['killed', 'ended']);
  assert.equal(latestCandidateSession(), 'unknown-owner');
});

test('a leftover candidate is claimed by one process only, and again once the claim dies', (t) => {
  t.after(freshHome());
  const isGone = (pid) => pid !== 111;
  rememberCandidate('killed', { pid: 222, at: 1 });

  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 111 }).map((due) => due.sessionId), ['killed']);
  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 333 }), [], 'a live claim is left alone');
  assert.deepEqual(claimSessionCandidate('killed', { isGone, pid: 333 }), [], 'also for a distillation asked for now');
  settleCandidate('killed', { at: 1 }, { sent: false });
  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 333 }).map((due) => due.candidate.attempts), [1], 'a failed try is claimable again');
});

test('a candidate leaves the disk only once distilled, or after three failed tries', (t) => {
  t.after(freshHome());
  const candidate = { pid: process.pid, at: 5, attempts: 0 };
  rememberCandidate('s', candidate);
  settleCandidate('s', candidate, { sent: false });
  settleCandidate('s', candidate, { sent: false });
  assert.equal(dueCandidates({ sessionId: 's' })[0].candidate.attempts, 2, 'kept for a retry');
  settleCandidate('s', candidate, { sent: false });
  assert.deepEqual(dueCandidates({ sessionId: 's' }), [], 'given up');

  rememberCandidate('s', candidate);
  rememberCandidate('s', { ...candidate, at: 9 });
  settleCandidate('s', candidate, { sent: true });
  assert.equal(dueCandidates({ sessionId: 's' })[0].candidate.at, 9, 'a newer candidate written meanwhile stays');
});

test('a distillation asked for now claims the session candidate, and reports nothing when there is none', async (t) => {
  t.after(freshHome());
  const { sent, proxyFetch } = recordingProxy();
  assert.deepEqual(await distillSession('none', { proxyFetch, runModel: fakeModel() }), { status: 'nothing' });
  rememberCandidate('s', candidateOf({ prompt: 'add a retry', record: record(), model: MODEL, turn: 1 }));
  const outcome = await distillSession('s', { proxyFetch, runModel: fakeModel(), focus: 'the backoff' });
  assert.equal(outcome.status, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(dueCandidates({ sessionId: 's' }), []);
});

test('keys and tokens never reach the candidate, nor the prompt a manual focus writes', () => {
  const secret = 'sk-evomap-0123456789abcdef0123456789abcdef';
  const candidate = candidateOf({
    prompt: `use ${secret}`, model: MODEL, turn: 1,
    record: record({ commands: [`curl -H "Authorization: Bearer ${secret}" x`], answer: `done with ${secret}`, paths: [`keys/${secret}.pem`] }),
  });
  assert.doesNotMatch(JSON.stringify(candidate), new RegExp(secret));
  assert.doesNotMatch(distillPrompt(candidate, `Authorization: Bearer ${secret}`), new RegExp(secret));
});
