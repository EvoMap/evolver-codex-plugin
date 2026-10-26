// A correction is only worth sending when the person plainly says the last
// answer did not hold. Anything softer — a new question, a follow-up feature,
// a report of some other error — must not revise a verdict, because the Hub
// counts every report and there is no way to take one back.
//
// Questions are the trap this has to survive: `行不行`, `对不对`, `不行吗` and
// a closing `不对吧` ask for an opinion and contain `不行` and `不对` verbatim.
const ASKS_FOR_OPINION = /\s*(?:[吗嘛么]|吧?\s*[?？]|吧\s*[。.!！~～]*\s*$)/;
const CORRECTION_PATTERNS = [
  new RegExp(`(?<!行)不行(?!不)(?!${ASKS_FOR_OPINION.source})`),
  new RegExp(`(?<!对)不对(?!不)(?!${ASKS_FOR_OPINION.source})`),
  /没(?:有)?(?:用|效果|解决|成功|生效)/,
  /不管用/,
  /还是(?:不|没|失败|报错|错)/,
  /仍然(?:不|没|失败|报错)/,
  /(?:搞|弄|说|理解)错了/,
  /不是(?:这个|这样|我要)/,
  /重(?:来|新来)/,
  /(?:didn'?t|does\s?n'?t|did not|does not)\s+(?:work|help|fix)/i,
  /still\s+(?:failing|broken|fails|not\s+work|doesn'?t)/i,
  /(?:that'?s|that is|this is)\s+(?:wrong|incorrect)/i,
  /(?:wrong|incorrect)\s+answer/i,
  /no\s+effect/i,
  /same\s+error/i,
  /try\s+again/i,
];

export function looksLikeCorrection(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(text));
}
