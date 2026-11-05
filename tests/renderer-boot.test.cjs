const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flow = require('../src/setup-flow.js');

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const boot = renderer.slice(renderer.indexOf('async function boot()'));

test('local AI status starts as checking before detection, so renderers must not assume a model list', () => {
  assert.equal(flow.runtimeStatus(null), 'checking');
  // Object-literal message maps evaluate every entry, so an unguarded read crashes while detection is pending.
  const setup = renderer.slice(renderer.indexOf('function renderSetup()'), renderer.indexOf("$('setup-message').classList"));
  assert.ok(setup.includes("$('setup-message').textContent"), 'renderSetup message map should be in this slice');
  assert.doesNotMatch(setup, /count: localAI\.models\.length/);
});

test('navigation is wired before feature setup, and each setup step is isolated', () => {
  const nav = boot.indexOf("document.querySelectorAll('[data-view]')");
  const firstSetup = boot.indexOf('setupKnowledge');
  assert.ok(nav !== -1 && firstSetup !== -1 && nav < firstSetup, 'sidebar handlers must be attached before setup steps run');
  assert.match(boot, /guarded\(name, step\)/);
  for (const step of ['setupKnowledge', 'setupChat', 'setupMascot', 'setupContext', 'setupHyland', 'setupInstaller', 'setupFirstRun', 'setupLocalAI']) {
    assert.ok(boot.includes(`, ${step}]`), `${step} should run through guarded()`);
  }
});
