import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shellCheckFailed, verificationFailed } from '../lib/verification.mjs';

test('a summary that counts real failures beside zero errors still fails', () => {
  assert.equal(verificationFailed('1 failed, 0 errors'), true);
  assert.equal(verificationFailed('tests 3 | failed: 2 | errors: 0'), true);
});

test('a passing summary that counts zero failures passes', () => {
  for (const text of ['ℹ tests 78\nℹ pass 78\nℹ fail 0', 'Tests: 0 failed, 12 passed', 'failures: 0\nerrors: 0', '✔ Validation passed']) {
    assert.equal(verificationFailed(text), false, text);
  }
});

test('failure output fails the verification, since Codex passes no exit code', () => {
  assert.equal(verificationFailed('not ok 1 - adds\n# fail 1\nAssertionError: expected 2'), true);
});

test('a real Codex 0.144 Bash payload carries bare output: a failing node --test run fails, a passing one passes', () => {
  const failing = 'Success. Updated the following files:\nA retry.mjs\nA retry.test.mjs\n✔ returns the first successful result without retrying (0.603667ms)\n✖ retries with exponential backoff and stops after success (0.86875ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\nℹ tests 5\nℹ pass 4\nℹ fail 1\n';
  const passing = 'Success. Updated the following files:\nM retry.mjs\n✔ returns the first successful result without retrying (0.519792ms)\n✔ retries with exponential backoff and stops after success (2.170125ms)\nℹ tests 5\nℹ pass 5\nℹ fail 0\n';
  assert.equal(shellCheckFailed(failing), true);
  assert.equal(shellCheckFailed(passing), false);
});

test('an exit-code header decides where Codex formats one, and a timed-out check fails', () => {
  assert.equal(shellCheckFailed('Exit code: 1\nWall time: 0.2 seconds\nOutput:\nall good'), true);
  assert.equal(shellCheckFailed('Exit code: 0\nWall time: 0.2 seconds\nOutput:\nℹ pass 3\nℹ fail 0'), false);
  assert.equal(shellCheckFailed('command timed out after 10000 milliseconds\nℹ pass 1'), true);
});
