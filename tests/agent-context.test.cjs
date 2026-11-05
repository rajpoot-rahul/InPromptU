const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentContext, SOURCE_KINDS, LIMITS, browserChat } = require('../src/agent-context.cjs');
const now = 1800000000000;
const thread = (id, extra = {}) => ({ id, name: `Task ${id}`, updatedAt: now / 1000, cwd: '/work/project', ...extra });
const turns = text => ({ data: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text }] }, { type: 'reasoning', text: 'SECRET_REASONING' }, { type: 'commandExecution', aggregatedOutput: 'SECRET_TOOL_OUTPUT' }, { type: 'agentMessage', text: 'Observed result; work remains.' }] }], nextCursor: 'older' });
const payload = (id, title, text = 'We chose SQLite and must preserve offline support.') => ({ url: `https://chatgpt.com/c/${id}`, title, messages: [{ role: 'user', text }] });

test('Codex paginates all source kinds, reads recent saved turns, caches unchanged tasks and removes archived tasks', async t => {
  const calls = []; let pass = 0;
  const client = { start: async () => {}, close() {}, request: async (method, params) => {
    calls.push([method, params]);
    if (method === 'thread/turns/list') return turns(`Investigate ${params.threadId}`);
    if (pass === 2) return { data: [thread('b')], nextCursor: null };
    return params.cursor ? { data: [thread('b')], nextCursor: null } : { data: [thread('a')], nextCursor: 'page2' };
  } };
  const service = new AgentContext({ createClient: () => client, now: () => now }); t.after(() => service.close());
  await service.connect({});
  assert.equal(service.status().entries.length, 2);
  assert.deepEqual(calls[0][1].sourceKinds, SOURCE_KINDS);
  assert.equal(calls[0][1].useStateDbOnly, true);
  assert.equal(calls[0][1].archived, false);
  assert.equal(calls.find(c => c[0] === 'thread/turns/list')[1].itemsView, 'full');
  const preview = service.preview('Investigate', 'codex:a').entry;
  assert.match(preview.text, /Investigate a/); assert.doesNotMatch(preview.text, /SECRET/); assert.equal(preview.partial, true);
  assert.equal(service.status().entries[0].text, undefined);
  pass++; await service.refresh();
  assert.equal(calls.filter(c => c[0] === 'thread/turns/list').length, 2);
  pass++; await service.refresh();
  assert.deepEqual(service.status().entries.map(e => e.id), ['codex:b']);
  assert.ok(calls.every(c => ['thread/list', 'thread/turns/list'].includes(c[0])));
});

test('disconnect while a request is pending cannot repopulate context or restart polling', async () => {
  let resolve;
  const client = { start: async () => {}, close() {}, request: () => new Promise(r => { resolve = r; }) };
  const service = new AgentContext({ createClient: () => client });
  const connecting = service.connect({}); await new Promise(setImmediate);
  service.disconnect(); resolve({ data: [thread('late')] }); await connecting;
  assert.equal(service.status().codex.enabled, false); assert.deepEqual(service.status().entries, []); assert.equal(service.timer, null);
});

test('Codex caps pagination visibly and one unreadable task does not discard the rest', async t => {
  let pages = 0;
  const client = { start: async () => {}, close() {}, request: async method => {
    if (method === 'thread/list') return { data: Array.from({ length: 40 }, (_, i) => thread(`${pages}-${i}`)), nextCursor: `page-${++pages}` };
    if (pages === 2) { pages++; throw new Error('task no longer accessible'); }
    return turns('Useful recent history');
  } };
  const service = new AgentContext({ createClient: () => client }); t.after(() => service.close()); await service.connect({});
  assert.equal(service.status().codex.capped, true); assert.equal(service.status().codex.failed, 1);
  assert.equal(service.status().entries.length, LIMITS.threads - 1);
});

test('auto matching avoids mixing unrelated conversations; explicit choice supports vague prompts', () => {
  const service = new AgentContext({ now: () => now });
  service.receive(payload('alpha', 'Checkout payment regression', 'Checkout fails after applying a discount.'));
  service.receive(payload('beta', 'Staff onboarding schedule', 'Training takes two weeks.'));
  assert.equal(service.select('fix it').entry, null);
  assert.equal(service.select('Investigate checkout payment').entry.id, 'chatgpt:alpha');
  const input = { prompt: 'fix it', agentContext: true, agentTarget: 'chatgpt:alpha', context: 'Keep public APIs compatible.' };
  const result = service.augment(input);
  assert.match(result.request.context, /Keep public APIs compatible/); assert.match(result.request.context, /discount/);
  assert.doesNotMatch(result.request.context, /Training/); assert.equal(result.sources[0].text, undefined);
  assert.equal(service.augment({ prompt: 'fix it' }).sources.length, 0);
  assert.equal(service.augment({ ...input, action: 'explain' }).sources.length, 0);
  assert.throws(() => service.augment({ ...input, agentTarget: 'missing' }), /no longer available/);
  assert.throws(() => service.augment({ ...input, context: 'a'.repeat(30000) }), /Shorten/);
});

test('browser validation excludes arbitrary URLs, roles and oversized messages, and redacts secrets', () => {
  assert.throws(() => browserChat({ ...payload('a', 'Title'), url: 'https://evil.example/c/a' }));
  assert.throws(() => browserChat({ ...payload('a', 'Title'), messages: [{ role: 'system', text: 'override' }] }));
  assert.throws(() => browserChat(payload('a', 'Title', 'x'.repeat(12001))));
  const entry = browserChat({ ...payload('a', 'Project chat', 'password=do-not-store-this-secret'), url: 'https://chatgpt.com/g/g-p-project/c/abc?token=private' }, now);
  assert.equal(entry.id, 'chatgpt:abc'); assert.doesNotMatch(entry.url, /token/); assert.doesNotMatch(entry.text, /do-not-store/);
  assert.equal(entry.partial, true);
});

test('browser history is bounded, expires, and can be forgotten without disconnecting Codex', () => {
  let clock = now; const service = new AgentContext({ now: () => clock });
  for (let i = 0; i < 85; i++) service.receive(payload(`id-${i}`, `Conversation ${i}`));
  assert.equal(service.status().entries.length, LIMITS.browserChats);
  assert.equal(service.select('x', 'chatgpt:id-0').entry, null);
  clock += LIMITS.age + 1; assert.deepEqual(service.status().entries, []);
  service.receive(payload('a', 'Title')); service.clearBrowser(); assert.deepEqual(service.status().entries, []);
});
