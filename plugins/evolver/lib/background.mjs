import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('../scripts/background-worker.mjs', import.meta.url));

export const ENGINE_TASK = 'engine';
export const DRAIN_TASK = 'drain';
export const DISTILL_TASK = 'distill';
export const DISTILL_SESSION_TASK = 'distill-session';
export const CODEX_OPTION = '--codex';
export const SESSION_OPTION = '--session';
export const FOCUS_OPTION = '--focus';

// Hooks run under a short timeout and Codex kills a hook's process group when it returns, so slow work
// (installing Evolver, posting reports, distilling) runs in a detached child in a session of its own.
export function startInBackground(tasks, { codexExecutable = null, session = null } = {}) {
  if (tasks.length === 0) return;
  const args = [
    WORKER,
    ...new Set(tasks),
    ...(codexExecutable ? [CODEX_OPTION, codexExecutable] : []),
    ...(session ? [SESSION_OPTION, session.sessionId, FOCUS_OPTION, session.focus] : []),
  ];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() });
  child.unref();
}
