import { takeUnreported } from './injected-assets.mjs';
import { queueReports } from './report-queue.mjs';
import { rememberForRetention } from './retention-pending.mjs';
import { immediateReportOf, reportedReuseOf } from './reuse.mjs';
import { candidateOf, dropTurnCandidate, rememberCandidate, skipReason } from './session-distill.mjs';
import { takeTurnRecord } from './turn-record.mjs';
import { outcomeOfReason } from './turn-outcomes.mjs';

function reportsOf(assets, { sessionId, turn, reasonKind, record }) {
  return assets.map((asset) => immediateReportOf({
    asset,
    sessionId,
    turn: turn ?? asset.turn,
    reasonKind,
    checks: record.checks,
  }));
}

export function abortedReports(assets) {
  return assets.map((asset) => ({
    report: reportsOf([asset], { sessionId: asset.sessionId, reasonKind: 'aborted', record: { checks: [] } })[0],
    sessionId: asset.sessionId,
  }));
}

function answerOf(answer) {
  return typeof answer === 'string' ? answer.trim() : '';
}

function storedRecordOf({ checks, commands, paths, edits, answer }) {
  return { checks, commands, paths, edits, answer };
}

function rememberTurnCandidate({ sessionId, session, reasonKind, record, model, ownerPid }) {
  if (skipReason(reasonKind, record)) return false;
  rememberCandidate(sessionId, candidateOf({ prompt: session.prompt, record, model, turn: session.turn, pid: ownerPid() }));
  return true;
}

/**
 * Every injected strategy is reported when its turn ends, with the turn's own evidence; the turn itself becomes
 * the session's distillation candidate when it finished verified. Returns the reuses the next prompt may label,
 * the names of the strategies the turn reused, whether anything was queued, and the turn's record and changed
 * lines. `ownerPid` is only asked when a candidate is written.
 */
export function closeTurn({ sessionId, session, reasonKind, answer, model, projectDir, ownerPid = () => null }) {
  const record = { ...takeTurnRecord(sessionId), answer: answerOf(answer) };
  if (!outcomeOfReason(reasonKind)) return { reuses: [], reusedNames: [], queued: false, record: storedRecordOf(record), changedLines: record.changedLines };
  const taken = takeUnreported(sessionId, session.turn);
  const reports = reportsOf(taken, { sessionId, turn: session.turn, reasonKind, record });
  const reuses = reports.map(reportedReuseOf);
  queueReports(reports.map((report) => ({ report, sessionId })));
  rememberForRetention({ sessionId, projectDir, reuses, editedBefore: record.editedBefore });
  rememberTurnCandidate({ sessionId, session, reasonKind, record, model, ownerPid });
  return {
    reuses,
    reusedNames: taken.map((asset) => asset.title),
    queued: reports.length > 0,
    record: storedRecordOf(record),
    changedLines: record.changedLines,
  };
}

/**
 * A Stop hook that blocked continues the turn, and Codex runs Stop again at its end. The reuse reports went
 * out at the first Stop and cannot be taken back, but the continuation's work joins the turn's record, so the
 * candidate is judged on the whole turn: written again when it still ended verified, dropped when not.
 */
export function continueTurn({ sessionId, session, answer, model, ownerPid = () => null }) {
  const added = takeTurnRecord(sessionId);
  const before = session.stoppedRecord;
  const record = {
    checks: [...before.checks, ...added.checks],
    commands: [...before.commands, ...added.commands],
    paths: [...before.paths, ...added.paths],
    edits: [...before.edits, ...added.edits],
    answer: answerOf(answer) || before.answer,
  };
  if (!rememberTurnCandidate({ sessionId, session, reasonKind: 'completed', record, model, ownerPid })) {
    dropTurnCandidate(sessionId, session.turn);
  }
  return storedRecordOf(record);
}
