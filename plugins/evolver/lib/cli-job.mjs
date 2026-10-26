import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { readState, statePath, updateState } from './state-file.mjs';

const JOB_SCRIPT = fileURLToPath(new URL('../scripts/cli-job.mjs', import.meta.url));
const KEPT_JOBS = 5;
const POLL_MS = 200;

const cliLogPath = () => statePath('codex-cli-log.json');

/**
 * The `evolver` CLI runs up to ten minutes and a hook gets seconds, so a command typed into Codex runs it in a
 * detached process of its own, in the project's directory; `id` names its entry in the log.
 */
export function startCliJob(args, cwd) {
  const id = randomUUID();
  const child = spawn(process.execPath, [JOB_SCRIPT, id, cwd || os.homedir(), ...args], {
    detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir(),
  });
  child.unref();
  return id;
}

export function recordCliJob(id, args, { kind, text }, now = Date.now()) {
  updateState(cliLogPath(), {}, (log) => {
    const job = { id, command: `evolver ${args.join(' ')}`, kind, text, at: new Date(now).toISOString() };
    return { last: job, jobs: [job, ...(log.jobs ?? []).filter((kept) => kept.id !== id)].slice(0, KEPT_JOBS) };
  });
}

export function readCliLog() {
  return readState(cliLogPath(), {});
}

/** The job's result once it is logged, or null when it is still running after `waitMs`. */
export async function cliJobResult(id, { waitMs, pollMs = POLL_MS }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const job = (readCliLog().jobs ?? []).find((kept) => kept.id === id);
    if (job) return job;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
