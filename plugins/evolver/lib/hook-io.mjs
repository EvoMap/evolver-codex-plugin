function parsedInput(raw) {
  try {
    const input = JSON.parse(raw);
    return input && typeof input === 'object' ? input : {};
  } catch {
    return {};
  }
}

/**
 * A handler answers with model context (a string, possibly empty) or `{ systemMessage }`, a line Codex shows the
 * person and never the model. Stop accepts only JSON on stdout, so a hook with nothing to add says `{}`.
 */
export function hookOutputOf(eventName, answer) {
  if (answer?.systemMessage) return JSON.stringify({ systemMessage: answer.systemMessage });
  return JSON.stringify(typeof answer === 'string' && answer ? { hookSpecificOutput: { hookEventName: eventName, additionalContext: answer } } : {});
}

export function sessionIdOf(input) {
  return typeof input?.session_id === 'string' && input.session_id && !input.agent_id ? input.session_id : null;
}

// Codex writes the payload and closes stdin; a hook that fails answers `{}` rather than block the turn.
export function runHook(eventName, handle) {
  let buffer = '';
  const finish = (context) => process.stdout.write(hookOutputOf(eventName, context), () => process.exit(0));
  const start = async () => {
    try {
      finish(await handle(parsedInput(buffer)));
    } catch {
      finish('');
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
  });
  process.stdin.once('end', start);
  process.stdin.once('error', start);
}
