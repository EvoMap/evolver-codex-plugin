import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';

import { readState, statePath, updateState, withLock } from '../lib/state-file.mjs';
import { deadPid, freshHome } from './helpers/sandbox.mjs';

const MODULE = new URL('../lib/state-file.mjs', import.meta.url).href;
const WRITERS = 4;
const PER_WRITER = 15;

const CHILD = `
  const { statePath, updateState } = await import(process.argv[1]);
  for (const key of process.argv.slice(2)) {
    updateState(statePath('shared.json'), {}, (state) => ({ ...state, [key]: true }));
  }
`;

function writer(keys) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD, MODULE, ...keys], { stdio: 'ignore' });
    child.on('exit', resolve);
  });
}

test('an update is read, changed and written under a lock, so parallel writers keep every entry', async (t) => {
  t.after(freshHome());
  const keysOf = (writerIndex) => Array.from({ length: PER_WRITER }, (unused, index) => `w${writerIndex}-${index}`);
  await Promise.all(Array.from({ length: WRITERS }, (unused, index) => writer(keysOf(index))));
  assert.equal(Object.keys(readState(statePath('shared.json'), {})).length, WRITERS * PER_WRITER);
});

test('an update that changes nothing leaves the file alone and releases its lock', (t) => {
  t.after(freshHome());
  updateState(statePath('kept.json'), {}, () => ({ a: 1 }));
  updateState(statePath('kept.json'), {}, () => undefined);
  assert.deepEqual(readState(statePath('kept.json'), {}), { a: 1 });
  assert.deepEqual(updateState(statePath('kept.json'), {}, (state) => ({ ...state, b: 2 })), { a: 1, b: 2 });
});

test("a dead owner's lock is taken over, and a lock someone else holds by the time of release is left to them", (t) => {
  t.after(freshHome());
  const target = statePath('stale.json');
  const lockPath = `${target}.lock`;
  fs.mkdirSync(statePath(''), { recursive: true });
  fs.writeFileSync(lockPath, `${deadPid()}:dead`);

  updateState(target, {}, () => ({ a: 1 }));
  assert.equal(fs.existsSync(lockPath), false, "the dead owner's lock is gone after the update");

  updateState(target, {}, (state) => {
    fs.writeFileSync(lockPath, `${process.pid}:someone-else`);
    return { ...state, b: 2 };
  });
  assert.equal(fs.readFileSync(lockPath, 'utf8'), `${process.pid}:someone-else`);
  assert.deepEqual(readState(target, {}), { a: 1, b: 2 });
});

test('a long job runs in one process at a time, and a dead holder does not block the next', async (t) => {
  t.after(freshHome());
  let release;
  const first = withLock('job', () => new Promise((resolve) => { release = resolve; }));
  assert.equal(await withLock('job', async () => {}), false);
  release();
  assert.equal(await first, true);
  fs.writeFileSync(statePath('job.lock'), `${deadPid()}:dead`);
  assert.equal(await withLock('job', async () => {}), true);
});
