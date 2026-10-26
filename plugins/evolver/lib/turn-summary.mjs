import { referenceReuseSavings, usdOf } from './savings.mjs';

const NAME_MAX_CHARS = 48;

function compactTokens(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function goalLine(lastCheck) {
  if (!lastCheck) return '○ Unverified (no check ran)';
  return lastCheck.failed
    ? `✗ Goal not reached (last check failed: ${lastCheck.command})`
    : `✓ Goal reached (last check passed: ${lastCheck.command})`;
}

// A saving is claimed only for a reuse a passing check vouched for, and never above what the turn itself spent:
// the estimator prices deriving a whole approach from scratch, which a single answered question never cost.
function savingOf({ lastCheck, changedLines, freshTokens }) {
  if (!lastCheck || lastCheck.failed || freshTokens === null) return null;
  return Math.min(referenceReuseSavings(changedLines), freshTokens);
}

function reuseLine(turn) {
  const names = turn.reusedNames.map((name) => `"${String(name).slice(0, NAME_MAX_CHARS)}"`).join(', ');
  const usedPart = turn.freshTokens === null ? '' : ` · this turn used ${compactTokens(turn.freshTokens)} fresh tokens`;
  const saved = savingOf(turn);
  const savedPart = saved === null ? 'no saving counted' : `est. ~${compactTokens(saved)} tokens saved (≈$${usdOf(saved).toFixed(2)})`;
  return `reused EvoMap strategy ${names} · ${savedPart}${usedPart}`;
}

/**
 * One line for the person, shown only for a turn that reused a strategy: whether the goal was reached, judged by
 * the last check as the reuse report is, and what the reuse is estimated to have saved. Null otherwise.
 */
export function turnSummaryOf({ reusedNames = [], lastCheck = null, changedLines = 0, freshTokens = null }) {
  if (reusedNames.length === 0) return null;
  const turn = { reusedNames, lastCheck, changedLines, freshTokens };
  return `${goalLine(lastCheck)} · ${reuseLine(turn)}`;
}
