import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MIN_EVOLVER_VERSION } from './engine-version.mjs';
import { splitFrontmatter } from './frontmatter.mjs';

// Codex plugins cannot add commands, so a person reaches Evolver through this plugin's own script, run in
// a terminal: nothing about it sits in the model's context. Only `evolve` hands the agent an instruction,
// printed for the person to paste, because reflecting on the current work is the agent's job.

export const NAME_PREFIX = 'evolver-';
const OUTPUT_MAX_CHARS = 4_000;
const CLI_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5_000;
// The fallback runs whatever npm resolves, so it is held to the range this plugin is built against.
const CLI_PACKAGE = `@evomap/evolver@^${MIN_EVOLVER_VERSION}`;
const EVOLVE_PATH = fileURLToPath(new URL('../assets/commands/evolve.md', import.meta.url));

const success = (text) => ({ kind: 'success', text });
const failure = (text) => ({ kind: 'error', text });

function shown(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}\n…` : text;
}

const IS_WINDOWS = process.platform === 'win32';

// The CLI starts the Proxy and workers of its own, so a timed-out run takes down the whole tree it leads rather
// than only the process this plugin started: its process group on POSIX, and through taskkill on Windows, where
// the child is the cmd.exe that runs the npm shim.
function taskkill(pid) {
  execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}

function signalGroup(pid, name) {
  try {
    process.kill(-pid, name);
  } catch {
  }
}

export function endTree(pid, { platform = process.platform, killWindowsTree = taskkill, signal = signalGroup } = {}) {
  if (platform === 'win32') return killWindowsTree(pid);
  signal(pid, 'SIGTERM');
  setTimeout(() => signal(pid, 'SIGKILL'), KILL_GRACE_MS).unref?.();
}

// `evolver` and `npx` are npm .cmd shims on Windows, which only run through cmd.exe. cmd.exe reads the line
// once and the shim re-reads its arguments, so each argument is quoted for the C runtime and its cmd
// metacharacters are caret-escaped twice, so that none of them runs as a command.
const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

export function cmdArgument(arg) {
  const quoted = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
  return quoted.replace(CMD_METACHARACTERS, '^$1').replace(CMD_METACHARACTERS, '^$1');
}

function execute(file, args) {
  return new Promise((resolve) => {
    let timer = null;
    const options = { maxBuffer: 16 * 1024 * 1024, detached: !IS_WINDOWS, shell: IS_WINDOWS, windowsHide: true };
    const child = execFile(file, IS_WINDOWS ? args.map(cmdArgument) : args, options, (error, stdout, stderr) => {
      clearTimeout(timer);
      resolve({ error, output: `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`.trim() });
    });
    if (!child.pid) return;
    timer = setTimeout(() => endTree(child.pid), CLI_TIMEOUT_MS);
    timer.unref?.();
  });
}

function isOnWindowsPath(name) {
  return new Promise((resolve) => execFile('where', [name], { windowsHide: true }, (error) => resolve(!error)));
}

// Through cmd.exe a missing command is only a non-zero exit with a localized message, so on Windows a failed
// run asks `where` whether `evolver` exists at all.
export async function isMissingExecutable(error, name, { platform = process.platform, isOnPath = isOnWindowsPath } = {}) {
  if (!error) return false;
  if (error.code === 'ENOENT') return true;
  return platform === 'win32' && !(await isOnPath(name));
}

// The installed `evolver` when there is one, else the published package through npx.
export async function runEvolverCli(args, { run = execute, isMissing = isMissingExecutable } = {}) {
  let { error, output } = await run('evolver', args);
  if (await isMissing(error, 'evolver')) ({ error, output } = await run('npx', ['-y', CLI_PACKAGE, ...args]));
  return error ? failure(shown(output || String(error.message))) : success(shown(output || 'done'));
}

function cliCommand(subcommand, description, hint, runCli) {
  return {
    name: `${NAME_PREFIX}${subcommand}`,
    description,
    input: { hint },
    handler: ({ args }) => runCli([subcommand, ...args]),
  };
}

function evolveCommand() {
  const { fields, body } = splitFrontmatter(readFileSync(EVOLVE_PATH, 'utf8'));
  return {
    name: `${NAME_PREFIX}evolve`,
    description: `${fields.description} Prints the instruction to paste into Codex.`,
    input: { hint: '[focus]' },
    handler: ({ args }) => {
      const focus = args.join(' ').trim();
      return success(focus ? `${body}\n\nFocus: ${focus}` : body);
    },
  };
}

function distillMessage(outcome) {
  if (outcome.status === 'nothing') return failure('Nothing to distill yet: no turn of this session finished verified.');
  if (outcome.status === 'running') return failure('A distillation of this session is already running.');
  return outcome.status === 'sent' ? success(shown(outcome.data ?? 'distilled')) : failure(`Distillation ${outcome.status}: ${outcome.error ?? ''}`.trim());
}

/**
 * `status` and `search` answer from the Proxy, `distill` distills a session's latest verified turn now, and the
 * engine commands run the `evolver` executable.
 */
export function evolverCommands({ status, search, distillNow, runCli = runEvolverCli }) {
  return [
    {
      name: `${NAME_PREFIX}status`,
      description: 'Show Evolver health: the Proxy, engine setup, recent recalls, reuse reports and distillation candidates.',
      handler: async () => success(await status()),
    },
    {
      name: `${NAME_PREFIX}search`,
      description: 'Search the EvoMap network for reusable assets.',
      input: { hint: '<task description or error text>' },
      handler: async ({ args }) => {
        const text = args.join(' ').trim();
        if (!text) return failure(`Usage: ${NAME_PREFIX}search <task description or error text>`);
        const result = await search(text);
        return result.ok ? success(shown(result.data)) : failure(String(result.error));
      },
    },
    {
      name: `${NAME_PREFIX}distill`,
      description: "Distill a session's latest verified turn into a reusable Gene now, instead of at session end (the latest session unless --session <id>).",
      input: { hint: '[--session <id>] [focus]' },
      handler: async ({ args }) => distillMessage(await distillNow(args)),
    },
    evolveCommand(),
    cliCommand('sync', 'Sync assets between the local store and the EvoMap Hub (evolver sync).', '[--scope=…] [--type=…] [--dry-run]', runCli),
    cliCommand('review', "Review Evolver's pending evolved changes, then approve or reject them (evolver review).", '[--approve | --reject]', runCli),
    cliCommand('run', 'Run one Evolver self-evolution cycle on this repository (evolver run).', '[--loop] [--dry-run] [--strategy=…]', runCli),
    cliCommand('solidify', 'Solidify the working changes into a durable Gene or Capsule (evolver solidify).', '[--dry-run] [--intent=…] [--summary=…]', runCli),
  ];
}
