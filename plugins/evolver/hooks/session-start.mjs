#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, ENGINE_TASK, startInBackground } from '../lib/background.mjs';
import { engineNoticeOf } from '../lib/engine-notice.mjs';
import { isSetupDue } from '../lib/engine-setup.mjs';
import { isAnnounced, markAnnounced, readEngineState } from '../lib/engine-state.mjs';
import { meetsMinimum } from '../lib/engine-version.mjs';
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { queueOrphanedUnreported } from '../lib/injected-assets.mjs';
import { hostProcess } from '../lib/process-owner.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { runningProxy } from '../lib/proxy.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { retentionReportsOf, takeDueRetentions } from '../lib/retention-pending.mjs';
import { abortedReports } from '../lib/turn-end.mjs';

function queueLeftReports(sessionId, projectDir) {
  const { due, commit } = takeDueRetentions({ sessionId, projectDir });
  queueReports(due.flatMap(retentionReportsOf));
  commit();
  queueOrphanedUnreported((orphaned) => queueReports(abortedReports(orphaned)));
}

// Setting Evolver up takes minutes, so it runs in the background and only its outcome is told, once.
function engineNoticeOnce(outcome) {
  if (!outcome || isAnnounced(outcome)) return null;
  markAnnounced(outcome);
  return engineNoticeOf(outcome);
}

async function isEngineSetupDue(outcome) {
  const running = await runningProxy();
  return !(running && meetsMinimum(running.version)) && isSetupDue(outcome, Date.now());
}

async function sessionStart(input) {
  const sessionId = sessionIdOf(input);
  if (!sessionId) return '';
  queueLeftReports(sessionId, projectDirOf(input));
  const outcome = readEngineState();
  const tasks = [...(await isEngineSetupDue(outcome) ? [ENGINE_TASK] : []), DRAIN_TASK, DISTILL_TASK];
  startInBackground(tasks, { codexExecutable: hostProcess()?.executable });
  return engineNoticeOnce(outcome) ?? '';
}

runHook('SessionStart', sessionStart);
