import { isOlderThan, meetsMinimum, nodeRunsEvolver } from './engine-version.mjs';
import { withoutSecrets } from './redact.mjs';

const RETRY_BASE_MS = 10 * 60 * 1000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1000;
const OUTDATED_INSTALL_RETRY_MS = 6 * 60 * 60 * 1000;

export const FAILURES = new Set(['node_unsupported', 'install_failed', 'start_failed', 'setup_error']);

export function isSetupDue(previous, now) {
  return !(previous?.retryAt > now);
}

function isInstallDue(previous, now) {
  return !(previous?.installRetryAt > now);
}

function newerOf(left, right) {
  if (!left) return right;
  if (!right) return left;
  return isOlderThan(left.version, right.version) ? right : left;
}

function usableEngine(managed, onPath) {
  const usable = [managed, onPath].find((engine) => engine && meetsMinimum(engine.version));
  return usable ?? newerOf(managed, onPath);
}

async function installedEngine(runtime, found) {
  const install = await runtime.installLatest();
  const managed = install.ok ? await runtime.managedEngine() : null;
  if (!managed) return { engine: found, installError: install.error ?? 'npm finished but @evomap/evolver is missing' };
  return { engine: managed, installed: found ? 'upgraded' : 'installed', previous: found?.version };
}

async function engineToRun(runtime, previous, now) {
  const found = usableEngine(await runtime.managedEngine(), await runtime.pathEngine());
  if (found && meetsMinimum(found.version)) return { engine: found };
  if (!isInstallDue(previous, now)) return { engine: found };
  return installedEngine(runtime, found);
}

async function proxyAfter(runtime, engine, action) {
  const ran = await engine.run(['lifecycle', action]);
  const running = await runtime.waitForProxy(action === 'restart' ? (proxy) => !isOutdated(proxy) : undefined);
  return running ? { running } : { startError: ran.ok ? 'the Proxy did not answer within the wait' : ran.error };
}

async function ensureProxy(runtime, engine) {
  const running = await runtime.runningProxy();
  if (!running) return { action: 'started', ...(await proxyAfter(runtime, engine, 'start')) };
  const isStale = isOutdated(running) && meetsMinimum(engine.version) && running.version !== engine.version;
  if (!isStale) return { running };
  return { action: 'restarted', ...(await proxyAfter(runtime, engine, 'restart')) };
}

function isOutdated(running) {
  return !meetsMinimum(running?.version);
}

function retryDelay(failures) {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}

function settled(outcome, previous, now) {
  const failures = FAILURES.has(outcome.status) ? (previous?.failures ?? 0) + 1 : 0;
  const isOutdated = outcome.version && !meetsMinimum(outcome.version);
  return {
    ...outcome,
    at: now,
    failures,
    ...(failures > 0 && { retryAt: now + retryDelay(failures) }),
    ...(isOutdated && { installRetryAt: previous?.installRetryAt > now ? previous.installRetryAt : now + OUTDATED_INSTALL_RETRY_MS }),
  };
}

function statusOf({ installed, action, running, engine }) {
  if (!meetsMinimum(engine.version)) return 'outdated';
  if (isOutdated(running)) return 'restart_needed';
  if (installed) return installed;
  if (action === 'started' || action === 'restarted') return action;
  return 'ready';
}

export function setupErrorOutcome(error, previous, now) {
  return settled({ status: 'setup_error', error: withoutSecrets(String(error?.message ?? error)).slice(0, 300) }, previous, now);
}

export async function prepareEngine(runtime, previous) {
  const now = runtime.now();
  if (!nodeRunsEvolver(runtime.nodeVersion)) {
    return settled({ status: 'node_unsupported', node: runtime.nodeVersion }, previous, now);
  }
  const { engine, installed, previous: replaced, installError } = await engineToRun(runtime, previous, now);
  if (!engine) return settled({ status: 'install_failed', error: installError }, previous, now);
  const proxy = await ensureProxy(runtime, engine);
  const base = { version: engine.version, source: engine.source, ...(replaced && { previous: replaced }), ...(installError && { installError }) };
  if (!proxy.running) return settled({ ...base, status: 'start_failed', installed, error: proxy.startError }, previous, now);
  const status = statusOf({ installed, action: proxy.action, running: proxy.running, engine });
  return settled({ ...base, status, proxyVersion: proxy.running.version ?? null }, previous, now);
}
