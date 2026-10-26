import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ABSENT, retentionOf } from '../lib/retention.mjs';

test('files still as the turn left them are kept', () => {
  assert.deepEqual(retentionOf([{ before: 'a', after: 'b', now: 'b' }, { before: ABSENT, after: 'c', now: 'c' }]), { class: 'kept', files: 2 });
});

test('files back to how they stood before the turn are reverted', () => {
  assert.deepEqual(retentionOf([{ before: 'a', after: 'b', now: 'a' }, { before: ABSENT, after: 'c', now: ABSENT }]), { class: 'reverted', files: 2 });
});

test('files changed again since the turn are rewritten', () => {
  assert.equal(retentionOf([{ before: 'a', after: 'b', now: 'z' }]).class, 'rewritten');
});

test('a mix of kept and reverted files counts as rewritten', () => {
  assert.equal(retentionOf([{ before: 'a', after: 'b', now: 'b' }, { before: 'c', after: 'd', now: 'c' }]).class, 'rewritten');
});

test('edits that netted out to nothing are not judged', () => {
  assert.deepEqual(retentionOf([{ before: 'a', after: 'a', now: 'z' }]), { class: 'no_change', files: 0 });
  assert.deepEqual(retentionOf([]), { class: 'no_change', files: 0 });
});
