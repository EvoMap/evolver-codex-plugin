import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { queueOrphanedUnreported, rememberInjected } from '../lib/injected-assets.mjs';
import { freshHome } from './helpers/sandbox.mjs';

let restoreHome = null;

afterEach(() => {
  restoreHome?.();
  restoreHome = null;
});

const isGone = () => true;

function orphanedNow() {
  const taken = [];
  queueOrphanedUnreported((due) => taken.push(...due), { isGone });
  return taken.map((asset) => asset.assetId);
}

test('an orphaned injection whose queueing fails stays unreported for the next session start', () => {
  restoreHome = freshHome();
  rememberInjected('s-killed', 'sha256:a', { pid: 1, turn: 2, strategyText: '1. a.' });

  assert.throws(() => queueOrphanedUnreported(() => {
    throw new Error('disk full');
  }, { isGone }));

  assert.deepEqual(orphanedNow(), ['sha256:a']);
  assert.deepEqual(orphanedNow(), []);
});

test('an injection of a live session is not taken as orphaned', () => {
  restoreHome = freshHome();
  rememberInjected('s-idle', 'sha256:b', { pid: process.pid, turn: 1, strategyText: '1. b.' });

  const taken = [];
  queueOrphanedUnreported((due) => taken.push(...due), { isGone: () => false });

  assert.deepEqual(taken, []);
});
