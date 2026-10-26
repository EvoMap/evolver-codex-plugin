import { readFileSync } from 'node:fs';

function eventsOf(transcriptPath) {
  try {
    return readFileSync(transcriptPath, 'utf8').split('\n').flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

const isTurnStart = (event) => event?.payload?.type === 'task_started';

// Cached input is the context replayed on every step at a fraction of the price; counting it would report a
// long session's context, not this turn's work.
function freshTokensOf(usage) {
  const input = Number(usage?.input_tokens) || 0;
  const cached = Number(usage?.cached_input_tokens) || 0;
  const output = Number(usage?.output_tokens) || 0;
  return Math.max(0, input - cached) + output;
}

/** The fresh tokens the turn spent, summed over the model calls Codex logged for it; null when none are logged. */
export function turnFreshTokens(transcriptPath, turnId) {
  if (!transcriptPath || !turnId) return null;
  const events = eventsOf(transcriptPath);
  const start = events.findLastIndex((event) => isTurnStart(event) && event.payload.turn_id === turnId);
  if (start === -1) return null;
  const next = events.findIndex((event, index) => index > start && isTurnStart(event));
  const calls = events.slice(start + 1, next === -1 ? undefined : next)
    .map((event) => (event?.payload?.type === 'token_count' ? event.payload.info?.last_token_usage : null))
    .filter(Boolean);
  return calls.length === 0 ? null : calls.reduce((sum, usage) => sum + freshTokensOf(usage), 0);
}
