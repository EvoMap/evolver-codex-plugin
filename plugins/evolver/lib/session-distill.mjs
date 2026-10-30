import { outcomeOfDistill } from './distill-receipt.mjs';
import { ownerIsGone } from './process-owner.mjs';
import { withoutSecrets } from './redact.mjs';
import { readState, statePath, updateState } from './state-file.mjs';

// Distillation runs once a session, at its end, and outside the agent's conversation: each turn that
// finished verified only leaves a candidate on disk, the latest one wins, and the session end (or, after a
// session that was killed, the next session start) turns it into a Gene with one model call over a digest of
// the turn. A candidate leaves the disk only once distilled or given up after MAX_ATTEMPTS failed tries.

const PROMPT_MAX_CHARS = 6_000;
const ANSWER_MAX_CHARS = 3_000;
const COMMAND_MAX_CHARS = 300;
const MAX_COMMANDS = 40;
const LIST_FIELDS = ['strategy', 'validation', 'signals', 'preconditions'];
const ARGUMENT_FIELDS = ['title', 'summary', ...LIST_FIELDS];
const ITEM_NUMBER = /^\s*(?:\d+[.)]|[-*•])\s+/;
const MAX_ATTEMPTS = 3;

// A file of its own, so a dsh or Claude Code process never claims a Codex candidate.
export const pendingPath = () => statePath('codex-distill-pending.json');

/**
 * Why a finished turn leaves no candidate, or null when it does. A chat reply without a single command has no
 * method to keep. A turn that reused an injected strategy is distilled too: the engine's intake drops a Gene
 * that repeats one it already has.
 */
export function skipReason(reasonKind, record) {
  if (reasonKind !== 'completed') return 'not_completed';
  if (!record.answer) return 'no_answer';
  if (record.checks.at(-1)?.failed) return 'failed_check';
  if (record.commands.length === 0 && record.edits.length === 0) return 'no_tool_use';
  return null;
}

/** The model the session's turn ran on, as Codex names it in the hook input: the distillation runs on it. */
export function modelOf(hookInput) {
  return typeof hookInput?.model === 'string' && hookInput.model ? { model: hookInput.model } : null;
}

// Keys and tokens are stripped before anything is written to disk or sent to a model or the Proxy.
export function candidateOf({ prompt, record, model, turn, pid = null, now = Date.now() }) {
  return {
    prompt: withoutSecrets(String(prompt ?? '')).slice(0, PROMPT_MAX_CHARS),
    commands: record.commands.slice(-MAX_COMMANDS).map((command) => withoutSecrets(command).slice(0, COMMAND_MAX_CHARS)),
    paths: [...new Set(record.paths)].map((path) => withoutSecrets(path)),
    checks: record.checks.map(({ command, failed }) => ({ command: withoutSecrets(command), failed })),
    answer: withoutSecrets(record.answer).slice(0, ANSWER_MAX_CHARS),
    model,
    turn,
    pid,
    attempts: 0,
    at: now,
  };
}

export function rememberCandidate(sessionId, candidate) {
  if (!sessionId) return;
  updateState(pendingPath(), {}, (pending) => ({ ...pending, [sessionId]: candidate }));
}

export function dropCandidate(sessionId) {
  if (!sessionId) return;
  updateState(pendingPath(), {}, (pending) => {
    if (!(sessionId in pending)) return undefined;
    const { [sessionId]: dropped, ...rest } = pending;
    return rest;
  });
}

/** Drops the session's candidate only when it is the one `turn` left, not an earlier turn's. */
export function dropTurnCandidate(sessionId, turn) {
  updateState(pendingPath(), {}, (pending) => {
    if (pending[sessionId]?.turn !== turn) return undefined;
    const { [sessionId]: dropped, ...rest } = pending;
    return rest;
  });
}

/** Whether this is still the session's candidate on disk: not dropped by a correction, nor replaced by a newer one. */
export function isCurrentCandidate(sessionId, candidate) {
  return readState(pendingPath(), {})[sessionId]?.at === candidate.at;
}

/** A session that ended keeps its candidate due, so a distillation that failed at its end is tried again. */
export function closeCandidate(sessionId) {
  if (!sessionId) return;
  updateState(pendingPath(), {}, (pending) => (pending[sessionId]
    ? { ...pending, [sessionId]: { ...pending[sessionId], closed: true } }
    : undefined));
}

// A candidate is up for distillation again once its session is over and no live process is working on it.
function leftover(candidate, isGone) {
  const over = Boolean(candidate?.closed) || isGone(candidate?.pid);
  return over && isUnclaimed(candidate, isGone);
}

function isUnclaimed(candidate, isGone) {
  return !candidate?.claimedBy || isGone(candidate.claimedBy);
}

/** This session's own candidate, if it has one. Left on disk until settled. */
export function dueCandidates({ sessionId }) {
  const candidate = readState(pendingPath(), {})[sessionId];
  return candidate ? [{ sessionId, candidate }] : [];
}

/** The session whose candidate was written last, the one a distillation asked for without a session id is for. */
export function latestCandidateSession() {
  const [latest] = Object.entries(readState(pendingPath(), {})).sort(([, left], [, right]) => right.at - left.at);
  return latest?.[0] ?? null;
}

function claimWhere(isDue, pid) {
  const claimed = [];
  updateState(pendingPath(), {}, (pending) => {
    const next = { ...pending };
    for (const [sessionId, candidate] of Object.entries(pending)) {
      if (!isDue(sessionId, candidate) || candidate.claimedBy === pid) continue;
      next[sessionId] = { ...candidate, claimedBy: pid };
      claimed.push({ sessionId, candidate: next[sessionId] });
    }
    return claimed.length > 0 ? next : undefined;
  });
  return claimed;
}

/**
 * The candidates of sessions that are over — ended, or killed with their Codex process — claimed for this
 * process under the state lock, so two workers starting at once cannot distill the same one twice. An idle
 * session whose Codex process still runs keeps its candidate however long it waits.
 */
export function claimLeftoverCandidates({ isGone = ownerIsGone, pid = process.pid } = {}) {
  return claimWhere((sessionId, candidate) => leftover(candidate, isGone), pid);
}

/** One session's candidate, claimed for a distillation asked for now, unless a live process is already on it. */
export function claimSessionCandidate(sessionId, { isGone = ownerIsGone, pid = process.pid } = {}) {
  return claimWhere((id, candidate) => id === sessionId && isUnclaimed(candidate, isGone), pid);
}

/**
 * Removes a candidate once it was distilled, or counts a failed try and gives up after MAX_ATTEMPTS. A
 * newer candidate the session wrote meanwhile is left alone.
 */
export function settleCandidate(sessionId, candidate, { sent }) {
  updateState(pendingPath(), {}, (pending) => {
    const current = pending[sessionId];
    if (!current || current.at !== candidate.at) return undefined;
    const attempts = (current.attempts ?? 0) + 1;
    if (sent || attempts >= MAX_ATTEMPTS) {
      const { [sessionId]: settled, ...rest } = pending;
      return rest;
    }
    return { ...pending, [sessionId]: { ...current, attempts, claimedBy: null } };
  });
}

export function distillPrompt(candidate, focus = '') {
  const lines = (items, render) => items.map(render).join('\n') || '(none)';
  const focusText = withoutSecrets(String(focus ?? ''));
  return [
    'Below is the record of a task an agent has just finished and verified. Turn it into one reusable Gene:',
    'a method another agent could follow on a similar task, written for the kind of data or system involved,',
    'not for these files, names or values. Do not include the answer itself.',
    ...(focusText ? [`Focus on: ${focusText}`] : []),
    'Answer with a JSON object only, with these fields:',
    '  title: short capability name',
    '  summary: what was solved and under which conditions',
    '  strategy: ordered, reproducible steps',
    '  validation: checks that proved the result',
    '  signals: keywords of the problem this generalizes to',
    '  preconditions: when the method applies',
    '',
    '## Task',
    candidate.prompt,
    '',
    '## Commands run',
    lines(candidate.commands, (command) => `- ${command}`),
    '',
    '## Files read or written',
    lines(candidate.paths, (path) => `- ${path}`),
    '',
    '## Checks',
    lines(candidate.checks, (check) => `- ${check.failed ? 'FAILED' : 'passed'}: ${check.command}`),
    '',
    '## Final answer',
    candidate.answer,
  ].join('\n');
}

// Models sometimes write a list field as one numbered paragraph ("1. … 2. …"), which the core reads as one step.
function listOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  return value.split(/\n+|(?<=\.)\s+(?=\d+[.)]\s)/).map((item) => item.replace(ITEM_NUMBER, '').trim()).filter(Boolean);
}

export function argumentsOf(text) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed?.summary !== 'string' || !parsed.summary.trim()) return null;
    for (const field of LIST_FIELDS) if (field in parsed) parsed[field] = listOf(parsed[field]);
    return Object.fromEntries(ARGUMENT_FIELDS.filter((field) => parsed[field] !== undefined).map((field) => [field, parsed[field]]));
  } catch {
    return null;
  }
}

export function distillBody(candidate, args, usage) {
  return {
    platform: 'codex',
    trigger: 'session_end',
    user_prompt: candidate.prompt,
    // The core rejects a Gene that repeats this answer's values (answer_leak).
    final_answer: candidate.answer,
    ...args,
    execution: { trace: candidate.checks.map((check) => ({ command: check.command, exit: check.failed ? 1 : 0 })) },
    persist: true,
    publish: false,
    ...(usage ? { distill_usage: usage } : {}),
  };
}

/**
 * Distill one candidate through `runModel(model, prompt, signal)`, Codex run headless on the session's own model.
 * `cancel` stops it and `isCurrent` is asked once more before anything is persisted, since the candidate may have
 * been dropped while the model answered. Resolves to what happened; never throws.
 */
export async function distillCandidate({ proxyFetch, runModel, candidate, focus, timeoutMs, cancel, isCurrent = () => true }) {
  if (!runModel || !candidate?.model?.model) return { status: 'no_model' };
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(cancel ? [cancel] : [])]);
  try {
    const { answer, usage } = await runModel(candidate.model.model, distillPrompt(candidate, focus), signal);
    if (cancel?.aborted) return { status: 'dropped', usage };
    const args = argumentsOf(answer);
    if (!args) return { status: 'unparsed', usage };
    if (!isCurrent()) return { status: 'dropped', usage };
    const result = await proxyFetch('POST', '/conversation/distill', distillBody(candidate, args, usage), signal);
    return outcomeOfDistill(result, usage);
  } catch (error) {
    if (cancel?.aborted) return { status: 'dropped' };
    if (error?.code === 'ENOENT') return { status: 'no_model', error: 'no codex executable to run the distillation' };
    return { status: 'failed', error: String(error?.message ?? error) };
  }
}
