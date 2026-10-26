import assert from 'node:assert/strict';
import { test } from 'node:test';

import { engineNoticeOf } from '../lib/engine-notice.mjs';
import { isSetupDue, prepareEngine, setupErrorOutcome } from '../lib/engine-setup.mjs';

const NOW = 1_800_000_000_000;
const MINUTE = 60 * 1000;

function fakeRuntime({ node = '22.22.2', managed = null, onPath = null, latest = '2.0.44', installError = null, running = null, startsProxy = true, startError = null } = {}) {
  const calls = [];
  let managedEngine = managed && engineAt('managed', managed);
  let proxy = running && { version: running };
  function engineAt(source, version) {
    return {
      source,
      version,
      run: async (args) => {
        calls.push([source, ...args]);
        if (startError) return { ok: false, error: startError };
        if (startsProxy) proxy = { version };
        return { ok: true };
      },
    };
  }
  return {
    calls,
    nodeVersion: node,
    now: () => NOW,
    managedEngine: async () => managedEngine,
    pathEngine: async () => onPath && engineAt('path', onPath),
    runningProxy: async () => proxy,
    waitForProxy: async () => proxy,
    installLatest: async () => {
      calls.push(['npm', 'install']);
      if (installError) return { ok: false, error: installError };
      managedEngine = engineAt('managed', latest);
      return { ok: true };
    },
  };
}

test('a host without Evolver gets the latest installed and its Proxy started', async () => {
  const runtime = fakeRuntime();
  const outcome = await prepareEngine(runtime, null);
  assert.deepEqual(runtime.calls, [['npm', 'install'], ['managed', 'lifecycle', 'start']]);
  assert.deepEqual(outcome, { version: '2.0.44', source: 'managed', status: 'installed', proxyVersion: '2.0.44', at: NOW, failures: 0 });
  assert.match(engineNoticeOf(outcome), /was missing, so this plugin installed Evolver 2\.0\.44 and started its Proxy/);
});

test('an Evolver older than the minimum is upgraded, and a stale running Proxy restarted', async () => {
  const runtime = fakeRuntime({ managed: '2.0.42', running: '2.0.42' });
  const outcome = await prepareEngine(runtime, null);
  assert.deepEqual(runtime.calls, [['npm', 'install'], ['managed', 'lifecycle', 'restart']]);
  assert.equal(outcome.status, 'upgraded');
  assert.equal(outcome.previous, '2.0.42');
  assert.match(engineNoticeOf(outcome), /Evolver 2\.0\.42 was older than 2\.0\.44, so this plugin upgraded it to 2\.0\.44 and started its Proxy/);
});

test('an Evolver already on PATH that is new enough is used as it is', async () => {
  const runtime = fakeRuntime({ onPath: '2.1.0' });
  const outcome = await prepareEngine(runtime, null);
  assert.deepEqual(runtime.calls, [['path', 'lifecycle', 'start']]);
  assert.equal(outcome.status, 'started');
  assert.equal(outcome.source, 'path');
});

test('a running Proxy that is new enough is left alone', async () => {
  const runtime = fakeRuntime({ managed: '2.0.44', running: '2.0.44' });
  assert.equal((await prepareEngine(runtime, null)).status, 'ready');
  assert.deepEqual(runtime.calls, []);
});

test('a stale Proxy this plugin cannot restart asks the person to restart it', async () => {
  const runtime = fakeRuntime({ managed: '2.0.44', running: '2.0.40', startsProxy: false });
  const outcome = await prepareEngine(runtime, null);
  assert.equal(outcome.status, 'restart_needed');
  assert.equal(outcome.proxyVersion, '2.0.40');
  assert.match(engineNoticeOf(outcome), /evolver lifecycle restart/);
});

test('a failed install with nothing to fall back on backs off and says how to install by hand', async () => {
  const runtime = fakeRuntime({ installError: 'npm ERR! code ENOTFOUND' });
  const first = await prepareEngine(runtime, null);
  assert.deepEqual(first, { status: 'install_failed', error: 'npm ERR! code ENOTFOUND', at: NOW, failures: 1, retryAt: NOW + 10 * MINUTE });
  assert.equal(isSetupDue(first, NOW + 9 * MINUTE), false);
  assert.equal(isSetupDue(first, NOW + 10 * MINUTE), true);
  const third = await prepareEngine(runtime, { ...first, failures: 2 });
  assert.equal(third.retryAt, NOW + 40 * MINUTE);
  assert.equal((await prepareEngine(runtime, { ...first, failures: 20 })).retryAt, NOW + 24 * 60 * MINUTE);
  assert.match(engineNoticeOf(first), /Installing Evolver failed \(npm ERR! code ENOTFOUND\)\. To set it up by hand: `npm install -g @evomap\/evolver@latest`, then `evolver lifecycle start`\. The plugin retries automatically after/);
});

test('a failed upgrade still starts the older Evolver it has, and retries the upgrade later', async () => {
  const runtime = fakeRuntime({ managed: '2.0.42', installError: 'EACCES' });
  const outcome = await prepareEngine(runtime, null);
  assert.equal(outcome.status, 'outdated');
  assert.equal(outcome.failures, 0);
  assert.equal(outcome.installError, 'EACCES');
  assert.equal(outcome.installRetryAt, NOW + 6 * 60 * MINUTE);
  assert.deepEqual(runtime.calls, [['npm', 'install'], ['managed', 'lifecycle', 'start']]);
});

test('when npm still has nothing new enough, the upgrade is retried only every six hours', async () => {
  const runtime = fakeRuntime({ latest: '2.0.42' });
  const first = await prepareEngine(runtime, null);
  assert.equal(first.status, 'outdated');
  assert.equal(first.installRetryAt, NOW + 6 * 60 * MINUTE);

  const later = fakeRuntime({ managed: '2.0.42' });
  const second = await prepareEngine(later, first);
  assert.deepEqual(later.calls, [['managed', 'lifecycle', 'start']]);
  assert.equal(second.status, 'outdated');
  assert.equal(second.installRetryAt, first.installRetryAt);
  assert.match(engineNoticeOf(second), /Evolver 2\.0\.42 is the newest this plugin could install, and reuse evidence needs 2\.0\.44 or newer/);
});

test('a Proxy that does not come up is reported with its error and backed off', async () => {
  const runtime = fakeRuntime({ managed: '2.0.44', startError: 'public legacy mode needs EVOMAP_NODE_SECRET' });
  const outcome = await prepareEngine(runtime, null);
  assert.equal(outcome.status, 'start_failed');
  assert.equal(outcome.error, 'public legacy mode needs EVOMAP_NODE_SECRET');
  assert.equal(outcome.retryAt, NOW + 10 * MINUTE);
  assert.match(engineNoticeOf(outcome), /Check ~\/\.evomap\/logs\/evolver-proxy\.log, then run `evolver lifecycle start`/);

  const silent = await prepareEngine(fakeRuntime({ managed: '2.0.44', startsProxy: false }), null);
  assert.equal(silent.error, 'the Proxy did not answer within the wait');
});

test('a Node.js too old for Evolver is reported without trying anything', async () => {
  for (const node of ['20.19.0', '22.12.0', '23.3.0']) {
    const runtime = fakeRuntime({ node });
    const outcome = await prepareEngine(runtime, null);
    assert.equal(outcome.status, 'node_unsupported', node);
    assert.deepEqual(runtime.calls, []);
  }
  for (const node of ['22.13.0', '23.4.0', '24.1.0']) assert.notEqual((await prepareEngine(fakeRuntime({ node }), null)).status, 'node_unsupported', node);
});

test('a success clears earlier failures', async () => {
  const outcome = await prepareEngine(fakeRuntime(), { status: 'install_failed', failures: 3, retryAt: NOW - 1 });
  assert.equal(outcome.failures, 0);
  assert.equal(outcome.retryAt, undefined);
});

test('an upgrade whose restart leaves the old Proxy running asks for a restart instead of claiming success', async () => {
  const runtime = fakeRuntime({ managed: '2.0.42', running: '2.0.42', startsProxy: false });
  const outcome = await prepareEngine(runtime, null);
  assert.equal(outcome.status, 'restart_needed');
  assert.equal(outcome.previous, '2.0.42');
});

test('a running Proxy that does not report its version is not taken as new enough', async () => {
  const runtime = fakeRuntime({ managed: '2.0.44' });
  runtime.runningProxy = async () => ({ version: null });
  runtime.waitForProxy = async () => ({ version: null });
  const outcome = await prepareEngine(runtime, null);
  assert.deepEqual(runtime.calls, [['managed', 'lifecycle', 'restart']]);
  assert.equal(outcome.status, 'restart_needed');
});

test('an unexpected error during setup is recorded as a failure and backed off', async () => {
  const outcome = setupErrorOutcome(new Error('EACCES: permission denied, mkdir'), { failures: 1 }, NOW);
  assert.deepEqual(outcome, { status: 'setup_error', error: 'EACCES: permission denied, mkdir', at: NOW, failures: 2, retryAt: NOW + 20 * MINUTE });
  assert.doesNotMatch(setupErrorOutcome(new Error('npm ERR! 401 token=npm_abcdefghijklmnop'), null, NOW).error, /npm_abcdefghijklmnop/);
  assert.match(engineNoticeOf(outcome), /stopped on an unexpected error \(EACCES: permission denied, mkdir\)/);
});
