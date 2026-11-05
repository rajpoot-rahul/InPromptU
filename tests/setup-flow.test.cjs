const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flow = require('../src/setup-flow.js');

const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
const section = id => {
  const start = html.indexOf(`<section id="${id}"`);
  assert.notEqual(start, -1, `missing #${id}`);
  const next = html.slice(start + 1).search(/\n    <section id="[a-z-]+-view"/);
  return next === -1 ? html.slice(start) : html.slice(start, start + 1 + next);
};

test('providers are ordered OpenRouter, Amazon Bedrock, Hugging Face, then the local model, Custom API and offline', () => {
  assert.deepEqual(flow.CLOUD_ORDER, ['openrouter', 'bedrock', 'huggingface', 'compatible']);
  assert.deepEqual(flow.MODE_ORDER, ['openrouter', 'bedrock', 'huggingface', 'ollama', 'compatible', 'offline']);
  const shuffled = ['compatible', 'huggingface', 'bedrock', 'openrouter', 'unknown'].map(mode => ({ mode }));
  assert.deepEqual(flow.sortByMode(shuffled).map(p => p.mode), ['openrouter', 'bedrock', 'huggingface', 'compatible', 'unknown']);
  assert.deepEqual(shuffled[0].mode, 'compatible', 'sorting does not mutate the input');
});

test('the Settings provider list follows the shared order and keeps its values', () => {
  const select = html.match(/<select id="connection-mode">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(m => m[1]), flow.MODE_ORDER);
});

test('the Prompt workspace opens with OpenRouter until a provider is configured or the card is dismissed', () => {
  const card = options => flow.workspaceCard({ mode: 'offline', ...options });
  assert.equal(card(), 'first-run');
  assert.equal(card({ localOnly: true }), 'first-run-local-only');
  assert.equal(card({ dismissed: true }), null);
  assert.equal(card({ hidden: true }), null);
  assert.equal(card({ preview: true }), null);
  for (const mode of ['openrouter', 'bedrock', 'huggingface', 'compatible']) assert.equal(card({ mode }), null);
  assert.equal(card({ mode: 'openrouter', completed: true }), 'first-run-done');
});

test('a configured local model that needs attention points to the Local AI tab instead of the setup flow', () => {
  const ready = { status: 'ready', models: [{ name: 'gemma3:4b' }] };
  assert.equal(flow.localNeedsAttention('ollama', 'gemma3:4b', ready), false);
  assert.equal(flow.localNeedsAttention('ollama', 'llama3.2', ready), true);
  assert.equal(flow.localNeedsAttention('ollama', 'gemma3:4b', { status: 'not-running', models: [] }), true);
  assert.equal(flow.localNeedsAttention('ollama', 'gemma3:4b', null), false, 'no warning before detection finishes');
  assert.equal(flow.localNeedsAttention('openrouter', 'openrouter/free', { status: 'not-running', models: [] }), false);
  assert.equal(flow.workspaceCard({ mode: 'ollama', localNeedsAttention: true }), 'local-attention');
  assert.equal(flow.workspaceCard({ mode: 'ollama', localNeedsAttention: true, hidden: true }), null);
  assert.equal(flow.workspaceCard({ mode: 'ollama', localNeedsAttention: false }), null);
  assert.equal(flow.runtimeStatus(null), 'checking');
  assert.equal(flow.runtimeStatus(ready, true), 'checking');
  assert.equal(flow.runtimeStatus({ status: 'surprise' }), 'error');
});

test('the local setup flow lives in the Local AI tab; the workspace keeps only the OpenRouter card and a pointer', () => {
  const workspace = section('workspace-view'), local = section('local-ai-view');
  assert.ok(!workspace.includes('id="local-setup"'));
  assert.ok(!workspace.includes('id="setup-auto"'));
  assert.match(workspace, /id="first-run"[\s\S]*id="or-key" type="password" autocomplete="off"/);
  assert.match(workspace, /data-setup-mode="bedrock"[\s\S]*data-setup-mode="huggingface"[\s\S]*data-open-local-ai=/);
  assert.match(workspace, /id="local-attention"[\s\S]*data-open-local-ai="setup"/);
  for (const id of ['local-setup', 'setup-auto', 'setup-use', 'setup-model', 'local-model-list', 'local-download', 'local-endpoint', 'local-detect', 'local-only-toggle']) assert.ok(local.includes(`id="${id}"`), `Local AI tab has #${id}`);
  const tabs = [...local.matchAll(/role="tab" id="([^"]+)" aria-controls="([^"]+)" aria-selected="(true|false)"/g)];
  assert.deepEqual(tabs.map(t => t[1]), ['local-tab-overview', 'local-tab-setup', 'local-tab-settings']);
  assert.deepEqual(tabs.map(t => t[3]), ['true', 'false', 'false']);
  for (const [, tab, panel] of tabs) assert.match(local, new RegExp(`role="tabpanel" id="${panel}" aria-labelledby="${tab}"`));
  assert.ok(local.includes('role="tablist"'));
});

test('the Phase 2 sidebar lists Local AI above Local chat', () => {
  const nav = html.match(/<nav aria-labelledby="preview-nav-label" class="preview-nav">([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]), ['local-ai', 'chat']);
  assert.ok(html.indexOf('src="setup-flow.js"') < html.indexOf('src="renderer.js"'));
});
