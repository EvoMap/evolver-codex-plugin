import { readState, statePath, writeState } from './state-file.mjs';

const enginePath = () => statePath('codex-engine.json');
const announcedPath = () => statePath('codex-engine-announced.json');

export function readEngineState() {
  return readState(enginePath(), null);
}

export function writeEngineState(outcome) {
  writeState(enginePath(), outcome);
}

export function isAnnounced(outcome) {
  return readState(announcedPath(), {}).at === outcome?.at;
}

export function markAnnounced(outcome) {
  writeState(announcedPath(), { at: outcome.at });
}
