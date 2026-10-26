import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hubGene, promptTextOf } from '../lib/prime.mjs';

const steps = (count) => Array.from({ length: count }, (unused, index) => `Step number ${index + 1} of the method`);
const proxyWith = (assets) => async (method, path, body) => ({ ok: true, data: { assets, echo: body } });

test('one strategy is injected, the best-scoring one with enough steps, ending with "Apply them where they fit."', async () => {
  const outcomes = [];
  const match = await hubGene(proxyWith([
    { asset_id: 'thin', similarity: 0.9, strategy: steps(3) },
    { asset_id: 'low', similarity: 0.1, strategy: steps(5) },
    { asset_id: 'good', similarity: 0.6, short_title: 'Retry with backoff', strategy: steps(4) },
  ]), 'add a retry to the uploader', { onOutcome: (outcome) => outcomes.push(outcome) });
  assert.deepEqual(match.ids, ['good']);
  assert.equal(match.text.split('\n')[0], '[Evolution Memory] Retry with backoff (EvoMap network):');
  assert.equal(match.text.split('\n').at(-1), 'Apply them where they fit.');
  assert.deepEqual(outcomes[0].dropped, { low_similarity: 1, too_few_steps: 1 });
});

test('a short prompt, an already injected asset or a Proxy error inject nothing', async () => {
  assert.deepEqual(await hubGene(proxyWith([{ asset_id: 'a', strategy: steps(4) }]), 'fix it'), { ids: [], text: '' });
  assert.deepEqual(await hubGene(proxyWith([{ asset_id: 'a', strategy: steps(4) }]), 'add a retry to the uploader', { listedIds: new Set(['a']) }), { ids: [], text: '' });
  assert.deepEqual(await hubGene(async () => ({ ok: false, error: 'down' }), 'add a retry to the uploader'), { ids: [], text: '' });
});

test('the prompt loses keys and tokens before recall sends it', () => {
  assert.equal(promptTextOf('fix it, token=ghp_abcdefghijklmnopqrstuvwxyz0123 now'), 'fix it, [redacted] now');
});
