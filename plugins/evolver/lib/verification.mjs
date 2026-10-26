import { detectSignals } from './signals.mjs';

const VERIFICATION_COMMANDS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|type-check|check)\b/,
  /\bnode\s+--test\b/,
  /\b(?:jest|vitest|mocha|pytest|rspec|phpunit|tsc|eslint|ruff|mypy)\b/,
  /\bgo\s+(?:test|build|vet)\b/,
  /\bcargo\s+(?:test|build|check|clippy)\b/,
  /\bdotnet\s+(?:test|build)\b/,
  /\b(?:mvn|gradle|gradlew)\b/,
  /\bmake\b/,
];

const FAILURE_SIGNALS = new Set(['test_failure', 'log_error']);

// Summaries of a passing run still name failures by count ("0 failed",
// "failures: 0"); only those counts are dropped, so "1 failed, 0 errors"
// still reads as a failure.
const ZERO_COUNT = /\b0\s+(?:failed|failures?|errors?)\b|\b(?:failed|failures?|errors?)\s*[:=]\s*0\b/gi;

export function isVerificationCommand(command) {
  return typeof command === 'string' && VERIFICATION_COMMANDS.some((pattern) => pattern.test(command));
}

const EXIT_HEADER = /^(?:Exit code: |Process exited with code )(-?\d+)$/m;
const OUTPUT_MARKER = /^Output:$/m;
const TIMED_OUT = /^command timed out after \d+ milliseconds\n/;
const STILL_RUNNING = /^Process running with session ID (\d+)$/m;

export function verificationFailed(output) {
  const evidence = String(output ?? '').replace(ZERO_COUNT, '');
  return detectSignals(evidence).some((signal) => FAILURE_SIGNALS.has(signal));
}

function headerOf(text) {
  const marker = OUTPUT_MARKER.exec(text);
  return marker ? text.slice(0, marker.index) : '';
}

/** The exec session a result says is still running, which has no verdict yet; null for a finished one. */
export function runningSessionOf(output) {
  const match = STILL_RUNNING.exec(headerOf(String(output ?? '')));
  return match ? Number(match[1]) : null;
}

// Codex hands a Bash PostToolUse hook the bare output (prefixed only when the command timed out), not the
// `Exit code: N … Output:` text the model sees; where that header is present its exit code decides, like dsh's
// isError. Otherwise the output is read, since a failing run piped through `tail` still exits zero.
export function shellCheckFailed(output) {
  const text = String(output ?? '');
  if (TIMED_OUT.test(text)) return true;
  const exit = EXIT_HEADER.exec(headerOf(text));
  if (exit && Number(exit[1]) !== 0) return true;
  return verificationFailed(exit ? text.slice(OUTPUT_MARKER.exec(text).index) : text);
}
