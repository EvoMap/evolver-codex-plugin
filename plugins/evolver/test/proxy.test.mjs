import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { createProxyClient } from '../lib/proxy.mjs';
import { freshHome } from './helpers/sandbox.mjs';

let restoreHome = null;
let server = null;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  restoreHome?.();
  server = null;
  restoreHome = null;
});

async function listen(handler) {
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function writeSettings(proxy) {
  mkdirSync(join(homedir(), '.evolver'), { recursive: true });
  writeFileSync(join(homedir(), '.evolver', 'settings.json'), JSON.stringify({ proxy }));
}

test('a Proxy that sends its headers and then stalls the body times out as a failed request, not a thrown error', async () => {
  restoreHome = freshHome();
  const port = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"assets": [');
  });
  writeSettings({ url: `http://127.0.0.1:${port}`, token: 't' });

  const result = await createProxyClient({ timeoutMs: 200 })('POST', '/asset/fetch', { text: 'x' });

  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
});

test('a caller that cancels while the body is still arriving gets a cancelled result', async () => {
  restoreHome = freshHome();
  const port = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
  });
  writeSettings({ url: `http://127.0.0.1:${port}`, token: 't' });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);

  const result = await createProxyClient({ timeoutMs: 5_000 })('GET', '/proxy/status', undefined, controller.signal);

  assert.deepEqual(result, { ok: false, error: 'Proxy request cancelled.' });
});

test('the settings token goes only to the settings URL: an unusable URL falls back to the default port without it', async () => {
  restoreHome = freshHome();
  const seen = [];
  const port = await listen((req, res) => {
    seen.push(req.headers.authorization ?? null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"running"}');
  });
  writeSettings({ url: 'http://evil.example:19820', token: 'secret-token' });

  const result = await createProxyClient({ port: String(port) })('GET', '/proxy/status');

  assert.equal(result.ok, true);
  assert.deepEqual(seen, [null]);
});
