#!/usr/bin/env node
/**
 * Evolver Proxy MCP bridge (stdio, zero dependencies).
 *
 * Exposes the EvoMap local Proxy mailbox — genes, capsules, status — as MCP
 * tools so Codex can search/reuse/publish evolution assets natively.
 *
 * Transport: MCP Content-Length frames, with newline-delimited JSON-RPC kept
 * for older hosts. Replies use the same framing as the incoming request.
 * All diagnostics go to stderr; stdout carries protocol traffic ONLY.
 *
 * The Proxy is a separate local process started by the @evomap/evolver CLI.
 * This bridge never spawns it; when it is down, tools return a helpful error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVER = { name: 'evolver-proxy', version: '0.1.0' };
const DEFAULT_PROTOCOL = '2025-06-18';
const PROXY_FETCH_TIMEOUT_MS = Number(process.env.EVOMAP_MCP_PROXY_TIMEOUT_MS) || 45_000;
const PROXY_HEALTH_TIMEOUT_MS = Number(process.env.EVOMAP_MCP_PROXY_HEALTH_TIMEOUT_MS) || 2_000;
const PROXY_AUTOSTART = String(process.env.EVOMAP_MCP_PROXY_AUTOSTART || '1') !== '0';
const PROXY_START_TIMEOUT_MS = Number(process.env.EVOMAP_MCP_PROXY_START_TIMEOUT_MS) || 15_000;
const MCP_IDLE_EXIT_MS = Number(process.env.EVOMAP_MCP_IDLE_EXIT_MS) || 5 * 60_000;
const MAX_FRAME_BYTES = Number(process.env.EVOMAP_MCP_MAX_FRAME_BYTES) || 16 * 1024 * 1024;
let proxyStartPromise = null;
const CODEX_GUIDANCE_START = '<!-- evolver-codex-guidance:start -->';
const CODEX_GUIDANCE_END = '<!-- evolver-codex-guidance:end -->';

function log(...a) { process.stderr.write('[evolver-proxy-mcp] ' + a.join(' ') + '\n'); }

function codexGuidanceSection(language) {
  if (language === 'zh') {
    return `${CODEX_GUIDANCE_START}
## Evolver 全局指令

- 开始实质性工作前，先调用 \`evolver_status\`；如果 Proxy 正常，再用简短任务信号调用 \`evolver_search_assets\`，优先复用已有 Genes/Capsules。
- 如果召回到相关资产，用 \`evolver_fetch_asset\` 获取候选内容；只采用与当前任务匹配、可验证的部分。
- 任务结束后，只有当产出确实可复用为 Gene/Capsule 时才调用 \`evolver_publish_asset\`；普通本地结果由已安装的 Evolver hooks 在 Stop 阶段记录。
- 如果 MCP 工具不可用、Proxy token 过期或 transport 断开，重启/启动 Evolver Proxy，或在插件/Proxy 更新后开启一个新的 Codex 线程。
${CODEX_GUIDANCE_END}`;
  }

  return `${CODEX_GUIDANCE_START}
## Evolver Global Guidance

- Before substantive work, call \`evolver_status\`; if the Proxy is running, call \`evolver_search_assets\` with concise task signals before designing or editing.
- If assets match, call \`evolver_fetch_asset\` for promising IDs and apply only the relevant, verifiable guidance.
- At task end, call \`evolver_publish_asset\` only for genuinely reusable Genes/Capsules; ordinary local outcomes are recorded by installed Evolver hooks when present.
- If MCP tools are unavailable, the Proxy token is stale, or transport is closed, start/restart the Evolver Proxy or open a new Codex thread after plugin/Proxy changes.
${CODEX_GUIDANCE_END}`;
}

function updateCodexGuidanceContent(before, section) {
  const start = before.indexOf(CODEX_GUIDANCE_START);
  const end = before.indexOf(CODEX_GUIDANCE_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    return {
      ok: false,
      error: `Malformed Evolver guidance markers in ~/.codex/AGENTS.md. Expected both ${CODEX_GUIDANCE_START} and ${CODEX_GUIDANCE_END}.`,
    };
  }

  if (start !== -1) {
    const replaceEnd = end + CODEX_GUIDANCE_END.length;
    const next = before.slice(0, start) + section + before.slice(replaceEnd);
    return { ok: true, content: next, action: 'updated' };
  }

  const trimmed = before.trimEnd();
  const prefix = trimmed ? `${trimmed}\n\n` : '';
  return { ok: true, content: `${prefix}${section}\n`, action: 'inserted' };
}

function installCodexGuidance(args = {}) {
  const language = args.language === 'zh' ? 'zh' : 'en';
  const dryRun = args.dry_run === true;
  const codexDir = join(homedir(), '.codex');
  const agentsPath = join(codexDir, 'AGENTS.md');
  let before = '';
  let existed = true;
  try {
    before = readFileSync(agentsPath, 'utf8');
  } catch (e) {
    if (e?.code !== 'ENOENT') {
      return { ok: false, error: `Could not read ${agentsPath}: ${e.message}` };
    }
    existed = false;
  }

  const section = codexGuidanceSection(language);
  const updated = updateCodexGuidanceContent(before, section);
  if (!updated.ok) return { ok: false, error: updated.error };

  const content = updated.content.endsWith('\n') ? updated.content : `${updated.content}\n`;
  const changed = content !== before;
  if (dryRun) {
    return {
      ok: true,
      data: {
        dry_run: true,
        changed,
        action: changed ? updated.action : 'unchanged',
        agents_path: agentsPath,
        language,
        section,
      },
    };
  }

  if (!changed) {
    return {
      ok: true,
      data: {
        changed: false,
        action: 'unchanged',
        agents_path: agentsPath,
        language,
      },
    };
  }

  mkdirSync(codexDir, { recursive: true });
  let backupPath = null;
  if (existed) {
    backupPath = `${agentsPath}.bak.${Math.floor(Date.now() / 1000)}`;
    writeFileSync(backupPath, before, 'utf8');
  }
  writeFileSync(agentsPath, content, 'utf8');
  return {
    ok: true,
    data: {
      changed: true,
      action: updated.action,
      agents_path: agentsPath,
      backup_path: backupPath,
      language,
      restart_recommended: true,
    },
  };
}

/**
 * Resolve the live Proxy connection. ~/.evolver/settings.json is authoritative:
 * the running Proxy writes both its url and a per-instance auth token there.
 * Recent Proxy builds reject unauthenticated local requests with 401, so we
 * send `Authorization: Bearer <token>`. Re-read every call — the token rotates
 * whenever the Proxy restarts. Never log or echo the token.
 */
function readProxySettings() {
  let url = null, token = null;
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.evolver', 'settings.json'), 'utf8'));
    if (s?.proxy?.url) url = String(s.proxy.url).replace(/\/+$/, '');
    if (s?.proxy?.token) token = String(s.proxy.token);
  } catch { /* not running / unreadable — fall through */ }
  if (!url) url = `http://127.0.0.1:${process.env.EVOMAP_PROXY_PORT || '19820'}`;
  return { url, token };
}

async function proxyFetch(method, path, body, opts = {}) {
  const { url: base, token } = readProxySettings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_FETCH_TIMEOUT_MS);
  try {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(base + path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      // Make auth/connection failures actionable. Never echo the token.
      let hint = '';
      if ([401, 403].includes(res.status)) {
        hint = token
          ? ' The Proxy token in ~/.evolver/settings.json looks stale (the Proxy mints a fresh token on restart). Start a new Codex thread so the bridge re-reads it, or ask Codex to check Evolver status.'
          : ` No Proxy token found in ~/.evolver/settings.json and the request was rejected — another process may be using ${base}. Start the Proxy (run \`evolver\` once in a git repo) or set EVOMAP_PROXY_PORT, then run /evolver:status.`;
      } else if (res.status === 404) {
        hint = ` Endpoint not found at ${base} — it may not be the Evolver Proxy. Ask Codex to check Evolver status.`;
      }
      return { ok: false, error: `Proxy at ${base} returned HTTP ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : text}.${hint}` };
    }
    return { ok: true, data };
  } catch (e) {
    if (e.name === 'AbortError') {
      const health = await probeProxyHealth(base, token);
      if (health.ok) {
        return {
          ok: false,
          error: `Proxy request to ${path} timed out after ${PROXY_FETCH_TIMEOUT_MS}ms, but the local Evolver Proxy is running at ${base}. The Hub/upstream call is likely slow; retry the tool call or set EVOMAP_MCP_PROXY_TIMEOUT_MS to tune this bridge timeout.`,
        };
      }
      if (health.reachable) {
        return {
          ok: false,
          error: `Proxy request to ${path} timed out after ${PROXY_FETCH_TIMEOUT_MS}ms. The local Evolver Proxy is reachable at ${base}, but its HTTP health check did not complete (${health.error}). The Proxy is likely busy on a slow Hub/upstream call; retry the tool call or set EVOMAP_MCP_PROXY_TIMEOUT_MS to tune this bridge timeout.`,
        };
      }
      if (!opts.retriedStart) {
        const started = await ensureProxyRunning(`timeout on ${path}: ${health.error}`);
        if (started.ok) return proxyFetch(method, path, body, { retriedStart: true });
        return {
          ok: false,
          error: `Proxy request timed out after ${PROXY_FETCH_TIMEOUT_MS}ms and health check failed (${health.error}). Autostart failed: ${started.error}`,
        };
      }
      return {
        ok: false,
        error: `Proxy request timed out after ${PROXY_FETCH_TIMEOUT_MS}ms and health check failed (${health.error}). Evolver Proxy not reachable at ${base}. Start it by running \`evolver\` once inside a git repo, or set EVOMAP_PROXY_PORT if you use a non-default port.`,
      };
    }
    if (!opts.retriedStart) {
      const started = await ensureProxyRunning(`connection failure on ${path}: ${e.message}`);
      if (started.ok) return proxyFetch(method, path, body, { retriedStart: true });
      return { ok: false, error: `Proxy connection failed: ${e.message}. Autostart failed: ${started.error}` };
    }
    const hint = `Evolver Proxy not reachable at ${base}. Start it by running \`evolver\` once inside a git repo (the CLI launches the Proxy), or ask Codex to check Evolver status. Set EVOMAP_PROXY_PORT if you use a non-default port.`;
    return { ok: false, error: `Proxy connection failed: ${e.message}. ${hint}` };
  } finally {
    clearTimeout(timer);
  }
}

function resolveEvolverCommand() {
  if (process.env.EVOLVER_CLI) return process.env.EVOLVER_CLI;
  for (const candidate of ['/opt/homebrew/bin/evolver', '/usr/local/bin/evolver']) {
    if (existsSync(candidate)) return candidate;
  }
  return 'evolver';
}

function resolveProxyStarter() {
  const launcher = join(homedir(), '.evolver', 'evolver-proxy-launcher.js');
  if (existsSync(launcher)) {
    return {
      command: process.execPath,
      args: [launcher],
      label: launcher,
    };
  }
  const command = resolveEvolverCommand();
  return {
    command,
    args: ['--loop'],
    label: command,
  };
}

function proxyPortFromBase(base) {
  try {
    const parsed = new URL(base);
    return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  } catch {
    return process.env.EVOMAP_PROXY_PORT || '19820';
  }
}

async function ensureProxyRunning(reason) {
  if (!PROXY_AUTOSTART) return { ok: false, error: 'EVOMAP_MCP_PROXY_AUTOSTART=0' };
  if (proxyStartPromise) return proxyStartPromise;
  proxyStartPromise = (async () => {
    const { url: base, token } = readProxySettings();
    const health = await probeProxyHealth(base, token);
    if (health.ok) return { ok: true, started: false };

    const starter = resolveProxyStarter();
    const port = process.env.EVOMAP_PROXY_PORT || proxyPortFromBase(base);
    try {
      const child = spawn(starter.command, starter.args, {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          EVOMAP_PROXY: '1',
          A2A_TRANSPORT: 'mailbox',
          EVOMAP_PROXY_PORT: port,
          EVOLVER_QUIET_PARENT_GIT: process.env.EVOLVER_QUIET_PARENT_GIT || '1',
        },
      });
      child.unref();
      log(`autostart requested via ${starter.label} pid=${child.pid || 'unknown'} reason=${reason}`);
      const spawnError = new Promise((resolve) => {
        child.once('error', (e) => resolve({ ok: false, error: `failed to spawn ${starter.label}: ${e.message}` }));
      });
      const ready = await Promise.race([waitForProxyReady(PROXY_START_TIMEOUT_MS), spawnError]);
      return ready.ok ? { ok: true, started: true } : ready;
    } catch (e) {
      return { ok: false, error: `failed to spawn ${starter.label}: ${e.message}` };
    }
  })().finally(() => {
    proxyStartPromise = null;
  });
  return proxyStartPromise;
}

async function waitForProxyReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not checked';
  while (Date.now() < deadline) {
    const { url: base, token } = readProxySettings();
    const health = await probeProxyHealth(base, token);
    if (health.ok) return { ok: true };
    lastError = health.error || `HTTP ${health.status || 'unknown'}`;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return { ok: false, error: `Proxy did not become healthy within ${timeoutMs}ms (${lastError})` };
}

async function probeProxyHealth(base, token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_HEALTH_TIMEOUT_MS);
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const res = await fetch(base + '/proxy/status', { headers, signal: ctrl.signal });
    return { ok: res.ok, reachable: true, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    const tcp = await probeProxySocket(base);
    return {
      ok: false,
      reachable: tcp.ok,
      error: e.name === 'AbortError' ? `health timeout; ${tcp.error}` : `${e.message}; ${tcp.error}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeProxySocket(base) {
  return new Promise((resolve) => {
    let settled = false;
    let url;
    try {
      url = new URL(base);
    } catch (e) {
      resolve({ ok: false, error: `invalid proxy url: ${e.message}` });
      return;
    }
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const socket = connect({ host: url.hostname, port });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(PROXY_HEALTH_TIMEOUT_MS);
    socket.once('connect', () => finish({ ok: true, error: `tcp ${url.hostname}:${port} reachable` }));
    socket.once('timeout', () => finish({ ok: false, error: `tcp ${url.hostname}:${port} timeout` }));
    socket.once('error', (e) => finish({ ok: false, error: `tcp ${url.hostname}:${port} ${e.message}` }));
  });
}

// ---- Tool registry -------------------------------------------------------

const TOOLS = [
  {
    name: 'evolver_status',
    description: 'Get the EvoMap Proxy status: running state, node_id, pending inbound/outbound message counts, and last Hub sync time. Use this first to confirm the Proxy is up.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => proxyFetch('GET', '/proxy/status'),
  },
  {
    name: 'evolver_search_assets',
    description: 'Search the EvoMap network for reusable evolution assets (Genes and Capsules) that match the given signals. Call this BEFORE starting substantive work to reuse proven approaches instead of reinventing them.',
    inputSchema: {
      type: 'object',
      properties: {
        signals: { type: 'array', items: { type: 'string' }, description: 'Signal keywords, e.g. ["log_error","perf_bottleneck","test_failure"].' },
        mode: { type: 'string', enum: ['semantic', 'exact'], default: 'semantic' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 5 },
      },
      required: ['signals'],
      additionalProperties: false,
    },
    handler: (a) => proxyFetch('POST', '/asset/search', {
      signals: a.signals, mode: a.mode || 'semantic', limit: a.limit || 5,
    }),
  },
  {
    name: 'evolver_fetch_asset',
    description: 'Fetch the full content of one or more evolution assets by their IDs (e.g. "sha256:abc..."), as returned by evolver_search_assets.',
    inputSchema: {
      type: 'object',
      properties: { asset_ids: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['asset_ids'],
      additionalProperties: false,
    },
    handler: (a) => proxyFetch('POST', '/asset/fetch', { asset_ids: a.asset_ids }),
  },
  {
    name: 'evolver_publish_asset',
    description: 'Publish one or more evolution assets (Genes/Capsules) to the EvoMap Hub for review. Queued locally and synced by the Proxy in the background; poll asset_submit_result with evolver_poll to see the Hub decision.',
    inputSchema: {
      type: 'object',
      properties: {
        assets: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['Gene', 'Capsule'] },
              content: { type: 'string' },
              summary: { type: 'string' },
              signals: { type: 'array', items: { type: 'string' } },
            },
            required: ['type', 'content'],
          },
        },
      },
      required: ['assets'],
      additionalProperties: false,
    },
    handler: (a) => proxyFetch('POST', '/asset/submit', { assets: a.assets }),
  },
  {
    name: 'evolver_distill_conversation',
    description: 'Distill a reusable Gene/Capsule from the current agent conversation. Provide a concrete summary, strategy/evidence, artifacts, and validation; the Proxy gates quality, stores locally, and queues Hub publishing.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string', description: 'Concrete reusable lesson or capability distilled from the conversation.' },
        platform: { type: 'string', default: 'codex' },
        thread_id: { type: 'string' },
        user_prompt: { type: 'string' },
        assistant_summary: { type: 'string' },
        transcript: { type: 'string' },
        signals: { type: 'array', items: { type: 'string' } },
        strategy: { type: 'array', items: { type: 'string' } },
        artifacts: { type: 'array', items: { type: 'string' } },
        validation: { type: 'array', items: { type: 'string' } },
        persist: { type: 'boolean', default: true },
        publish: { type: 'boolean', default: true },
        min_score: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    handler: (a) => proxyFetch('POST', '/conversation/distill', { ...a, platform: a.platform || 'codex' }),
  },
  {
    name: 'evolver_poll',
    description: 'Poll the local mailbox for inbound messages by type, e.g. "asset_submit_result" (Hub review decisions), "hub_event", or "task_available". Returns and does not auto-acknowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Message type filter, e.g. "asset_submit_result".' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      additionalProperties: false,
    },
    handler: (a) => proxyFetch('POST', '/mailbox/poll', { type: a.type, limit: a.limit || 10 }),
  },
  {
    name: 'evolver_install_codex_guidance',
    description: 'Install or update the global Codex ~/.codex/AGENTS.md Evolver guidance section. Creates a timestamped backup before writing. Use only when the user explicitly wants global Codex guidance installed or refreshed.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['en', 'zh'], default: 'en', description: 'Language for the injected AGENTS.md section.' },
        dry_run: { type: 'boolean', default: false, description: 'Preview the section and change action without writing files.' },
      },
      additionalProperties: false,
    },
    handler: installCodexGuidance,
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));

// ---- JSON-RPC plumbing ---------------------------------------------------

let outputFraming = 'jsonl';

function send(msg) {
  const payload = JSON.stringify(msg);
  if (outputFraming === 'content-length') {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
    return;
  }
  process.stdout.write(payload + '\n');
}
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handleToolCall(id, params) {
  const tool = TOOL_BY_NAME[params?.name];
  if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);
  let out;
  try {
    out = await tool.handler(params.arguments || {});
  } catch (e) {
    out = { ok: false, error: `Tool execution failed: ${e.message}` };
  }
  const text = out.ok ? JSON.stringify(out.data, null, 2) : out.error;
  reply(id, { content: [{ type: 'text', text }], isError: !out.ok });
}

async function dispatch(req) {
  const { id, method, params } = req;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions: 'Evolver Proxy bridge. Use evolver_search_assets before substantive work to reuse proven genes/capsules; evolver_status to check the Proxy; evolver_publish_asset to contribute new ones. Use evolver_install_codex_guidance only when the user explicitly wants global Codex AGENTS.md guidance installed or refreshed.',
      });
    case 'notifications/initialized':
    case 'initialized':
      return; // notification — no response
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call':
      return handleToolCall(id, params);
    default:
      if (isNotification) return; // ignore unknown notifications
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

// Track in-flight (async) requests so we never exit on stdin close while a
// tool call's reply is still pending — otherwise the last response is dropped.
let pending = 0;
let closed = false;
function maybeExit() { if (closed && pending === 0) process.exit(0); }
let idleTimer = null;
function armIdleExit() {
  if (!MCP_IDLE_EXIT_MS || MCP_IDLE_EXIT_MS < 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending === 0) {
      log(`idle for ${MCP_IDLE_EXIT_MS}ms; exiting so the MCP host can restart a fresh bridge`);
      process.exit(0);
    }
  }, MCP_IDLE_EXIT_MS);
  idleTimer.unref?.();
}

function shutdown(signal) {
  log(`received ${signal}; shutting down`);
  closed = true;
  maybeExit();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGHUP', () => shutdown('SIGHUP'));

function handleJsonRpcText(text, framing) {
  armIdleExit();
  outputFraming = framing;
  const trimmed = text.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { log('dropping non-JSON line'); return; }
  pending++;
  Promise.resolve(dispatch(req))
    .catch(e => {
      log('dispatch error:', e.message);
      if (req && req.id != null) replyError(req.id, -32603, `Internal error: ${e.message}`);
    })
    .finally(() => { pending--; armIdleExit(); maybeExit(); });
}

let inputBuffer = Buffer.alloc(0);
let inputEnded = false;

function headerEndOffset(buffer) {
  const crlf = buffer.indexOf('\r\n\r\n');
  if (crlf >= 0) return { headerEnd: crlf, bodyStart: crlf + 4 };
  const lf = buffer.indexOf('\n\n');
  if (lf >= 0) return { headerEnd: lf, bodyStart: lf + 2 };
  return null;
}

function contentLengthFrom(headerText) {
  for (const line of headerText.split(/\r?\n/)) {
    const match = line.match(/^Content-Length:\s*(\d+)\s*$/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function startsWithHeaderFrame(value) {
  const text = Buffer.isBuffer(value)
    ? value.toString('utf8', 0, Math.min(value.length, 128))
    : String(value);
  return /^[A-Za-z-]+:\s*/.test(text);
}

function processInputBuffer() {
  while (inputBuffer.length > 0) {
    if (startsWithHeaderFrame(inputBuffer)) {
      const offsets = headerEndOffset(inputBuffer);
      if (!offsets) return;
      const headerText = inputBuffer.subarray(0, offsets.headerEnd).toString('ascii');
      const length = contentLengthFrom(headerText);
      if (!Number.isFinite(length) || length < 0 || length > MAX_FRAME_BYTES) {
        log('dropping invalid Content-Length frame');
        inputBuffer = Buffer.alloc(0);
        return;
      }
      if (inputBuffer.length < offsets.bodyStart + length) return;
      const body = inputBuffer.subarray(offsets.bodyStart, offsets.bodyStart + length).toString('utf8');
      inputBuffer = inputBuffer.subarray(offsets.bodyStart + length);
      handleJsonRpcText(body, 'content-length');
      continue;
    }

    const newline = inputBuffer.indexOf('\n');
    if (newline < 0) return;
    const line = inputBuffer.subarray(0, newline).toString('utf8');
    inputBuffer = inputBuffer.subarray(newline + 1);
    handleJsonRpcText(line, 'jsonl');
  }
}

function finishInput() {
  if (inputEnded) return;
  inputEnded = true;
  processInputBuffer();
  const leftover = inputBuffer.toString('utf8').trim();
  if (leftover && !startsWithHeaderFrame(leftover)) {
    handleJsonRpcText(leftover, 'jsonl');
  } else if (leftover) {
    log('stdin closed with a partial Content-Length frame');
  }
  inputBuffer = Buffer.alloc(0);
  closed = true;
  maybeExit();
}

process.stdin.on('data', (chunk) => {
  armIdleExit();
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processInputBuffer();
});
process.stdin.on('error', (err) => log('stdin error:', err.message));
process.stdin.on('end', finishInput);
process.stdin.on('close', finishInput);

log(`ready (server ${SERVER.version}); proxy base ${readProxySettings().url}`);
armIdleExit();
