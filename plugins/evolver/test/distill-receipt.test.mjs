import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outcomeOfDistill } from '../lib/distill-receipt.mjs';

const stored = { ok: true, status: 'stored', gene: { asset_id: 'gene_x' }, capsule: { asset_id: 'capsule_x' }, quality: { ok: true } };
const usage = { input_tokens: 10, output_tokens: 20 };

test('only a stored receipt with both artifact identities is sent', () => {
  const result = outcomeOfDistill({ ok: true, data: stored }, usage);
  assert.equal(result.status, 'sent');
  assert.equal(result.data, stored);
  assert.equal(result.usage, usage);
  // Older stored receipts need not contain the optional quality field.
  assert.equal(outcomeOfDistill({ ok: true, data: { ...stored, quality: undefined } }, usage).status, 'sent');
});

test('HTTP success with rejected, draft, malformed or incomplete data is not persisted', () => {
  for (const data of [undefined, {}, { id: 'legacy-without-proof' }, { ok: false, reason: 'quality_gate' },
    { ...stored, status: 'draft' }, { ...stored, status: 'rejected' }, { ...stored, quality: { ok: false } },
    { ...stored, gene: null }, { ...stored, capsule: null }, { ...stored, gene: { asset_id: '  ' } },
    { ...stored, capsule: { asset_id: 42 } }]) {
    const outcome = outcomeOfDistill({ ok: true, data }, usage);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.data, data);
    assert.equal(outcome.usage, usage);
  }
});

test('transport failure and business rejection preserve usage and the reason', () => {
  assert.deepEqual(outcomeOfDistill({ ok: false, error: 'unreachable' }, usage), { status: 'failed', error: 'unreachable', usage });
  assert.equal(outcomeOfDistill({ ok: true, data: { ok: false, reason: 'quality_gate' } }, usage).error, 'quality_gate');
});
