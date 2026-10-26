import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { appliedVerdictOf, concreteFeaturesOf, strategyStepsOf } from '../lib/applied.mjs';

const STRATEGY = [
  '[Evolution Memory] Fix flaky Redis connection in tests (EvoMap network):',
  '1. Set `maxRetriesPerRequest` to null in lib/redis.js',
  '2. Run npm test to confirm the suite passes',
  '3. Wrap the client in a singleton factory module',
  '4. Close the connection in the global teardown hook',
  '',
  'Apply them where they fit.',
].join('\n');

test('only the numbered steps of an injected strategy are matched', () => {
  assert.equal(strategyStepsOf(STRATEGY).length, 4);
});

test('backticked names, paths and commands are concrete features', () => {
  assert.deepEqual(concreteFeaturesOf('Set `maxRetriesPerRequest` to null in lib/redis.js'), ['maxretriesperrequest', 'lib/redis.js']);
  assert.deepEqual(concreteFeaturesOf('Run npm test to confirm'), ['npm test']);
});

test('a turn that touched the named file and ran the named command used the strategy', () => {
  const verdict = appliedVerdictOf({
    strategyText: STRATEGY,
    commands: ['npm test'],
    paths: ['/repo/lib/redis.js'],
    answer: 'I wrapped the client in a singleton factory module.',
  });
  assert.equal(verdict.verdict, 'used');
  assert.equal(verdict.hits, 3);
  assert.equal(verdict.steps, 4);
});

test('one matching step out of four is partial', () => {
  const verdict = appliedVerdictOf({ strategyText: STRATEGY, commands: ['npm test'], paths: [], answer: 'Done.' });
  assert.equal(verdict.verdict, 'partial');
  assert.equal(verdict.ratio, 0.25);
});

test('a turn sharing nothing with the strategy left it unused', () => {
  const verdict = appliedVerdictOf({ strategyText: STRATEGY, commands: ['ls'], paths: ['/repo/README.md'], answer: 'Renamed the heading.' });
  assert.equal(verdict.verdict, 'unused');
  assert.equal(verdict.hits, 0);
});

test('generic words alone do not count as following a prose step', () => {
  const prose = '1. Make sure you always check the result before you report the outcome';
  assert.equal(appliedVerdictOf({ strategyText: prose, commands: ['ls'], paths: [], answer: 'make sure always check before report outcome' }).verdict, 'unused');
});

test('a strategy with no steps cannot be judged', () => {
  assert.deepEqual(appliedVerdictOf({ strategyText: '', commands: ['npm test'], paths: [], answer: '' }), { verdict: 'unknown', hits: 0, steps: 0, ratio: 0 });
});

const LRU_TURN = JSON.parse(readFileSync(new URL('./fixtures/lru-turn.json', import.meta.url), 'utf8'));

test('a strategy carried out in the code the turn wrote is used, whatever language the answer is in', () => {
  const verdict = appliedVerdictOf(LRU_TURN);
  assert.equal(verdict.verdict, 'used');
  assert.equal(verdict.steps, 5);
  assert.ok(verdict.hits >= 3, `hits ${verdict.hits}`);
});

test('the same turn without its written code shows why edits must be matched', () => {
  assert.equal(appliedVerdictOf({ ...LRU_TURN, edits: [] }).hits, 0);
});

test('a prose word that reads like a command does not stop a step from matching on its terms', () => {
  const step = '1. On get, move the accessed node to the head of the list to mark it as most recently used';
  const edits = ['moveToHead(node) { if (node === this.head) return } // most recently used'];
  assert.equal(appliedVerdictOf({ strategyText: step, commands: [], paths: [], edits, answer: '' }).verdict, 'used');
});

test('work that shares nothing with the strategy is unused', () => {
  const verdict = appliedVerdictOf({ ...LRU_TURN, edits: ['export const greeting = "hello";\n'], commands: ['ls'], paths: ['/tmp/x/greeting.js'], answer: '好了。' });
  assert.equal(verdict.verdict, 'unused');
});

test('a turn that left only an answer, or a strategy without steps, cannot be judged', () => {
  assert.equal(appliedVerdictOf({ strategyText: LRU_TURN.strategyText, commands: [], paths: [], edits: [], answer: '用 Map 加双向链表即可。' }).verdict, 'unknown');
  assert.equal(appliedVerdictOf({ strategyText: 'no numbered steps here', commands: ['npm test'], paths: [], edits: [], answer: '' }).verdict, 'unknown');
});
