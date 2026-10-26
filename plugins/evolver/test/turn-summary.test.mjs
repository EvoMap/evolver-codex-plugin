import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { referenceReuseSavings, usdOf } from '../lib/savings.mjs';
import { turnSummaryOf } from '../lib/turn-summary.mjs';
import { turnFreshTokens } from '../lib/turn-usage.mjs';

const PASSED = { command: 'npm test', failed: false };

test('a turn that reused no strategy has no summary', () => {
  assert.equal(turnSummaryOf({ reusedNames: [], lastCheck: PASSED, changedLines: 10, freshTokens: 50_000 }), null);
});

test('a reuse a passing check vouched for claims the estimated saving, capped at what the turn spent', () => {
  assert.equal(referenceReuseSavings(4), 49_280);
  assert.equal(
    turnSummaryOf({ reusedNames: ['LRU cache in Node.js'], lastCheck: PASSED, changedLines: 4, freshTokens: 75_000 }),
    '✓ Goal reached (last check passed: npm test) · reused EvoMap strategy "LRU cache in Node.js" · est. ~49k tokens saved (≈$0.44) · this turn used 75k fresh tokens',
  );
  assert.match(turnSummaryOf({ reusedNames: ['a'], lastCheck: PASSED, changedLines: 4, freshTokens: 9_000 }), /est\. ~9k tokens saved \(≈\$0\.08\)/);
  assert.equal(usdOf(1_000_000), 9);
});

test('no saving is counted without a passing check or a known token count', () => {
  assert.equal(
    turnSummaryOf({ reusedNames: ['小红书种草快速起号'], lastCheck: null, changedLines: 0, freshTokens: 20_000 }),
    '○ Unverified (no check ran) · reused EvoMap strategy "小红书种草快速起号" · no saving counted · this turn used 20k fresh tokens',
  );
  assert.match(turnSummaryOf({ reusedNames: ['a'], lastCheck: { command: 'npm test', failed: true }, freshTokens: 20_000 }), /^✗ Goal not reached \(last check failed: npm test\) · .* · no saving counted/);
  assert.match(turnSummaryOf({ reusedNames: ['a'], lastCheck: PASSED, freshTokens: null }), /no saving counted$/);
});

function transcript(events) {
  const dir = mkdtempSync(join(tmpdir(), 'evolver-transcript-'));
  const file = join(dir, 'rollout.jsonl');
  writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join('\n')}\n{not json\n`);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const started = (turnId) => ({ type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } });
const tokens = (input, cached, output) => ({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } });

test("a turn's fresh tokens are its own model calls from the transcript, without cached input", (t) => {
  const { file, cleanup } = transcript([
    started('t1'), tokens(10_000, 0, 500),
    started('t2'), tokens(13_371, 10_624, 210), { type: 'response_item', payload: { type: 'message' } }, tokens(21_405, 13_184, 1_814),
    { type: 'event_msg', payload: { type: 'token_count', info: null } },
  ]);
  t.after(cleanup);
  assert.equal(turnFreshTokens(file, 't2'), (13_371 - 10_624 + 210) + (21_405 - 13_184 + 1_814));
  assert.equal(turnFreshTokens(file, 't1'), 10_500);
  assert.equal(turnFreshTokens(file, 'missing'), null);
  assert.equal(turnFreshTokens(join(tmpdir(), 'no-such-rollout.jsonl'), 't2'), null);
  assert.equal(turnFreshTokens(null, 't2'), null);
});
