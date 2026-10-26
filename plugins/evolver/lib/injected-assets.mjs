import fs from 'node:fs';
import path from 'node:path';

import { ownerIsGone } from './process-owner.mjs';
import { hashedName, readState, removeState, stateDir, statePath, updateState } from './state-file.mjs';

const ENTRY_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
const LEDGER_PREFIX = 'codex-injected';

function pruned(ledger, now) {
  return Object.fromEntries(Object.entries(ledger ?? {}).filter(([, entry]) => {
    const at = Number(entry?.injectedAt);
    return Number.isFinite(at) && now - at <= ENTRY_PRUNE_MS;
  }));
}

/**
 * Every entry in a ledger belongs to the session it is named after, so each injection also stamps the
 * entries already there with the live owner: an entry written by the Codex process a resumed session ran in
 * would otherwise read as an orphaned one.
 */
const owned = (ledger, sessionId, pid) =>
  Object.fromEntries(Object.entries(ledger).map(([id, entry]) => [id, { ...entry, sessionId, pid }]));

export function withInjected(ledger, assetId, { turn, strategyText, sessionId, pid }, now) {
  const kept = owned(pruned(ledger, now), sessionId, pid);
  if (kept[assetId]) return kept;
  return { ...kept, [assetId]: { turn, injectedAt: now, strategyText, sessionId, pid } };
}

export function unreportedOf(ledger, turn) {
  return Object.entries(ledger ?? {})
    .filter(([, entry]) => !entry?.reportedAt && Number(entry?.turn) <= turn)
    .map(([assetId, entry]) => ({ assetId, strategyText: entry.strategyText ?? '', turn: entry.turn, sessionId: entry.sessionId }));
}

export function withReported(ledger, assetIds, now) {
  const kept = pruned(ledger, now);
  for (const assetId of assetIds) if (kept[assetId]) kept[assetId] = { ...kept[assetId], reportedAt: now };
  return kept;
}

export const ledgerPath = (sessionKey) => statePath(hashedName(LEDGER_PREFIX, sessionKey));

export function injectedIds(sessionKey) {
  return new Set(Object.keys(readState(ledgerPath(sessionKey), {})));
}

/** `pid` is the Codex process the session runs in, or null where none is known (never taken for gone). */
export function rememberInjected(sessionKey, assetId, { pid, ...injection }, now = Date.now()) {
  if (!sessionKey) return;
  updateState(ledgerPath(sessionKey), {}, (ledger) =>
    withInjected(ledger, assetId, { ...injection, sessionId: sessionKey, pid }, now));
}

export function takeUnreported(sessionKey, turn, now = Date.now()) {
  if (!sessionKey) return [];
  let due = [];
  updateState(ledgerPath(sessionKey), {}, (ledger) => {
    due = unreportedOf(ledger, turn);
    return due.length > 0 ? withReported(ledger, due.map((asset) => asset.assetId), now) : undefined;
  });
  return due;
}

/**
 * Injections no turn end ever reported, from sessions whose Codex process is gone: a process killed mid-turn
 * leaves them behind. Each ledger's are handed to `queue` and only then marked reported, so a queue that
 * fails leaves them for the next session start; a report queued twice settles once in the outbox. A session
 * that is merely idle keeps its open injections.
 */
export function queueOrphanedUnreported(queue, { isGone = ownerIsGone, now = Date.now() } = {}) {
  let files = [];
  try {
    files = fs.readdirSync(stateDir()).filter((file) => file.startsWith(`${LEDGER_PREFIX}-`) && file.endsWith('.json'));
  } catch {
    return;
  }
  for (const file of files) {
    updateState(path.join(stateDir(), file), {}, (ledger) => {
      const due = Object.entries(ledger)
        .filter(([, entry]) => !entry?.reportedAt && entry?.sessionId && isGone(entry.pid))
        .map(([assetId, entry]) => ({ assetId, strategyText: entry.strategyText ?? '', turn: entry.turn, sessionId: entry.sessionId }));
      if (due.length === 0) return undefined;
      queue(due);
      return withReported(ledger, due.map((asset) => asset.assetId), now);
    });
  }
}

export function forgetSession(sessionKey) {
  if (sessionKey) removeState(ledgerPath(sessionKey));
}
