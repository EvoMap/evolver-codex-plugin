export const SIGNAL_KEYWORDS = {
  perf_bottleneck: ['timeout', 'slow', 'latency', 'bottleneck', 'oom', 'out of memory', 'performance'],
  capability_gap: ['not supported', 'unsupported', 'not implemented', 'missing feature', 'not available'],
  log_error: ['error:', 'exception:', 'typeerror', 'referenceerror', 'syntaxerror', 'failed'],
  user_feature_request: ['add feature', 'implement', 'new function', 'new module', 'please add'],
  recurring_error: ['same error', 'still failing', 'not fixed', 'keeps failing', 'repeatedly'],
  deployment_issue: ['deploy failed', 'build failed', 'ci failed', 'pipeline', 'rollback'],
  test_failure: ['test failed', 'test failure', 'assertion', 'expect(', 'assert.'],
};

const CODE_LINE_PREFIXES = ['//', '#', '*', '{', '[', '}', ']', '/*'];
// A keyword inside a statement describes what the code does, not what happened:
// `expect(order).toBe(paid)` is a passing test being written, not a test failure.
const CODE_STATEMENT = /^(?:[A-Za-z_$][\w$.]*\s*\(|(?:import|export|const|let|var|function|class|return|if|for|while|switch|throw|await|async)\b)/;

function looksLikeCode(trimmedLine) {
  return (
    CODE_LINE_PREFIXES.some((prefix) => trimmedLine.startsWith(prefix)) ||
    CODE_STATEMENT.test(trimmedLine) ||
    /[;{}]$/.test(trimmedLine)
  );
}

function proseOf(text) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !looksLikeCode(trimmed);
    })
    .join('\n')
    .toLowerCase();
}

export function detectSignals(text) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const prose = proseOf(text);
  if (!prose) return [];

  const found = new Set();
  for (const [category, phrases] of Object.entries(SIGNAL_KEYWORDS)) {
    if (phrases.some((phrase) => prose.includes(phrase))) found.add(category);
  }
  return [...found].sort();
}

