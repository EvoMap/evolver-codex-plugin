import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evolverCommands, runEvolverCli } from '../lib/commands.mjs';

const commands = evolverCommands({
  status: async () => 'OK Proxy',
  search: async (text) => ({ ok: true, data: { text } }),
  distillNow: async (args) => (args.length ? { status: 'sent', data: { id: 'gene' } } : { status: 'nothing' }),
  runCli: async (args) => ({ kind: 'success', text: args.join(' ') }),
});
const named = (name) => commands.find((command) => command.name === `evolver-${name}`);

test('the commands mirror dsh, and one that takes no argument declares no input hint', () => {
  assert.deepEqual(commands.map((command) => command.name), [
    'evolver-status', 'evolver-search', 'evolver-distill', 'evolver-evolve', 'evolver-sync', 'evolver-review', 'evolver-run', 'evolver-solidify',
  ]);
  assert.equal(named('status').input, undefined);
  assert.ok(commands.filter((command) => command.name !== 'evolver-status').every((command) => command.input.hint));
});

test('search needs text, distill says when there is nothing, and engine commands pass their arguments through', async () => {
  assert.equal((await named('search').handler({ args: [] })).kind, 'error');
  assert.match((await named('search').handler({ args: ['flaky', 'test'] })).text, /"flaky test"/);
  assert.match((await named('distill').handler({ args: [] })).text, /Nothing to distill yet/);
  assert.equal((await named('run').handler({ args: ['--strategy=balanced'] })).text, 'run --strategy=balanced');
});

test('evolve hands back the dsh instruction with the focus, for the person to paste', async () => {
  const { kind, text } = await named('evolve').handler({ args: ['the', 'retry'] });
  assert.equal(kind, 'success');
  assert.match(text, /^Take a deliberate evolution step for the current task\./);
  assert.match(text, /\n\nFocus: the retry$/);
  assert.doesNotMatch(text, /^---/);
});

test('a missing evolver executable falls back to the npx package this plugin is built against', async () => {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return file === 'evolver' ? { error: Object.assign(new Error('spawn evolver ENOENT'), { code: 'ENOENT' }) } : { error: null, output: 'synced' };
  };
  assert.deepEqual(await runEvolverCli(['sync', '--dry-run'], { run }), { kind: 'success', text: 'synced' });
  assert.deepEqual(calls[1], ['npx', '-y', '@evomap/evolver@^2.0.44', 'sync', '--dry-run']);
});
