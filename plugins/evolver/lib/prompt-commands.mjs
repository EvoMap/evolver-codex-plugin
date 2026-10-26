import { evolverCommands } from './commands.mjs';
import { dueCandidates } from './session-distill.mjs';

// Codex sends a prompt a UserPromptSubmit hook blocks to no model, so these commands answer the person from
// the hook itself. Only a prompt that is exactly a command counts; a slash in front is accepted, though the
// client may keep slash input for its own commands.
const PROMPT_COMMAND = /^\/?(evolver-[a-z]+)(?:\s+([\s\S]*))?$/;
const COMMAND_NAMES = new Set(evolverCommands({}).map((command) => command.name));

// `evolver-status` takes no arguments, so text after it is a question about it, not the command.
const TAKES_NO_ARGUMENTS = new Set(['evolver-status']);

// `evolver-evolve` is the one command meant for the agent: its instruction rides the prompt to the model.
const FOR_THE_MODEL = 'evolver-evolve';

export function promptCommandOf(prompt) {
  const match = PROMPT_COMMAND.exec(String(prompt ?? '').trim());
  if (!match || !COMMAND_NAMES.has(match[1])) return null;
  const args = (match[2] ?? '').trim().split(/\s+/).filter(Boolean);
  return TAKES_NO_ARGUMENTS.has(match[1]) && args.length > 0 ? null : { name: match[1], args };
}

/**
 * `{ context }` for `evolver-evolve`, `{ blockReason }` for the rest. `status` and `search` answer from the Proxy
 * within the hook's time; `distill` hands this session's candidate to a background process
 * (`startDistill(sessionId, focus)`); the engine commands go to `runCli(args)`.
 */
export async function answerPromptCommand({ name, args }, { sessionId, status, search, startDistill, runCli }) {
  const distillNow = async (focusArgs) => {
    if (dueCandidates({ sessionId }).length === 0) return { status: 'nothing' };
    startDistill(sessionId, focusArgs.join(' '));
    return { status: 'started' };
  };
  const command = evolverCommands({ status, search, distillNow, runCli }).find((candidate) => candidate.name === name);
  const { text } = await command.handler({ args });
  return name === FOR_THE_MODEL ? { context: text } : { blockReason: text };
}
