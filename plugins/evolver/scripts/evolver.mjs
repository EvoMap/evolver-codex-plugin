#!/usr/bin/env node
import { codexModelRunner } from '../lib/codex-exec.mjs';
import { NAME_PREFIX, evolverCommands } from '../lib/commands.mjs';
import { DISTILL_TIMEOUT_MS, distillSession } from '../lib/distiller.mjs';
import { createProxyClient } from '../lib/proxy.mjs';
import { latestCandidateSession } from '../lib/session-distill.mjs';
import { statusReport } from '../lib/status-report.mjs';

const SESSION_OPTION = '--session';

function distillTarget(args) {
  const index = args.indexOf(SESSION_OPTION);
  if (index === -1) return { sessionId: latestCandidateSession(), focus: args.join(' ') };
  return { sessionId: args[index + 1], focus: [...args.slice(0, index), ...args.slice(index + 2)].join(' ') };
}

async function distillNow(args) {
  const { sessionId, focus } = distillTarget(args);
  if (!sessionId) return { status: 'nothing' };
  return distillSession(sessionId, {
    proxyFetch: createProxyClient({ timeoutMs: DISTILL_TIMEOUT_MS }),
    runModel: codexModelRunner(),
    focus,
  });
}

function usage(commands) {
  const rows = commands.map((command) => `  ${command.name.slice(NAME_PREFIX.length)}${command.input ? ` ${command.input.hint}` : ''}\n      ${command.description}`);
  return ['Usage: node scripts/evolver.mjs <command> [arguments]', '', ...rows].join('\n');
}

const proxyFetch = createProxyClient();
const commands = evolverCommands({
  status: () => statusReport(proxyFetch),
  search: (text) => proxyFetch('POST', '/asset/search', { text, limit: 5 }),
  distillNow,
});
const [name, ...args] = process.argv.slice(2);
const command = commands.find((candidate) => candidate.name === `${NAME_PREFIX}${name}`);
if (!command) {
  console.log(usage(commands));
  process.exit(name ? 1 : 0);
}
const result = await command.handler({ args });
(result.kind === 'success' ? console.log : console.error)(result.text);
process.exit(result.kind === 'success' ? 0 : 1);
