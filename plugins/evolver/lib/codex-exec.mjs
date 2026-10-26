import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cmdArgument, endTree } from './commands.mjs';

const ERROR_MAX_CHARS = 300;
const KILL_GRACE_MS = 5_000;
const MCP_LIST_TIMEOUT_MS = 10_000;
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

// The distillation is one answer from the model, not an agent run: no hooks (they would start this plugin
// again), no plugins, apps, shell or web search, a read-only sandbox in an empty directory, and nothing saved.
const DISABLED_FEATURES = ['hooks', 'plugins', 'shell_tool', 'apps', 'multi_agent'];
const DISABLED_FEATURE_FLAGS = DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]);

// `--disable plugins` drops the plugins' MCP servers but not those in the person's config.toml, which run
// outside the read-only sandbox; each one still enabled is turned off by name. `--ignore-user-config` would
// also drop the model provider the session ran on.
export function codexExecArguments(model, workdir, { mcpServers = [] } = {}) {
  return [
    'exec', '--ephemeral', '--skip-git-repo-check', '--ignore-rules', '--json',
    '--sandbox', 'read-only',
    ...DISABLED_FEATURE_FLAGS,
    '-c', 'web_search="disabled"',
    ...mcpServers.flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
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

// An npm install of Codex on Windows is a `codex.cmd` shim, which only cmd.exe can start; its arguments are
// escaped for cmd.exe and the shim, and stopping it ends cmd.exe's whole tree.
export function spawnPlanOf(executable, args, platform = process.platform) {
  const throughShell = platform === 'win32' && !/\.exe$/i.test(executable);
  return { command: executable, args: throughShell ? args.map(cmdArgument) : args, shell: throughShell };
}

function startCodex(executable, args) {
  const plan = spawnPlanOf(executable, args);
  const child = spawn(plan.command, plan.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: plan.shell });
  const stop = () => {
    if (plan.shell) return endTree(child.pid);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
  };
  return { child, stop };
}

/** The enabled MCP servers a `codex mcp list --json` listing names, or null when the listing cannot be read. */
export function enabledMcpServersOf(listJson) {
  try {
    const servers = JSON.parse(listJson);
    if (!Array.isArray(servers)) return null;
    return servers.filter((server) => server?.enabled === true && MCP_SERVER_NAME.test(String(server.name))).map((server) => server.name);
  } catch {
    return null;
  }
}

/**
 * The MCP servers the distillation would start, as Codex lists them under the same flags. Rejects when the list
 * cannot be read, since running without it would start those servers, and when `signal` aborts meanwhile.
 */
function enabledMcpServers(executable, signal) {
  return new Promise((resolve, reject) => {
    const { child, stop } = startCodex(executable, [...DISABLED_FEATURE_FLAGS, 'mcp', 'list', '--json']);
    let stdout = '';
    const timer = setTimeout(stop, MCP_LIST_TIMEOUT_MS);
    signal?.addEventListener('abort', stop, { once: true });
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      settle();
      reject(failure(error.message, error.code));
    });
    child.on('close', () => {
      settle();
      const servers = enabledMcpServersOf(stdout);
      if (signal?.aborted) reject(failure('cancelled', 'ABORT_ERR'));
      else if (servers === null) reject(failure('could not list the MCP servers to turn off for the distillation'));
      else resolve(servers);
    });
    child.stdin.end();
  });
}

/**
 * Asks Codex itself, headless, for one answer on `model`: the prompt goes in on stdin and the answer is read
 * off `--json` events. Rejects with code ENOENT when there is no Codex executable to run, and without running
 * the model when the MCP servers cannot be listed or `signal` aborts first.
 */
export function codexModelRunner({ executable = 'codex' } = {}) {
  return async (model, prompt, signal) => {
    const mcpServers = await enabledMcpServers(executable, signal);
    return answerOfExec(executable, { model, mcpServers }, prompt, signal);
  };
}

function answerOfExec(executable, { model, mcpServers }, prompt, signal) {
  return new Promise((resolve, reject) => {
    const workdir = mkdtempSync(path.join(os.tmpdir(), 'evolver-distill-'));
    const cleanUp = () => rmSync(workdir, { recursive: true, force: true });
    const { child, stop } = startCodex(executable, codexExecArguments(model, workdir, { mcpServers }));
    let stdout = '';
    let stderr = '';
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
