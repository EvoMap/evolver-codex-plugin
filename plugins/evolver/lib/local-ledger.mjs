import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { engineDir } from './engine-runtime.mjs';

const HIT_EVENT = 'value.reuse_hit';
const OUTCOME_EVENT = 'value.reuse_outcome';
const MAX_TITLE_CHARS = 80;
const CORE_PACKAGE = '@evomap/evolver-core';
const ENGINE_PACKAGE = path.join('node_modules', '@evomap', 'evolver', 'package.json');

function globalPackageRoots() {
  const nodeDir = path.dirname(process.execPath);
  return process.platform === 'win32' ? [path.join(nodeDir, ENGINE_PACKAGE)] : [path.join(nodeDir, '..', 'lib', ENGINE_PACKAGE)];
}

function isEngineManifest(manifest) {
  try {
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).name === '@evomap/evolver';
  } catch {
    return false;
  }
}

// npm links `evolver` on POSIX to the package's bin script; walking up from its real path finds the package.
function linkedEngineManifest(bin) {
  let dir = path.dirname(fs.realpathSync(bin));
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (isEngineManifest(manifest)) return [manifest];
    dir = path.dirname(dir);
  }
  return [];
}

/**
 * The package behind the `evolver` the engine setup found on PATH, wherever npm's global prefix is: a custom
 * prefix, or `%APPDATA%\npm` on Windows, where npm puts an `evolver.cmd` shim beside the prefix's node_modules.
 */
export function pathEngineManifests({ env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  return dirs.flatMap((dir) => {
    try {
      if (platform === 'win32') return fs.existsSync(path.join(dir, 'evolver.cmd')) ? [path.join(dir, ENGINE_PACKAGE)] : [];
      return fs.existsSync(path.join(dir, 'evolver')) ? linkedEngineManifest(path.join(dir, 'evolver')) : [];
    } catch {
      return [];
    }
  });
}

// This plugin ships no node_modules, so the core is resolved through the Evolver it set up, or a global one.
export function evolverCoreEntry(manifests = [path.join(engineDir(), ENGINE_PACKAGE), ...pathEngineManifests(), ...globalPackageRoots()]) {
  for (const manifest of manifests) {
    try {
      return createRequire(manifest).resolve(CORE_PACKAGE);
    } catch {
    }
  }
  return null;
}

const byPath = new Map();

async function loadIngestor() {
  const entry = evolverCoreEntry();
  if (!entry) return null;
  try {
    const { events } = await import(pathToFileURL(entry).href);
    const eventsPath = events.rootEventsPath();
    if (!byPath.has(eventsPath)) byPath.set(eventsPath, new events.Ingestor({ path: eventsPath }));
    return byPath.get(eventsPath);
  } catch {
    return null;
  }
}

function cycleIdOf(sessionId) {
  return `codex:${sessionId || 'unknown'}`;
}

// The verdict has to become a root_event to be worth anything: the actuator
// that re-orders candidates reads root_events, not the Hub, and a Hub without
// the route records nothing at all. Success and the negative verdicts ride
// different events by design -- the ledger derives savings from one and the
// keep/prune signal from the other.
export async function recordReuseLocally({ assetId, outcome, sessionId }) {
  if (!assetId || !outcome) return false;
  const ingestor = await loadIngestor();
  if (!ingestor) return false;

  const cycleId = cycleIdOf(sessionId);
  const success = outcome === 'success';
  try {
    await ingestor.ingest({
      type: success ? HIT_EVENT : OUTCOME_EVENT,
      human: {
        title: `codex reuse ${outcome}`.slice(0, MAX_TITLE_CHARS),
        detail: `cycle ${cycleId}`,
      },
      payload: success ? { assetId, cycleId } : { assetId, cycleId, outcome },
    });
    return true;
  } catch {
    return false;
  }
}
