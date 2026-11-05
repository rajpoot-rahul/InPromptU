'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FILES } = require('../src/context-extension.cjs');
let electron;
try { const executable = require('electron'); if (fs.existsSync(executable)) electron = executable; } catch {}

test('the installed extension can be read out of a real ASAR archive by Electron into a browser-loadable folder', { skip: !electron }, async t => {
  const { createPackage } = await import('@electron/asar');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu packaged extension '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'bundle');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.mkdirSync(path.join(source, 'extensions', 'chatgpt-context'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../src/context-extension.cjs'), path.join(source, 'src/context-extension.cjs'));
  for (const name of FILES) fs.copyFileSync(path.join(__dirname, '../extensions/chatgpt-context', name), path.join(source, 'extensions/chatgpt-context', name));
  const archive = path.join(root, 'app.asar');
  await createPackage(source, archive);
  const profile = path.join(root, 'Application Support', 'Impromptu');
  const script = path.join(root, 'check.cjs');
  fs.writeFileSync(script, `const { prepareExtension } = require(process.argv[2]); console.log(prepareExtension(process.argv[3]));`);
  const result = spawnSync(electron, [script, path.join(archive, 'src/context-extension.cjs'), profile], {
    encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  assert.equal(result.error, undefined, `Electron extraction failed: ${result.error?.message || ''}\n${result.stderr || ''}\n${result.stdout || ''}`);
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(profile, 'browser-extensions', 'chatgpt-context');
  assert.equal(result.stdout.trim(), output);
  for (const name of FILES) assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(source, 'extensions/chatgpt-context', name)));
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  for (const name of [manifest.background.service_worker, manifest.options_page, ...manifest.content_scripts.flatMap(item => item.js)]) assert.ok(fs.existsSync(path.join(output, name)), name);
});
