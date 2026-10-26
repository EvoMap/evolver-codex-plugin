import { looksLikeCorrection } from './dissatisfaction.mjs';

const PRAISE_PATTERNS = [
  /\b(?:thanks|thank you|thx|perfect|great|awesome|nice|excellent|works now|it works|that works|lgtm|looks good)\b/i,
  /谢谢|感谢|完美|好了|可以了|搞定|没问题了|成功了|不错|很好|太好了|牛/,
];

export function feedbackLabelOf(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (looksLikeCorrection(text)) return 'correction';
  return PRAISE_PATTERNS.some((pattern) => pattern.test(text)) ? 'praise' : null;
}
