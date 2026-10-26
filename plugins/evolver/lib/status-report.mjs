import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { engineNoticeOf } from './engine-notice.mjs';
import { engineDir } from './engine-runtime.mjs';
import { readEngineState } from './engine-state.mjs';
import { MIN_EVOLVER_VERSION } from './engine-version.mjs';
import { readDistillLog } from './distill-log.mjs';
import { describeProxyEndpoint } from './proxy.mjs';
import { readRecallLog } from './recall-log.mjs';
import { outboxPath } from './report-queue.mjs';
import { pendingPath } from './session-distill.mjs';
import { readState } from './state-file.mjs';

const RECENT_REPORTS = 5;

const line = (mark, label, value) => `${mark} ${label}: ${value}`;
const at = (ms) => (ms ? new Date(ms).toISOString() : '(never)');

function proxyLines(proxy) {
  const endpoint = describeProxyEndpoint();
  if (!proxy.ok) return [line('MISSING', 'Proxy', proxy.error)];
  const version = endpoint.running_version ? `, Evolver ${endpoint.running_version}` : '';
  return [line('OK', 'Proxy', `${proxy.data?.status ?? 'answering'} at ${endpoint.url}${version}`)];
}

function engineLines(outcome) {
  const lines = [line('INFO', 'Required Evolver', `${MIN_EVOLVER_VERSION} or newer`), line('INFO', 'Plugin-managed install', engineDir())];
  if (!outcome) return [...lines, line('INFO', 'Engine setup', 'not run yet; it runs in the background at the next session start')];
  const mark = outcome.failures > 0 ? 'FAIL' : 'OK';
  lines.push(line(mark, 'Engine setup', `${outcome.status} at ${at(outcome.at)}${outcome.version ? `, Evolver ${outcome.version} (${outcome.source})` : ''}`));
  const notice = engineNoticeOf(outcome);
  return notice ? [...lines, `     ${notice.replace(/^\[Evolver\] /, '')}`] : lines;
}

function recallLines({ last, counts }) {
  if (!last) return [line('INFO', 'Recall', 'no prompt recalled yet')];
  const tally = Object.entries(counts ?? {}).map(([status, count]) => `${status}=${count}`).join(' ');
  return [line('INFO', 'Recall', `last ${last.status}${last.asset_id ? ` ${last.asset_id}` : ''} at ${last.at}; ${tally}`)];
}

function receiptPhrase(receipt = {}) {
  const parts = ['eligible', 'counted', 'weight'].filter((field) => receipt[field] !== undefined).map((field) => `${field}=${receipt[field]}`);
  if (receipt.reason) parts.push(`reason=${receipt.reason}`);
  return parts.length > 0 ? parts.join(' ') : 'recorded';
}

function reportLines(outbox) {
  const entries = Object.values(outbox);
  const pending = entries.filter((entry) => !entry.sentAt && !entry.rejectedAt);
  const delivered = entries.filter((entry) => entry.sentAt).sort((a, b) => b.sentAt - a.sentAt).slice(0, RECENT_REPORTS);
  const rejected = entries.filter((entry) => entry.rejectedAt).sort((a, b) => b.rejectedAt - a.rejectedAt).slice(0, RECENT_REPORTS);
  return [
    line('INFO', 'Reuse reports', `${pending.length} waiting, ${delivered.length ? 'recent deliveries below' : 'none delivered yet'}`),
    ...delivered.map((entry) => `     sent ${at(entry.sentAt)} ${entry.report.task_id} ${entry.report.asset_id} tier=${entry.report.evidence.tier} ${receiptPhrase(entry.receipt)}`),
    ...rejected.map((entry) => {
      const { reason, status } = entry.rejection ?? {};
      return `     REJECTED ${at(entry.rejectedAt)} ${entry.report.task_id} ${entry.report.asset_id} reason=${reason}${status ? ` status=${status}` : ''}`;
    }),
  ];
}

function lastDistillLine({ last, counts }) {
  if (!last) return [];
  const tally = Object.entries(counts ?? {}).map(([status, count]) => `${status}=${count}`).join(' ');
  return [`     last distillation ${last.status} for ${last.sessionId} at ${last.at}${last.error ? ` (${last.error})` : ''}; ${tally}`];
}

function candidateLines(pending, distillLog) {
  const sessions = Object.entries(pending);
  if (sessions.length === 0) return [line('INFO', 'Distillation', 'no candidate waiting'), ...lastDistillLine(distillLog)];
  return [
    line('INFO', 'Distillation', `${sessions.length} candidate(s) waiting`),
    ...sessions.map(([sessionId, candidate]) => `     ${sessionId} turn ${candidate.turn} attempts=${candidate.attempts ?? 0}${candidate.closed ? ' closed' : ''}`),
    ...lastDistillLine(distillLog),
  ];
}

function claimLines() {
  const claimUrlPath = path.join(os.homedir(), '.evomap', 'claim_url');
  try {
    const url = fs.readFileSync(claimUrlPath, 'utf8').trim();
    return [
      'INFO Network: node registered but NOT YET CLAIMED.',
      `     To connect, sign in to https://evomap.ai and open this link: ${url}`,
      "     That's the only step — no id or secret to find. Local memory works regardless.",
    ];
  } catch {
    return ['INFO Network: local memory works with zero config; no pending claim link.'];
  }
}

export async function statusReport(proxyFetch) {
  const proxy = await proxyFetch('GET', '/proxy/status');
  return [
    'Evolver Codex plugin status',
    line('INFO', 'Node.js', process.version),
    ...proxyLines(proxy),
    ...engineLines(readEngineState()),
    ...recallLines(readRecallLog()),
    ...reportLines(readState(outboxPath(), {})),
    ...candidateLines(readState(pendingPath(), {}), readDistillLog()),
    ...claimLines(),
  ].join('\n');
}
