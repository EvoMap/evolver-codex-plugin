import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const STATUS_TIMEOUT_MS = 1_500;
const DEFAULT_PORT = '19820';

function isLoopbackHost(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]' || value === '::1' || value.endsWith('.localhost');
}

export function normalizeLoopbackUrl(value) {
  try {
    const parsed = new URL(String(value));
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!isLoopbackHost(parsed.hostname) || parsed.username || parsed.password) return null;
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function settingsPath() {
  return join(homedir(), '.evolver', 'settings.json');
}

function readSettingsProxy() {
  try {
    const proxy = JSON.parse(readFileSync(settingsPath(), 'utf8'))?.proxy;
    return proxy && typeof proxy === 'object' ? proxy : null;
  } catch {
    return null;
  }
}

function readProxySettings(port) {
  const proxy = readSettingsProxy();
  const url = proxy?.url ? normalizeLoopbackUrl(proxy.url) : null;
  // The token belongs to the URL it was written with; a default port may be served by another process.
  const token = url && proxy?.token ? String(proxy.token) : null;
  return { url: url ?? `http://127.0.0.1:${port}`, token, fromSettings: url !== null };
}

// The Proxy records its own version and pid in settings.json when it starts, so
// this is the version actually serving requests — which can differ from the
// `evolver` found on PATH when another install started the Proxy.
export function describeProxyEndpoint(port = process.env.EVOMAP_PROXY_PORT || DEFAULT_PORT) {
  const proxy = readSettingsProxy();
  const { url, token, fromSettings } = readProxySettings(port);
  const fieldOf = (key) => (typeof proxy?.[key] === 'string' || typeof proxy?.[key] === 'number' ? proxy[key] : null);
  return {
    url,
    url_source: fromSettings ? settingsPath() : `default port ${port}`,
    token_present: token !== null,
    running_version: fieldOf('version'),
    pid: fieldOf('pid'),
    started_at: fieldOf('started_at'),
  };
}

const START_HINT =
  'Start it with `evolver lifecycle start`. ' +
  'Set EVOMAP_PROXY_PORT if you use a non-default port.';

function httpErrorHint(status, base, token) {
  if (status === 401 || status === 403) {
    return token
      ? ' The Proxy token in ~/.evolver/settings.json was rejected; restart Evolver so it writes fresh settings.'
      : ` No Proxy token was found and the request was rejected — another process may be using ${base}. ${START_HINT}`;
  }
  if (status === 404) return ` Endpoint not found at ${base} — upgrade or verify the Evolver Proxy.`;
  return '';
}

export function createProxyClient({
  port = process.env.EVOMAP_PROXY_PORT || DEFAULT_PORT,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  return async function proxyFetch(method, requestPath, body, callerSignal) {
    const { url: base, token } = readProxySettings(port);
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    let text;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      response = await fetch(base + requestPath, {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      text = await response.text();
    } catch (error) {
      if (callerSignal?.aborted) return { ok: false, error: 'Proxy request cancelled.' };
      const what = error?.name === 'TimeoutError' ? 'Proxy request timed out' : `Proxy connection failed: ${error?.message}`;
      return { ok: false, unreachable: true, error: `${what}. Evolver Proxy not reachable at ${base}. ${START_HINT}` };
    }

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return {
        ok: false,
        error:
          `Proxy at ${base} returned HTTP ${response.status}: ${JSON.stringify(data)}.` +
          httpErrorHint(response.status, base, token),
      };
    }
    return { ok: true, data };
  };
}

export async function runningProxy(proxyFetch = createProxyClient({ timeoutMs: STATUS_TIMEOUT_MS })) {
  const result = await proxyFetch('GET', '/proxy/status');
  if (!result.ok || result.data?.status !== 'running') return null;
  const version = describeProxyEndpoint().running_version;
  return { version: typeof version === 'string' ? version : null };
}
