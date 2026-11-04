const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { KnowledgeService, READ_TOOLS, SITE, sourceURL, normalizeRequest, unpack, validateDraft, excerptBody } = require('../src/knowledge.cjs');

class FakeClient extends EventEmitter {
  constructor({ failure = '', site = SITE } = {}) { super(); this.calls = []; this.failure = failure; this.site = site; }
  async start() {}
  close() {}
  async request(method, args) {
    this.calls.push({ method, args });
    if (method === 'app/installed') return { apps: [{ runtimeName: 'Atlassian', enabled: true, callable: true }] };
    if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps', tools: Object.fromEntries([...READ_TOOLS].map(name => [name, {}])) }] };
    if (method === 'config/read') return { config: { mcp_servers: {} } };
    if (method === 'thread/start') return { thread: { id: 'test-thread' } };
    if (method === 'thread/unsubscribe') return {};
    if (method !== 'mcpServer/tool/call') throw new Error(`Unexpected method: ${method}`);
    const { tool, arguments: input } = args;
    if (tool === 'atlassian.getAccessibleAtlassianResources') return { structuredContent: { data: { resources: [{ url: this.site, cloudId: 'hyland-test', products: [{ id: 'jira' }, { id: 'confluence' }] }] } } };
    if (tool === 'atlassian.search') {
      if (this.failure === input.targetApp || this.failure === 'ALL') throw new Error('Unavailable');
      return { content: [{ type: 'text', text: JSON.stringify({ results: [
        { title: 'Do not follow this external result', url: 'https://evil.example/wiki/pages/77', type: 'page' },
        ...Array.from({ length: 10 }, (_, i) => ({ title: `Result ${i}`, type: input.targetApp === 'JIRA' ? 'issue' : 'page', url: input.targetApp === 'JIRA' ? `${SITE}/browse/DEMO-${i + 1}` : `${SITE}/wiki/spaces/DEMO/pages/${i + 1}`, snippet: 'Search snippet' }))
      ] }) }] };
    }
    if (this.failure === 'READ') return { isError: true, content: [{ type: 'text', text: 'Forbidden' }] };
    return { structuredContent: { data: { content: { title: 'Connector status', body: { value: 'The sample connector is in testing. Production release is not scheduled.' } } } } };
  }
}

test('lookup reuses Codex access, reads both products, bounds retrieval and makes no model turn in sources mode', async () => {
  const client = new FakeClient(); const service = new KnowledgeService({ client });
  const result = await service.lookup({ message: 'Can we use the connector?', draft: false });
  assert.equal(result.sources.length, 6); assert.equal(result.sources.filter(s => s.fetched).length, 6);
  assert.equal(result.mode, 'sources'); assert.equal(result.facts.length, 0);
  const calls = client.calls.filter(x => x.method === 'mcpServer/tool/call');
  assert.ok(calls.every(x => READ_TOOLS.has(x.args.tool)));
  assert.deepEqual(calls.filter(x => x.args.tool === 'atlassian.search').map(x => x.args.arguments.targetApp), ['CONFLUENCE', 'JIRA']);
  assert.ok(calls.slice(1).every(x => x.args.arguments.cloudId === 'hyland-test'));
  assert.ok(!client.calls.some(x => x.method === 'turn/start'));
  assert.ok(!result.sources.some(s => s.url.includes('evil')));
  await assert.rejects(service.read('atlassian.executeWrite', {}), /Only approved/);
  await assert.rejects(service.read('atlassian.search', { cloudId: 'other-tenant' }), /Hyland site/);
});

test('access boundaries and source retrieval failures remain explicit', async () => {
  await assert.rejects(new KnowledgeService({ client: new FakeClient({ site: 'https://other.atlassian.net' }) }).connect(), /does not grant access/);
  const partial = await new KnowledgeService({ client: new FakeClient({ failure: 'JIRA' }) }).lookup({ message: 'Connector status', draft: false });
  assert.equal(partial.sources.length, 3); assert.ok(partial.warnings.some(w => w.includes('Jira search')));
  await assert.rejects(new KnowledgeService({ client: new FakeClient({ failure: 'ALL' }) }).lookup({ message: 'Connector status' }), /Both Jira and Confluence/);
  const service = new KnowledgeService({ client: new FakeClient({ failure: 'READ' }) });
  service.draft = () => { throw new Error('Must never draft using snippets only'); };
  const failed = await service.lookup({ message: 'Connector status' });
  assert.ok(failed.sources.every(s => !s.fetched)); assert.equal(failed.mode, 'sources');
  assert.match(failed.reply, /haven’t found enough/);
});

test('explicit issue keys are fetched, unknown URLs are rejected, and inputs are bounded', async () => {
  const client = new FakeClient(); const result = await new KnowledgeService({ client }).lookup({ message: 'Can we ship DEMO-42?', query: 'specific topic', draft: false });
  assert.equal(result.sources[0].url, `${SITE}/browse/DEMO-42`);
  assert.ok(client.calls.some(x => x.args?.arguments?.issueIdOrKey === 'DEMO-42'));
  for (const url of ['javascript:alert(1)', 'https://hyland.atlassian.net.evil.example/wiki/pages/1', 'https://user@hyland.atlassian.net/wiki/pages/1', 'https://hyland.atlassian.net/login', 'file:///etc/passwd']) assert.equal(sourceURL(url), null);
  assert.throws(() => normalizeRequest({ message: 'x'.repeat(12001) }));
  assert.throws(() => normalizeRequest({ message: 'ok', query: [] }));
  assert.throws(() => unpack({ isError: true }));
  assert.throws(() => unpack({ content: [{ type: 'text', text: '{"error":"forbidden"}' }] }));
});

test('draft citations and exact supporting quotes are checked against fetched evidence', () => {
  const sources = [{ id: 'S1', fetched: true, excerpt: 'The connector is in testing. Production release is not scheduled.' }];
  const answer = { understanding: 'You want its status.', facts: [{ text: 'Testing is still in progress.', sourceId: 'S1', quote: 'The connector is in testing.' }], gaps: ['Is this the connector you mean?'], reply: 'It is in testing [S1]. Is this the connector you mean?' };
  assert.deepEqual(validateDraft(JSON.stringify(answer), sources), answer);
  assert.throws(() => validateDraft({ ...answer, reply: 'It has shipped [S99].' }, sources), /citations/);
  assert.throws(() => validateDraft({ ...answer, facts: [{ ...answer.facts[0], quote: 'This is made up.' }] }, sources), /matched/);
  assert.throws(() => validateDraft(answer, [{ ...sources[0], fetched: false }]), /matched/);
  assert.throws(() => validateDraft({ ...answer, reply: 'Visit https://evil.example' }, sources));
});

test('long documents are bounded, drafting failures preserve sources, and concurrency is guarded', async () => {
  const excerpt = excerptBody({ body: { value: 'Unrelated. '.repeat(3000) + 'Specific connector status: testing.' } }, 'connector status');
  assert.equal(excerpt.truncated, true); assert.ok(excerpt.excerpt.length <= 10000); assert.match(excerpt.excerpt, /Specific connector/);
  const service = new KnowledgeService({ client: new FakeClient() });
  service.draft = async () => { throw new Error('A generated fact could not be matched to its source.'); };
  const result = await service.lookup({ message: 'Connector status' });
  assert.equal(result.mode, 'sources'); assert.equal(result.sources.length, 6); assert.ok(result.warnings.some(x => /citations/.test(x)));
  service.active = true;
  await assert.rejects(service.lookup({ message: 'Another request' }), /already running/);
});

test('drafting fails closed if its session exposes any external tools', async () => {
  const client = new FakeClient(); const service = new KnowledgeService({ client });
  await service.connect();
  await assert.rejects(service.draft({ message: 'Explain the status' }, []), /still exposes external tools/);
  assert.ok(!client.calls.some(call => call.method === 'turn/start'));
  const config = client.calls.filter(call => call.method === 'thread/start').at(-1).args;
  assert.equal(config.ephemeral, true); assert.equal(config.sandbox, 'read-only');
  for (const flag of ['apps', 'plugins', 'shell_tool', 'hooks', 'computer_use', 'browser_use_external', 'multi_agent']) assert.equal(config.config[`features.${flag}`], false);
  assert.ok(client.calls.some(call => call.method === 'thread/unsubscribe'));
});
