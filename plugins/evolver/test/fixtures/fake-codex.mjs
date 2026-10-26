#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GENE = { title: 'Retry uploads', summary: 'Retry a flaky upload with backoff.', strategy: '1. Measure. 2. Back off.', signals: ['retry'] };

if (process.argv.includes('mcp')) {
  process.stdout.write(process.env.FAKE_CODEX_MCP ?? JSON.stringify([{ name: 'node_repl', enabled: true }, { name: 'codex_app', enabled: false }]));
  process.exit(Number(process.env.FAKE_CODEX_MCP_EXIT ?? 0));
}

const prompt = readFileSync(0, 'utf8');
appendFileSync(join(homedir(), 'fake-codex.log'), `${JSON.stringify({ args: process.argv.slice(2), prompt })}\n`);
const answer = process.env.FAKE_CODEX_ANSWER ?? JSON.stringify(GENE);
const events = [
  { type: 'thread.started', thread_id: 't' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: answer } },
  { type: 'turn.completed', usage: { input_tokens: 900, cached_input_tokens: 0, output_tokens: 120, reasoning_output_tokens: 0 } },
];
process.stdout.write(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
