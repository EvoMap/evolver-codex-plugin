import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('../fixtures/fake-codex.mjs', import.meta.url));
const TOKEN = 'test-proxy-token';
const SYSTEM_PATH = process.platform === 'win32' ? process.env.PATH : '/usr/bin:/bin';

/** A HOME of its own for hook processes, with a `codex` on PATH that answers like `codex exec --json`. */
export function sandboxHome() {
  const home = mkdtempSync(join(tmpdir(), 'evolver-codex-home-'));
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  copyFileSync(FAKE_CODEX, join(bin, 'codex'));
  chmodSync(join(bin, 'codex'), 0o755);
  return {
    home,
    env: { ...process.env, HOME: home, USERPROFILE: home, PLUGIN_ROOT: pluginRoot, EVOMAP_PROXY_PORT: '1', PATH: `${bin}:${dirname(process.execPath)}:${SYSTEM_PATH}` },
    cleanup: () => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }),
  };
}

/** Points this process's own state at a fresh HOME for lib-level tests; returns the restore. */
export function freshHome(prefix = 'evolver-codex-lib-') {
  const previous = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), prefix));
  process.env.HOME = home;
  return () => {
    process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
  };
}

export function writeProxySettings(home, { url, version = '2.0.46' }) {
  mkdirSync(join(home, '.evolver'), { recursive: true });
  writeFileSync(join(home, '.evolver', 'settings.json'), JSON.stringify({ proxy: { url, token: TOKEN, version } }));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body ? JSON.parse(body) : {}));
  });
}

export async function fakeProxy({ assets = [] } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: 'unauthorized' });
    requests.push({ path: req.url, body });
    if (req.url === '/proxy/status') return reply(200, { status: 'running' });
    if (req.url === '/asset/fetch') return reply(200, { assets });
    if (req.url === '/asset/reuse-result') return reply(200, { recorded: true, eligible: true, counted: true, weight: 1 });
    if (req.url === '/conversation/distill') return reply(200, { id: 'gene_test' });
    return reply(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const of = (path) => requests.filter((request) => request.path === path).map((request) => request.body);
  return { url: `http://127.0.0.1:${server.address().port}`, requests, of, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function runHook(name, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(pluginRoot, 'hooks', `${name}.mjs`)], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(stdout ? JSON.parse(stdout) : {}) : reject(new Error(`${name} exited ${code}: ${stderr}`))));
    child.stdin.end(JSON.stringify(input));
  });
}

export async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (Array.isArray(value) ? value.length > 0 : value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting');
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid;
}
