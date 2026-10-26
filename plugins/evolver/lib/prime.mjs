import { withoutSecrets } from './redact.mjs';

// One round trip, not two: since evolver 2.0.39 `/asset/fetch` recalls by text
// when it is given no ids, so selecting a candidate and materialising it are the
// same call. No `limit` is sent, so the Hub's own default decides how many come
// back (two at present).
const MIN_PROMPT_CHARS = 8;
const PROMPT_MAX_CHARS = 400;
const STEP_MAX_CHARS = 400;
const TITLE_MAX_CHARS = 80;
const DEFAULT_MIN_SIMILARITY = 0.3;
// Both bounds live here because recall does not pass through the Hub's search
// tuning: `thinGeneClause`, which drops genes of three steps or fewer, is
// imported only by assetSearchService, so the route that selects by ids and the
// route that recalls by text disagree about what is worth returning. Measured
// against a live Hub over five prompts, recall handed back three-step genes and
// a two-step one. The upper bound is on what the injection costs, not on how
// many steps carry it: a cap of eight steps dropped half of all recalled assets
// (20 of 39 over eight prompts), and for broad prompts every candidate, while
// 9-15 step genes inject a median 2690 characters and the oversized pipeline
// transcripts that motivated a cap run past 4700.
const MIN_STRATEGY_STEPS = 4;
export const STRATEGY_MAX_CHARS = 4000;
const UNSCORED = -1;
const EMPTY_MATCH = { ids: [], text: '' };

function strategySteps(asset) {
  const steps = asset?.strategy ?? asset?.payload?.strategy ?? asset?.gene?.strategy;
  const list = Array.isArray(steps) ? steps : [steps];
  return list
    .filter((step) => typeof step === 'string' && step.trim())
    .map((step) => step.trim().slice(0, STEP_MAX_CHARS));
}

function strategyChars(steps) {
  return steps.reduce((total, step) => total + step.length, 0);
}

export function promptTextOf(prompt) {
  return withoutSecrets(typeof prompt === 'string' ? prompt : '').trim().slice(0, PROMPT_MAX_CHARS);
}

function recalledAssets(data) {
  const found = [data?.assets, data?.results, data?.payload?.results].find(Array.isArray) ?? [];
  return found.filter((asset) => asset && typeof asset.asset_id === 'string' && asset.asset_id);
}

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const MIN_CJK_TITLE_CHARS = 5;

function trimmedText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

// A Hub short_title is sometimes a truncated fragment: `Object`, `自动化小`.
// Character count cannot separate those from a good title, because `智能缓存优化`
// says as much in six characters as a Latin title says in forty.
function looksLikeAName(text) {
  if (!text) return false;
  if (CJK_SCRIPT.test(text)) return [...text].length >= MIN_CJK_TITLE_CHARS;
  return /\s/.test(text);
}

function readableNameOf(asset) {
  const title = trimmedText(asset?.short_title);
  if (looksLikeAName(title)) return title.slice(0, TITLE_MAX_CHARS);
  const described = trimmedText(asset?.nl_summary) || trimmedText(asset?.summary);
  if (described) return described.slice(0, TITLE_MAX_CHARS);
  return title || asset?.asset_type || asset?.type || 'Gene';
}

function similarityOf(asset) {
  return typeof asset.similarity === 'number' ? asset.similarity : UNSCORED;
}

// Recall hands back whole assets, so having a strategy is read off the asset
// itself rather than trusted from a search flag. What is left to judge is the
// score, and it is only advisory: it swings with phrasing — the same React
// question scored 0.88 asked one way and 0.40 asked another, while boilerplate
// and off-topic hits sit at 0.19–0.22 — and a Proxy that reports none at all
// must not be filtered down to nothing. They rank by score rather than by the
// order the Hub listed them in, since that order weighs more than this prompt.
function rankingRejection(asset, listedIds, minSimilarity) {
  if (listedIds.has(asset.asset_id)) return 'already_injected';
  if (typeof asset.similarity === 'number' && asset.similarity < minSimilarity) return 'low_similarity';
  return null;
}

function strategyRejection(steps) {
  if (steps.length < MIN_STRATEGY_STEPS) return 'too_few_steps';
  if (strategyChars(steps) > STRATEGY_MAX_CHARS) return 'too_long';
  return null;
}

async function proxyJson(proxyFetch, path, body, signal) {
  try {
    const result = await proxyFetch('POST', path, body, signal);
    return result?.ok ? { data: result.data } : { error: String(result?.error ?? 'Proxy returned no result') };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

// Priming sits on the critical path of every answer: an unreachable Proxy, a
// slow Hub, or a malformed body must cost the turn nothing but the deadline.
// One asset's strategy is injected and nothing else — a summary only tells the
// model that something exists, while the steps are what it can actually reuse.
// Every lookup reports why it ended through `onOutcome`, because an empty match
// alone cannot tell a Proxy error from a recall that found nothing usable.
export async function hubGene(proxyFetch, text, {
  signal,
  listedIds = new Set(),
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  onOutcome = () => {},
} = {}) {
  if (text.length < MIN_PROMPT_CHARS) {
    onOutcome({ status: 'skipped', reason: 'prompt_too_short' });
    return EMPTY_MATCH;
  }

  const recalled = await proxyJson(proxyFetch, '/asset/fetch', { text }, signal);
  if (recalled.error) {
    onOutcome({ status: 'proxy_error', error: recalled.error });
    return EMPTY_MATCH;
  }

  const assets = recalledAssets(recalled.data);
  if (assets.length === 0) {
    onOutcome({ status: 'no_candidates' });
    return EMPTY_MATCH;
  }

  const dropped = {};
  const drop = (reason) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };
  const ranked = assets
    .filter((asset) => {
      const reason = rankingRejection(asset, listedIds, minSimilarity);
      if (reason) drop(reason);
      return !reason;
    })
    .sort((left, right) => similarityOf(right) - similarityOf(left));

  for (const candidate of ranked) {
    const steps = strategySteps(candidate);
    const reason = strategyRejection(steps);
    if (reason) {
      drop(reason);
      continue;
    }

    onOutcome({
      status: 'injected',
      candidates: assets.length,
      dropped,
      asset_id: candidate.asset_id,
      title: readableNameOf(candidate),
      steps: steps.length,
      chars: strategyChars(steps),
      similarity: typeof candidate.similarity === 'number' ? candidate.similarity : null,
    });
    return {
      ids: [candidate.asset_id],
      text: [
        `[Evolution Memory] ${readableNameOf(candidate)} (EvoMap network):`,
        ...steps.map((step, index) => `${index + 1}. ${step}`),
        '',
        'Apply them where they fit.',
      ].join('\n'),
    };
  }
  onOutcome({ status: 'all_filtered', candidates: assets.length, dropped });
  return EMPTY_MATCH;
}
