import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isOlderThan, meetsMinimum } from '../lib/engine-version.mjs';

test('the minimum release and anything newer meet the minimum', () => {
  for (const version of ['2.0.44', '2.0.45', '2.1.0', '3.0.0-beta.1', 'v2.0.44\n']) assert.equal(meetsMinimum(version), true, version);
});

test('older releases, a prerelease of the minimum and unreadable output do not', () => {
  for (const version of ['2.0.43', '2.0.44-beta.1', '2.0.0-beta.1', '', null, 'command not found']) assert.equal(meetsMinimum(version), false, String(version));
});

test('a prerelease sorts below its release', () => {
  assert.equal(isOlderThan('2.0.44-rc.1', '2.0.44'), true);
  assert.equal(isOlderThan('2.0.44', '2.0.44-rc.1'), false);
});

test('prereleases of the same version sort by their identifiers', () => {
  assert.equal(isOlderThan('2.0.44-beta.2', '2.0.44-beta.10'), true);
  assert.equal(isOlderThan('2.0.44-beta.10', '2.0.44-beta.2'), false);
  assert.equal(isOlderThan('2.0.44-beta.1', '2.0.44-rc.1'), true);
});
