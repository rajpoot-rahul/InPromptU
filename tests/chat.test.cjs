const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatStore, streamChat, LIMITS, SYSTEM } = require('../src/chat.cjs');

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'chats.json');
}
function ndjson(lines, { split = 7 } = {}) {
  const bytes = new TextEncoder().encode(lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split)); controller.close(); } }));
}

test('saved chats persist with restricted permissions; temporary chats never reach disk', t => {
  const file = tempFile(t);
  const store = new ChatStore(file);
  const saved = store.create({ model: 'gemma4:latest', temporary: false });
  store.append(saved.id, { role: 'user', content: 'How do I write a better prompt for summaries?' });
  const temporary = store.create({ model: 'gemma4:latest', temporary: true });
  store.append(temporary.id, { role: 'user', content: 'Private scratch question' });
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(disk.conversations.map(c => c.title), ['How do I write a better prompt for summaries?']);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('Private scratch'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const reopened = new ChatStore(file);
  assert.equal(reopened.conversations.length, 1);
  assert.equal(reopened.summaries()[0].count, 1);
});

test('delete, clear-all and rollback are written immediately', t => {
  const file = tempFile(t);
  const store = new ChatStore(file);
  const a = store.create({ model: 'm', temporary: false }); store.append(a.id, { role: 'user', content: 'first chat' });
  const b = store.create({ model: 'm', temporary: false }); const pending = store.append(b.id, { role: 'user', content: 'unanswered' });
  store.removeMessage(b.id, pending.id);
  assert.deepEqual(new ChatStore(file).summaries().map(c => c.title), ['first chat']);
  store.delete(a.id);
  assert.equal(new ChatStore(file).conversations.length, 0);
  const c = store.create({ model: 'm', temporary: false }); store.append(c.id, { role: 'user', content: 'again' });
  store.clear();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).conversations, []);
  assert.throws(() => store.get(c.id), /no longer exists/);
});

test('context keeps the system guardrail and newest messages within the budget', t => {
  const store = new ChatStore(tempFile(t));
  const chat = store.create({ model: 'm', temporary: true });
  for (let i = 0; i < 5; i++) { store.append(chat.id, { role: 'user', content: `${i}`.repeat(20000) }); store.append(chat.id, { role: 'assistant', content: 'ok' }); }
  store.append(chat.id, { role: 'user', content: 'latest question' });
  const context = store.context(chat.id);
  assert.equal(context[0].content, SYSTEM);
  assert.equal(context.at(-1).content, 'latest question');
  assert.ok(context.slice(1).reduce((n, m) => n + m.content.length, 0) <= LIMITS.context);
  assert.ok(context.length < 12);
});

test('streaming reassembles split NDJSON, reports usage and only calls localhost', async () => {
  const deltas = []; let request;
  const result = await streamChat({ endpoint: 'http://localhost:11434/api/chat', model: 'gemma4:latest', messages: [{ role: 'user', content: 'Hi' }], onDelta: d => deltas.push(d), fetchFn: async (url, options) => {
    request = { url, body: JSON.parse(options.body), redirect: options.redirect };
    return ndjson([{ message: { content: 'Hello ' } }, { message: { content: 'from ünïcode ✓' } }, { done: true, prompt_eval_count: 12, eval_count: 5 }], { split: 3 });
  } });
  assert.equal(result.text, 'Hello from ünïcode ✓');
  assert.deepEqual(deltas, ['Hello ', 'from ünïcode ✓']);
  assert.deepEqual(result.usage, { input: 12, output: 5 });
  assert.equal(request.url, 'http://localhost:11434/api/chat');
  assert.equal(request.body.stream, true); assert.equal(request.body.think, false); assert.equal(request.redirect, 'error');
  await assert.rejects(streamChat({ endpoint: 'https://cloud.example/api/chat', model: 'm', messages: [], fetchFn: () => { throw new Error('must not fetch'); } }), /localhost/);
});

test('streaming failures are explicit and never produce a fake reply', async () => {
  const base = { endpoint: 'http://localhost:11434/api/chat', model: 'gemma4:latest', messages: [] };
  await assert.rejects(streamChat({ ...base, fetchFn: async () => { throw new TypeError('fetch failed'); } }), /isn't set up on this computer/);
  await assert.rejects(streamChat({ ...base, fetchFn: async () => new Response(JSON.stringify({ error: "model 'gemma4:latest' not found" }), { status: 404 }) }), /not installed/);
  await assert.rejects(streamChat({ ...base, fetchFn: async () => ndjson([{ message: { content: 'par' } }, { error: 'runner crashed' }]) }), /runner crashed/);
  await assert.rejects(streamChat({ ...base, fetchFn: async () => ndjson([{ done: true }]) }), /empty reply/);
  let calls = 0;
  const retried = await streamChat({ ...base, fetchFn: async (_url, options) => { calls++; return JSON.parse(options.body).think === false ? new Response(JSON.stringify({ error: 'model does not support thinking' }), { status: 400 }) : ndjson([{ message: { content: 'ok' } }, { done: true }]); } });
  assert.equal(retried.text, 'ok'); assert.equal(calls, 2);
});
