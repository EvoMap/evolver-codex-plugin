import assert from 'node:assert/strict';
import { test } from 'node:test';

import { windowsQuoted } from '../lib/engine-runtime.mjs';

test('plain arguments pass through unquoted', () => {
  assert.equal(windowsQuoted('--no-audit'), '--no-audit');
  assert.equal(windowsQuoted('C:\\Users\\joy\\engine'), 'C:\\Users\\joy\\engine');
});

test('a path with spaces is quoted and its trailing backslash cannot escape the closing quote', () => {
  assert.equal(windowsQuoted('C:\\Users\\John Doe\\engine'), '"C:\\Users\\John Doe\\engine"');
  assert.equal(windowsQuoted('C:\\Users\\John Doe\\'), '"C:\\Users\\John Doe\\\\"');
});

test('quotes are escaped together with the backslashes in front of them', () => {
  assert.equal(windowsQuoted('say "hi"'), '"say \\"hi\\""');
  assert.equal(windowsQuoted('a\\"b c'), '"a\\\\\\"b c"');
});
