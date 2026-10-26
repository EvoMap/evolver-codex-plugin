#!/usr/bin/env node
import { CODEX_OPTION, DISTILL_TASK, DRAIN_TASK, ENGINE_TASK } from '../lib/background.mjs';
import { codexModelRunner } from '../lib/codex-exec.mjs';
import { DISTILL_TIMEOUT_MS, distillLeftovers } from '../lib/distiller.mjs';
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

function codexExecutableOf(argv) {
  const index = argv.indexOf(CODEX_OPTION);
  return index === -1 ? 'codex' : argv[index + 1];
}

const argv = process.argv.slice(2);
const tasks = new Set(argv);
const results = [await ranCleanly(() => pruneOldSessions())];
if (tasks.has(ENGINE_TASK)) results.push(await ranCleanly(() => setUpEngine(engineRuntime())));
if (tasks.has(DRAIN_TASK)) {
  results.push(await ranCleanly(() => drainOutbox({ proxyFetch: createProxyClient(), recordLocally: recordReuseLocally })));
}
if (tasks.has(DISTILL_TASK)) {
  results.push(await ranCleanly(() => distillLeftovers({
    proxyFetch: createProxyClient({ timeoutMs: DISTILL_TIMEOUT_MS }),
    runModel: codexModelRunner({ executable: codexExecutableOf(argv) }),
  })));
}
process.exit(results.every(Boolean) ? 0 : 1);
