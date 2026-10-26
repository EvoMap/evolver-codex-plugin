#!/usr/bin/env node
import { DISTILL_SESSION_TASK, DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { cliJobResult, startCliJob } from '../lib/cli-job.mjs';
import { feedbackLabelOf } from '../lib/feedback-label.mjs';
import { runHook, sessionIdOf } from '../lib/hook-io.mjs';
import { injectedIds, rememberInjected } from '../lib/injected-assets.mjs';
import { hubGene, promptTextOf } from '../lib/prime.mjs';
import { hostProcess } from '../lib/process-owner.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { answerPromptCommand, promptCommandOf } from '../lib/prompt-commands.mjs';
import { createProxyClient } from '../lib/proxy.mjs';
import { recordRecall } from '../lib/recall-log.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { correctionReportOf } from '../lib/reuse.mjs';
import { dropCandidate } from '../lib/session-distill.mjs';
import { statusReport } from '../lib/status-report.mjs';
import { closeOpenTurn, readSession, updateSession } from '../lib/session-state.mjs';
import { closeTurn } from '../lib/turn-end.mjs';
import { forgetTurnRecord } from '../lib/turn-record.mjs';

const RECALL_TIMEOUT_MS = 6_000;
const COMMAND_PROXY_TIMEOUT_MS = 6_000;
const CLI_WAIT_MS = 6_000;

// Codex runs no Stop or Interrupt hook for a turn that ended on an error, so a turn still open when the next
// prompt arrives is closed here as one.
function closeFailedTurn(sessionId, input) {
  const session = closeOpenTurn(sessionId);
  if (!session) return { labelable: readSession(sessionId).labelable, queued: false };
  const { reuses, queued } = closeTurn({ sessionId, session, reasonKind: 'error', answer: '', model: null, projectDir: projectDirOf(input) });
  return { labelable: reuses, queued };
}

// The next prompt is the only verdict on a turn available without asking anyone: when it reads as a
// correction, the reuse reports are revised and the turn is no longer worth distilling.
function reportFollowUp(sessionId, labelable, prompt) {
  if (!prompt) return false;
  const label = feedbackLabelOf(prompt);
  if (label === 'correction') dropCandidate(sessionId);
  const reports = labelable.map((reuse) => correctionReportOf(reuse, label)).filter((report) => report !== null);
  queueReports(reports.map((report) => ({ report, sessionId })));
  return reports.length > 0;
}

function openTurn(sessionId, input, prompt) {
  forgetTurnRecord(sessionId);
  return updateSession(sessionId, (session) => ({
    ...session, turn: session.turn + 1, turnId: input.turn_id ?? null, closed: false, prompt, labelable: [],
  }));
}

async function recalledStrategy(sessionId, turn, prompt) {
  const match = await hubGene(createProxyClient({ timeoutMs: RECALL_TIMEOUT_MS }), promptTextOf(prompt), {
    listedIds: injectedIds(sessionId),
    onOutcome: recordRecall,
  });
  const [assetId] = match.ids;
  if (!assetId) return '';
  rememberInjected(sessionId, assetId, { turn, title: match.title, pid: hostProcess()?.pid ?? null });
  return match.text;
}

// An engine command that outlasts the wait keeps running in its own process; its result lands in the log.
async function runCliJob(args, cwd) {
  const job = await cliJobResult(startCliJob(args, cwd), { waitMs: CLI_WAIT_MS });
  if (job) return { kind: job.kind, text: job.text };
  return { kind: 'success', text: `evolver ${args[0]} is still running in the background (ten minutes at most); evolver-status shows how it ended.` };
}

function answerCommand(command, sessionId, input) {
  const proxyFetch = createProxyClient({ timeoutMs: COMMAND_PROXY_TIMEOUT_MS });
  return answerPromptCommand(command, {
    sessionId,
    runCli: (args) => runCliJob(args, projectDirOf(input)),
    status: () => statusReport(proxyFetch),
    search: (text) => proxyFetch('POST', '/asset/search', { text, limit: 5 }),
    startDistill: (id, focus) => startInBackground([DISTILL_SESSION_TASK], {
      codexExecutable: hostProcess()?.executable,
      session: { sessionId: id, focus },
    }),
  });
}

async function promptContext(input) {
  const sessionId = sessionIdOf(input);
  if (!sessionId) return '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const command = promptCommandOf(prompt);
  const answer = command ? await answerCommand(command, sessionId, input) : null;
  // A command answered here is no turn: it opens none, labels nothing and recalls nothing.
  if (answer?.blockReason) return answer;
  if (input.turn_id && input.turn_id === readSession(sessionId).turnId) return '';
  const closed = closeFailedTurn(sessionId, input);
  const followedUp = reportFollowUp(sessionId, closed.labelable, prompt);
  if (closed.queued || followedUp) startInBackground([DRAIN_TASK]);
  const { turn } = openTurn(sessionId, input, prompt);
  return answer ? answer.context : recalledStrategy(sessionId, turn, prompt);
}

runHook('UserPromptSubmit', promptContext);
