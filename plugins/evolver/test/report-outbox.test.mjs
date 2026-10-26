import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OUTBOX_TTL_MS, isSettled, withAttempt, withQueued } from '../lib/report-outbox.mjs';

const report = (taskId, assetId = 'sha256:a') => ({ asset_id: assetId, task_id: taskId, outcome: 'success', evidence: { tier: 'L3' } });

test('the same report is queued once, keyed by task id and asset', () => {
  const once = withQueued({}, [{ report: report('t:1:correction'), sessionId: 's' }], 0);
  const twice = withQueued(withAttempt(once, Object.keys(once)[0], { verdict: 'sent' }, 1), [{ report: report('t:1:correction'), sessionId: 's' }], 2);
  assert.equal(Object.keys(twice).length, 1);
  assert.equal(Object.values(twice)[0].sentAt, 1);
  assert.equal(Object.keys(withQueued(twice, [{ report: report('t:1:correction', 'sha256:b'), sessionId: 's' }], 3)).length, 2);
});

test('reports older than eight days are dropped', () => {
  const queued = withQueued({}, [{ report: report('t:1'), sessionId: 's' }], 0);
  assert.deepEqual(withQueued(queued, [], OUTBOX_TTL_MS + 1), {});
});

test('each delivery attempt is counted', () => {
  const queued = withQueued({}, [{ report: report('t:1'), sessionId: 's' }], 0);
  const key = Object.keys(queued)[0];
  assert.equal(withAttempt(withAttempt(queued, key, { verdict: 'retry' }, 1), key, { verdict: 'retry' }, 2)[key].attempts, 2);
  assert.equal(withAttempt(queued, 'missing', { verdict: 'sent' }, 1), queued);
});

test('a rejected report is settled with its reason and never marked sent', () => {
  const queued = withQueued({}, [{ report: report('t:1'), sessionId: 's' }], 0);
  const key = Object.keys(queued)[0];
  const rejected = withAttempt(queued, key, { verdict: 'rejected', reason: 'hub 400', status: 400 }, 5)[key];
  assert.equal(rejected.sentAt, undefined);
  assert.equal(rejected.rejectedAt, 5);
  assert.deepEqual(rejected.rejection, { reason: 'hub 400', status: 400 });
  assert.equal(isSettled(rejected), true);
  assert.equal(isSettled(withAttempt(queued, key, { verdict: 'retry' }, 5)[key]), false);
});

test('a delivered report keeps the receipt the Hub returned', () => {
  const queued = withQueued({}, [{ report: report('t:1'), sessionId: 's' }], 0);
  const key = Object.keys(queued)[0];
  const receipt = { recorded: true, eligible: true, counted: true, weight: 0.6 };
  assert.deepEqual(withAttempt(queued, key, { verdict: 'sent', receipt }, 3)[key].receipt, receipt);
});
