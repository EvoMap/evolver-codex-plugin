import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('../scripts/background-worker.mjs', import.meta.url));

export const ENGINE_TASK = 'engine';
export const DRAIN_TASK = 'drain';
export const DISTILL_TASK = 'distill';
export const CODEX_OPTION = '--codex';

// Hooks run under a short timeout and Codex kills a hook's process group when it returns, so slow work
// (installing Evolver, posting reports, distilling) runs in a detached child in a session of its own.
export function startInBackground(tasks, { codexExecutable = null } = {}) {
  if (tasks.length === 0) return;
  const args = [WORKER, ...new Set(tasks), ...(codexExecutable ? [CODEX_OPTION, codexExecutable] : [])];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() });
  child.unref();
}
