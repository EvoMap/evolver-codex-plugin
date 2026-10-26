import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ERROR_MAX_CHARS = 300;
const KILL_GRACE_MS = 5_000;

// The distillation is one answer from the model, not an agent run: no hooks (they would start this plugin
// again), no plugins, apps, shell or web search, a read-only sandbox in an empty directory, and nothing saved.
const DISABLED_FEATURES = ['hooks', 'plugins', 'shell_tool', 'apps', 'multi_agent'];

export function codexExecArguments(model, workdir) {
  return [
    'exec', '--ephemeral', '--skip-git-repo-check', '--ignore-rules', '--json',
    '--sandbox', 'read-only',
    ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    '-c', 'web_search="disabled"',
    '-m', model,
    '-C', workdir,
    '-',
  ];
}

function usageOf(usage) {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  };
}

export function answerOfEvents(jsonl) {
  let answer = '';
  let usage = null;
  for (const line of String(jsonl).split('\n')) {
    let event;
    try {
      event = line.trim() ? JSON.parse(line) : null;
    } catch {
      continue;
    }
    if (event?.type === 'item.completed' && event.item?.type === 'agent_message') answer = String(event.item.text ?? '');
    if (event?.type === 'turn.completed') usage = usageOf(event.usage);
  }
  return { answer, usage };
}

function failure(message, code) {
  return Object.assign(new Error(message), code ? { code } : {});
}

/**
 * Asks Codex itself, headless, for one answer on `model`: the prompt goes in on stdin and the answer is read
 * off `--json` events. Rejects with code ENOENT when there is no Codex executable to run.
 */
export function codexModelRunner({ executable = 'codex' } = {}) {
  return (model, prompt, signal) => new Promise((resolve, reject) => {
    const workdir = mkdtempSync(path.join(os.tmpdir(), 'evolver-distill-'));
    const cleanUp = () => rmSync(workdir, { recursive: true, force: true });
    const child = spawn(executable, codexExecArguments(model, workdir), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      cleanUp();
      reject(failure(error.message, error.code));
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', stop);
      cleanUp();
      if (signal?.aborted) reject(failure('cancelled', 'ABORT_ERR'));
      else if (code !== 0) reject(failure(`codex exec exited ${code}: ${stderr.trim().slice(-ERROR_MAX_CHARS)}`));
      else resolve(answerOfEvents(stdout));
    });
    child.stdin.end(prompt);
  });
}
