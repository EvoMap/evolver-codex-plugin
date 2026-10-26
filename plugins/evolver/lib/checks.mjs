const CHECK_KINDS = [
  ['typecheck', /\btsc\b|\btype-?check\b|\bmypy\b|\bcargo\s+check\b|\bgo\s+vet\b/],
  ['lint', /\blint\b|\beslint\b|\bruff\b|\bclippy\b|\bvalidate\b/],
  ['test', /\btest\b|\bjest\b|\bvitest\b|\bmocha\b|\bpytest\b|\brspec\b|\bphpunit\b/],
];

export function checkKindOf(command) {
  return CHECK_KINDS.find(([, pattern]) => pattern.test(command))?.[0] ?? 'build';
}

const OUTPUT_PIPE = /\s*(?<!\|)\|\s*(?:tail|head|grep|tee|cat|less|more|sed|awk|wc|sort|uniq|cut|tr)\b[^|&;]*/g;
const STREAM_REDIRECT = /\s+\d*>&?\s*(?:\d|\S+)/g;

export function checkIdentityOf(command) {
  return String(command).replace(OUTPUT_PIPE, '').replace(STREAM_REDIRECT, '').replace(/\s+/g, ' ').trim();
}

function failedEarlierThenPassed(checks, last) {
  const identity = checkIdentityOf(last.command);
  return !last.failed && checks.slice(0, -1).some(({ command, failed }) => failed && checkIdentityOf(command) === identity);
}

export function checkEvidenceOf(checks) {
  const last = checks?.at(-1);
  if (!last) return undefined;
  return { kind: checkKindOf(last.command), passed: !last.failed, fail_then_pass: failedEarlierThenPassed(checks, last) };
}
