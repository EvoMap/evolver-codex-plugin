import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { evolverCoreEntry, pathEngineManifests } from '../lib/local-ledger.mjs';

function globalEngineAt(prefixModules) {
  const engine = join(prefixModules, '@evomap', 'evolver');
  const core = join(engine, 'node_modules', '@evomap', 'evolver-core');
  mkdirSync(join(engine, 'bin'), { recursive: true });
  mkdirSync(core, { recursive: true });
  writeFileSync(join(engine, 'package.json'), JSON.stringify({ name: '@evomap/evolver', bin: { evolver: 'bin/evolver.js' } }));
  writeFileSync(join(engine, 'bin', 'evolver.js'), '');
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name: '@evomap/evolver-core', main: 'index.js' }));
  writeFileSync(join(core, 'index.js'), '');
  return { engine, core };
}

test('the core is found behind an evolver npm linked under a custom prefix', (t) => {
  const prefix = realpathSync(mkdtempSync(join(tmpdir(), 'evolver-prefix-')));
  t.after(() => rmSync(prefix, { recursive: true, force: true }));
  const { engine, core } = globalEngineAt(join(prefix, 'lib', 'node_modules'));
  mkdirSync(join(prefix, 'bin'));
  symlinkSync(join(engine, 'bin', 'evolver.js'), join(prefix, 'bin', 'evolver'));

  const manifests = pathEngineManifests({ env: { PATH: `/nonexistent:${join(prefix, 'bin')}` }, platform: 'linux' });
  assert.deepEqual(manifests, [join(engine, 'package.json')]);
  assert.equal(evolverCoreEntry(manifests), join(core, 'index.js'));
});

test("on Windows the core is found beside the evolver.cmd shim in npm's prefix, such as %APPDATA%\\npm", (t) => {
  const appData = realpathSync(mkdtempSync(join(tmpdir(), 'evolver-appdata-')));
  t.after(() => rmSync(appData, { recursive: true, force: true }));
  const npmDir = join(appData, 'npm');
  const { core } = globalEngineAt(join(npmDir, 'node_modules'));
  writeFileSync(join(npmDir, 'evolver.cmd'), '');

  const manifests = pathEngineManifests({ env: { Path: `C:\\nonexistent;${npmDir}` }, platform: 'win32' });
  assert.equal(evolverCoreEntry(manifests), join(core, 'index.js'));
});

test('no evolver on PATH gives no manifest', () => {
  assert.deepEqual(pathEngineManifests({ env: { PATH: '/nonexistent' }, platform: 'linux' }), []);
});
