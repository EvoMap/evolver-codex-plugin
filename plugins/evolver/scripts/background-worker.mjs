#!/usr/bin/env node
import { CODEX_OPTION, DISTILL_SESSION_TASK, DISTILL_TASK, DRAIN_TASK, ENGINE_TASK, FOCUS_OPTION, SESSION_OPTION } from '../lib/background.mjs';
import { codexModelRunner } from '../lib/codex-exec.mjs';
import { DISTILL_TIMEOUT_MS, distillLeftovers, distillSession } from '../lib/distiller.mjs';
import { setUpEngine } from '../lib/engine-job.mjs';
import { engineRuntime } from '../lib/engine-runtime.mjs';
import { recordReuseLocally } from '../lib/local-ledger.mjs';
import { createProxyClient } from '../lib/proxy.mjs';
import { drainOutbox } from '../lib/report-queue.mjs';
import { pruneOldSessions } from '../lib/session-state.mjs';

async function ranCleanly(work) {
  try {
    await work();
    return true;
  } catch {
    return false;
  }
}

function optionOf(argv, option, fallback) {
  const index = argv.indexOf(option);
  return index === -1 ? fallback : argv[index + 1];
}

const argv = process.argv.slice(2);
const tasks = new Set(argv);
const results = [await ranCleanly(() => pruneOldSessions())];
if (tasks.has(ENGINE_TASK)) results.push(await ranCleanly(() => setUpEngine(engineRuntime())));
if (tasks.has(DRAIN_TASK)) {
  results.push(await ranCleanly(() => drainOutbox({ proxyFetch: createProxyClient(), recordLocally: recordReuseLocally })));
}
const distillDeps = () => ({
  proxyFetch: createProxyClient({ timeoutMs: DISTILL_TIMEOUT_MS }),
  runModel: codexModelRunner({ executable: optionOf(argv, CODEX_OPTION, 'codex') }),
});
if (tasks.has(DISTILL_SESSION_TASK)) {
  const sessionId = optionOf(argv, SESSION_OPTION, null);
  results.push(await ranCleanly(() => distillSession(sessionId, { ...distillDeps(), focus: optionOf(argv, FOCUS_OPTION, '') })));
}
if (tasks.has(DISTILL_TASK)) results.push(await ranCleanly(() => distillLeftovers(distillDeps())));
process.exit(results.every(Boolean) ? 0 : 1);
