import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hostProcess, ownerIsGone, processTableOf } from '../lib/process-owner.mjs';
import { deadPid } from './helpers/sandbox.mjs';

const TABLE = processTableOf([
  '  1     0 /sbin/launchd',
  ' 500     1 /Applications/Codex.app/Contents/MacOS/Codex',
  ' 600   500 /opt/homebrew/Caskroom/codex/0.144.1/codex-aarch64-apple-darwin',
  ' 700   600 /bin/zsh',
  ' 800   700 node',
].join('\n'));

test('the owner is the nearest Codex ancestor, past the shell Codex runs the hook in', () => {
  assert.deepEqual(hostProcess(700, TABLE), { pid: 600, executable: '/opt/homebrew/Caskroom/codex/0.144.1/codex-aarch64-apple-darwin' });
  assert.deepEqual(hostProcess(600, TABLE).pid, 600, 'a hook Codex starts without a shell');
});

test('without a Codex ancestor there is no owner, and no owner is never gone', () => {
  assert.equal(hostProcess(1, TABLE), null);
  assert.equal(hostProcess(999, TABLE), null);
  assert.equal(ownerIsGone(null), false);
  assert.equal(ownerIsGone(process.pid), false);
  assert.equal(ownerIsGone(deadPid()), true);
});
