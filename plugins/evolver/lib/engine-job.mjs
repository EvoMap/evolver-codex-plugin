import { isSetupDue, prepareEngine, setupErrorOutcome } from './engine-setup.mjs';
import { readEngineState, writeEngineState } from './engine-state.mjs';
import { withLock } from './state-file.mjs';

export function setUpEngine(runtime) {
  return withLock('codex-engine', async () => {
    const previous = readEngineState();
    if (!isSetupDue(previous, runtime.now())) return;
    try {
      writeEngineState(await prepareEngine(runtime, previous));
    } catch (error) {
      writeEngineState(setupErrorOutcome(error, previous, runtime.now()));
    }
  });
}
