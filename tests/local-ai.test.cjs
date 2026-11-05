const test = require('node:test');
const assert = require('node:assert/strict');
const { probe, isLocalURL } = require('../src/ollama.cjs');
const { requestImprovement, assertAllowed, isLocalConnection, parseSuggestion } = require('../src/provider.cjs');
const suggestion = { improved: 'Summarise the notes as five bullets for the team.', changes: ['Named the format.'], questions: [] };
const local = { mode: 'ollama', endpoint: 'http://localhost:11434/api/chat', model: 'gemma4:latest' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('detection lists installed models and only ever contacts localhost', async () => {
  const urls = [];
  const result = await probe(undefined, async url => {
    urls.push(url);
    return url.endsWith('/api/version') ? json({ version: '0.40.4' }) : json({ models: [{ name: 'gemma4:latest', size: 9461576343, details: { family: 'gemma4', parameter_size: '8.1B' } }] });
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.models.map(m => [m.name, m.parameterSize]), [['gemma4:latest', '8.1B']]);
  assert.equal(result.message, 'Local AI is ready with 1 installed model.');
  assert.deepEqual(urls, ['http://localhost:11434/api/version', 'http://localhost:11434/api/tags']);
  await assert.rejects(probe('https://ollama.example.com/api/chat', () => { throw new Error('must not fetch'); }), /localhost/);
  assert.equal(isLocalURL('http://127.0.0.1:8080/v1'), true);
  assert.equal(isLocalURL('http://localhost.example.com/v1'), false);
});

test('detection distinguishes not running, no models, and a non-Ollama service', async () => {
  const refused = await probe(undefined, async () => { throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }); });
  assert.equal(refused.status, 'not-running');
  assert.equal(refused.message, "Local AI (Phase 2 preview) isn't set up on this computer.");
  const empty = await probe(undefined, async url => url.endsWith('/api/version') ? json({ version: '1.0' }) : json({ models: [] }));
  assert.equal(empty.status, 'no-models');
  const other = await probe(undefined, async () => new Response('not here', { status: 404 }));
  assert.equal(other.status, 'error');
  assert.equal(other.message, refused.message, 'an unexpected service reads as not set up, not as an error');
});

test('Ollama runners without structured output fall back once to prompt-only JSON', async () => {
  const bodies = [];
  const result = await requestImprovement({ prompt: 'Summarise these meeting notes for my team.' }, local, '', async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) return json({ error: 'structured output is unavailable' }, 501);
    return json({ message: { content: `Here you go:\n${JSON.stringify(suggestion)}` }, prompt_eval_count: 72, eval_count: 100 });
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].format, 'json'); assert.equal(bodies[0].think, false);
  assert.equal(bodies[1].format, undefined); assert.equal(bodies[1].think, false);
  assert.equal(result.improved, suggestion.improved);
  assert.equal(result.mode, 'ollama');
  assert.deepEqual(result.usage, { input: 72, output: 100 });
});

test('Ollama failures explain the local fix and never fabricate output', async () => {
  await assert.rejects(requestImprovement({ prompt: 'Hello there' }, local, '', async () => json({ error: "model 'gemma4:latest' not found" }, 404)), /not installed on this computer/);
  await assert.rejects(requestImprovement({ prompt: 'Hello there' }, local, '', async () => { throw new TypeError('fetch failed'); }), /isn't set up on this computer\. Your prompt is unchanged/);
  let calls = 0;
  await assert.rejects(requestImprovement({ prompt: 'Hello there' }, local, '', async () => { calls++; return json({ error: 'out of memory' }, 500); }), /Local AI could not run .*out of memory/);
  assert.equal(calls, 1);
  assert.throws(() => parseSuggestion('I cannot help with that.'), /invalid suggestion/);
});

test('local-only mode allows only on-device connections', () => {
  for (const connection of [{ mode: 'offline' }, local, { mode: 'compatible', endpoint: 'http://127.0.0.1:1234/v1/chat/completions' }]) {
    assert.equal(isLocalConnection(connection), true);
    assert.equal(assertAllowed(connection, true), connection);
  }
  for (const connection of [{ mode: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions' }, { mode: 'huggingface', endpoint: '' }, { mode: 'bedrock', endpoint: '' }, { mode: 'compatible', endpoint: 'https://approved.example/v1/chat/completions' }]) {
    assert.equal(isLocalConnection(connection), false);
    assert.throws(() => assertAllowed(connection, true), /Local-only mode is on/);
    assert.equal(assertAllowed(connection, false), connection);
  }
});
