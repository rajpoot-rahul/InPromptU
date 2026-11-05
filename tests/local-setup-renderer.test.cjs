'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flow = require('../src/setup-flow.js');

// Execute the real setup initializer/renderers with only their DOM and IPC boundaries stubbed.
// A fresh profile deliberately has no runtime result until the user opens Phase 2.
function setup(mode = 'offline') {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', dataset: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}
  }]));
  const $ = id => { assert.ok(elements.has(id), `Missing setup element #${id}`); return elements.get(id); };
  let detections = 0;
  const context = vm.createContext({ $, window: { ImpromptuSetup: flow, addEventListener() {} }, document: { querySelectorAll: () => [] },
    state: { connection: { mode, model: mode === 'openrouter' ? 'openrouter/free' : '' }, localOnly: false, setup: {} },
    api: { detectLocalAI: async () => { detections++; return { status: 'not-running', models: [] }; } },
    installRunning: false, busy: false, updateConnection() {}, knowledgeStatus() {}, renderChatModels() {},
    cleanError: value => String(value), escapeHtml: value => String(value), gb: value => String(value)
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('const flow = window.ImpromptuSetup;'), source.indexOf('let installPlan =')), context);
  return { $, run: code => vm.runInContext(code, context), detections: () => detections };
}

for (const mode of ['offline', 'openrouter', 'bedrock', 'huggingface', 'compatible']) {
  test(`${mode}: startup initializes local setup without a model list or background detection`, () => {
    const form = setup(mode);
    assert.doesNotThrow(() => form.run('setupFirstRun(); setupLocalAI();'));
    assert.equal(form.detections(), 0, 'non-local startup must not probe the local runtime');
    assert.equal(form.$('local-setup').dataset.status, 'checking');
    assert.equal(form.$('first-run').hidden, mode !== 'offline');
    assert.equal(form.$('local-attention').hidden, true);
    assert.equal(form.$('setup-message').textContent, 'Checking this computer…');
    assert.equal(typeof form.$('local-detect').onclick, 'function');
  });
}

test('local setup renders missing, empty and ready runtime results after the initial render', async () => {
  const form = setup();
  form.run('setupLocalAI();');
  await form.run('detectLocalAI()');
  assert.equal(form.detections(), 1);
  assert.equal(form.$('lo-runtime').textContent, 'Not set up');
  assert.equal(form.$('setup-message').textContent, flow.LOCAL_PHASE2);
  form.run("localAI = { status: 'no-models', models: [] }; renderSetup();");
  assert.equal(form.$('setup-message').textContent, flow.localMessage('no-models'));
  form.run("localAI = { status: 'ready', models: [{ name: 'test-model' }] }; renderSetup();");
  assert.match(form.$('setup-message').textContent, /ready with 1 installed model/);
  assert.equal(form.$('setup-model').value, 'test-model');
  assert.equal(form.$('setup-use').hidden, false);
  assert.equal(form.$('local-attention').hidden, true);
});
