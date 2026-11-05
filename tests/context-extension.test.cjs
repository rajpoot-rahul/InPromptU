const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const folder = path.resolve(__dirname, '../extensions/chatgpt-context');

test('extension pairs only from its options, hides its secret, and forwards only the sender conversation', async () => {
  let listener, access; const storage = {}, requests = [];
  const extension = `chrome-extension://${'a'.repeat(32)}/`;
  const chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: { id: 'test-id', getURL: name => extension + name, onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: {
      setAccessLevel: async value => { access = value.accessLevel; },
      get: async () => storage,
      set: async values => Object.assign(storage, values),
      remove: async key => { delete storage[key]; }
    } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'background.js'), 'utf8'), { chrome, URL, AbortSignal, fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ accepted: true }) }; } });
  const send = (message, sender) => new Promise(resolve => listener(message, sender, resolve));
  const options = { id: 'test-id', url: extension + 'options.html', tab: { id: 1 } };
  const page = { frameId: 0, url: 'https://chatgpt.com/c/abc', tab: { url: 'https://chatgpt.com/c/abc' } };
  const code = `impromptu:43199:${'b'.repeat(64)}`;
  assert.ok((await send({ type: 'pair', code }, page)).error);
  assert.equal((await send({ type: 'pair', code }, options)).ok, true);
  assert.equal(access, 'TRUSTED_CONTEXTS');
  const enabled = await send({ type: 'enabled' }, page);
  assert.equal(enabled.enabled, true); assert.equal(enabled.token, undefined);
  assert.ok((await send({ type: 'snapshot', payload: { url: 'https://evil.example' } }, page)).error);
  assert.equal((await send({ type: 'snapshot', payload: { url: page.url, messages: [] } }, page)).ok, true);
  assert.equal(requests.at(-1).url, 'http://127.0.0.1:43199/context');
  assert.equal(requests.at(-1).options.credentials, 'omit');
  await send({ type: 'disconnect' }, options);
  assert.ok((await send({ type: 'snapshot', payload: { url: page.url } }, page)).error);
});

test('content collection waits for pairing, excludes the prompt composer, bounds history and handles navigation', async () => {
  let tick, enabled = false, reads = 0; const sent = [];
  const location = { origin: 'https://chatgpt.com', pathname: '/c/abc' };
  const document = { title: 'Checkout test', querySelectorAll: selector => {
    reads++; assert.match(selector, /data-message-author-role/); assert.doesNotMatch(selector, /textarea|contenteditable/);
    return ['Older exchange', 'x'.repeat(13000)].map(text => ({ innerText: text, getAttribute: () => 'user' }));
  } };
  const chrome = { runtime: { sendMessage: async message => { if (message.type === 'enabled') return { enabled }; sent.push(message); return { ok: true }; } } };
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'content.js'), 'utf8'), { chrome, document, location, setInterval: callback => { tick = callback; } });
  await tick(); assert.equal(reads, 0);
  enabled = true; await tick(); assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.messages.length, 1); assert.equal(sent[0].payload.messages[0].text.length, 12000);
  await tick(); assert.equal(sent.length, 1);
  location.pathname = '/c/next'; await tick(); assert.equal(sent.length, 1);
  await tick(); assert.equal(sent.at(-1).payload.url, 'https://chatgpt.com/c/next');
});
