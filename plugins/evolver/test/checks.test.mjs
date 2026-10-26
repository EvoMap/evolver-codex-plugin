import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkEvidenceOf, checkIdentityOf, checkKindOf } from '../lib/checks.mjs';

test('every check command maps onto the four kinds the Hub accepts', () => {
  assert.equal(checkKindOf('npx -p typescript tsc -p .'), 'typecheck');
  assert.equal(checkKindOf('npm run lint'), 'lint');
  assert.equal(checkKindOf('npm run validate'), 'lint');
  assert.equal(checkKindOf('node --test test/*.test.js'), 'test');
  assert.equal(checkKindOf('cargo build --release'), 'build');
  assert.equal(checkKindOf('make'), 'build');
});

test('the last check decides, and a failure of that same command earlier marks a turnaround', () => {
  assert.equal(checkEvidenceOf([]), undefined);
  assert.deepEqual(checkEvidenceOf([{ command: 'npm test', failed: true }, { command: 'npm test', failed: false }]), { kind: 'test', passed: true, fail_then_pass: true });
  assert.deepEqual(checkEvidenceOf([{ command: 'npm run lint', failed: true }, { command: 'npm test', failed: false }]), { kind: 'test', passed: true, fail_then_pass: false });
  assert.deepEqual(checkEvidenceOf([{ command: 'npm test', failed: false }, { command: 'npm test', failed: true }]), { kind: 'test', passed: false, fail_then_pass: false });
});

test('the same check is recognised when only its output trimming differs', () => {
  const checks = [
    { command: 'cd /tmp/lru-e2e && node --test 2>&1 | tail -12', failed: true },
    { command: 'cd /tmp/lru-e2e && node --test 2>&1 | tail -9', failed: false },
  ];
  assert.deepEqual(checkEvidenceOf(checks), { kind: 'test', passed: true, fail_then_pass: true });
  assert.equal(checkIdentityOf('npm test  2>&1 | grep -v "^ok" | head -40'), 'npm test');
  assert.equal(checkIdentityOf('npm run build > build.log 2>&1 && npm test | tail -3'), 'npm run build && npm test');
});

test('different checks stay different, and a logical or is not an output pipe', () => {
  assert.notEqual(checkIdentityOf('npm test | tail -5'), checkIdentityOf('npm run lint | tail -5'));
  assert.notEqual(checkIdentityOf('cd a && npm test'), checkIdentityOf('cd b && npm test'));
  assert.equal(checkIdentityOf('npm test || true'), 'npm test || true');
  assert.equal(checkEvidenceOf([{ command: 'npm run lint | tail -3', failed: true }, { command: 'npm test | tail -3', failed: false }]).fail_then_pass, false);
});
