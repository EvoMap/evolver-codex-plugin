const STEP_PREFIX = /^\s*\d+\.\s+/;
const BACKTICKED = /`([^`\n]{2,120})`/g;
const PATH_LIKE = /(?:^|[\s("'])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)+|[\w-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|rb|php|json|ya?ml|toml|md|sh|sql|css|html|vue|svelte))(?=$|[\s)"',.:;])/g;
const COMMAND_LIKE = /\b((?:npm|npx|pnpm|yarn|bun|node|git|go|cargo|pytest|python3?|pip|make|docker|kubectl|tsc|eslint|jest|vitest|codex|gh)\s+[\w:@./=-]+)/g;
const WORD = /[\p{L}\p{N}_]{4,}/gu;
const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'into', 'then', 'when', 'each', 'only', 'before', 'after', 'step', 'steps', 'make', 'sure',
  'should', 'must', 'never', 'always', 'use', 'using', 'used', 'have', 'has', 'were', 'will', 'your', 'their', 'there', 'these',
  'those', 'what', 'which', 'while', 'until', 'other', 'every', 'more', 'than', 'also', 'apply', 'where', 'fits', 'report',
  'outcome', 'evolver_asset_reuse_result', 'safety', 'boundary', 'optional', 'otherwise', 'first', 'next', 'last', 'same',
]);

const USED_RATIO = 0.5;
export const UNKNOWN = 'unknown';
const TERM_COVERAGE = 0.5;
const MIN_STEP_TERMS = 3;

export function strategyStepsOf(injectedText) {
  return String(injectedText ?? '')
    .split('\n')
    .filter((line) => STEP_PREFIX.test(line))
    .map((line) => line.replace(STEP_PREFIX, '').trim());
}

function matchesOf(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1].trim().toLowerCase());
}

export function concreteFeaturesOf(step) {
  const features = [...matchesOf(step, BACKTICKED), ...matchesOf(step, PATH_LIKE), ...matchesOf(step, COMMAND_LIKE)];
  return [...new Set(features.map((feature) => feature.replace(/[.,:;]+$/, '')).filter((feature) => feature.length >= 3))];
}

function termsOf(text) {
  return [...new Set((String(text).toLowerCase().match(WORD) ?? []).filter((term) => !STOPWORDS.has(term)))];
}

function turnHaystack({ commands = [], paths = [], edits = [], answer = '' }) {
  return [...commands, ...paths, ...edits, answer].join('\n').toLowerCase();
}

function termsWereFollowed(step, haystack) {
  const terms = termsOf(step);
  if (terms.length < MIN_STEP_TERMS) return false;
  return terms.filter((term) => haystack.includes(term)).length / terms.length >= TERM_COVERAGE;
}

function stepWasFollowed(step, haystack) {
  return concreteFeaturesOf(step).some((feature) => haystack.includes(feature)) || termsWereFollowed(step, haystack);
}

function leftNothingToCompare({ commands = [], paths = [], edits = [] }) {
  return commands.length + paths.length + edits.length === 0;
}

function verdictOf(turn, steps, hits) {
  if (hits > 0) return hits / steps >= USED_RATIO ? 'used' : 'partial';
  return steps === 0 || leftNothingToCompare(turn) ? UNKNOWN : 'unused';
}

export function appliedVerdictOf({ strategyText, ...turn }) {
  const steps = strategyStepsOf(strategyText);
  const haystack = turnHaystack(turn);
  const hits = steps.filter((step) => stepWasFollowed(step, haystack)).length;
  const ratio = steps.length === 0 ? 0 : hits / steps.length;
  return { verdict: verdictOf(turn, steps.length, hits), hits, steps: steps.length, ratio: Math.round(ratio * 1000) / 1000 };
}
