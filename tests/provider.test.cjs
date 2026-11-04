const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConnection, parseSuggestion, requestImprovement } = require('../src/provider.cjs');
const config = { mode: 'compatible', endpoint: 'https://approved.example/v1/chat/completions', model: 'available-model' };
const suggestion = { improved: 'Draft a brief, grounded response.', changes: ['Added an evidence boundary.'], questions: ['Which source should this use?'] };

test('rejects insecure remote endpoints, URL credentials and remote local-model claims', () => {
  for (const endpoint of ['http://remote.example/chat', 'file:///etc/passwd', 'https://key:secret@example.com/chat', 'https://api.example/chat?key=secret']) assert.throws(() => validateConnection({ ...config, endpoint }));
  assert.throws(() => validateConnection({ ...config, mode: 'ollama' }), /localhost/);
  assert.equal(validateConnection({ ...config, endpoint: 'http://127.0.0.1:8080/chat' }).mode, 'compatible');
});
test('offline requests never call the network', async () => {
  const output = await requestImprovement({ prompt: 'Draft an email.' }, { mode: 'offline' }, '', () => { throw new Error('Network must not run'); });
  assert.equal(output.mode, 'offline');
});
test('compatible provider uses explicit credentials, refuses redirects and reports actual usage', async () => {
  const output = await requestImprovement({ prompt: 'Draft a response.', skillId: 'support' }, config, 'test-key', async (url, options) => {
    assert.equal(url, config.endpoint); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body); assert.equal(body.model, config.model); assert.equal(body.stream, false);
    assert.equal(JSON.parse(body.messages[1].content).prompt, 'Draft a response.');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }], usage: { prompt_tokens: 122, completion_tokens: 38 } }));
  });
  assert.equal(output.improved, suggestion.improved); assert.deepEqual(output.usage, { input: 122, output: 38 });
});
test('Ollama response is parsed without assuming usage when absent', async () => {
  const output = await requestImprovement({ prompt: 'Draft a response.' }, { mode: 'ollama', endpoint: 'http://localhost:11434/api/chat', model: 'local-model' }, 'must-not-send', async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined); assert.equal(JSON.parse(options.body).format, 'json');
    return new Response(JSON.stringify({ message: { content: JSON.stringify(suggestion) } }));
  });
  assert.equal(output.usage, null);
});
test('invalid model output and upstream failures never masquerade as a successful improvement', async () => {
  assert.throws(() => parseSuggestion('Here is my answer'), /invalid suggestion/);
  assert.throws(() => parseSuggestion(JSON.stringify({ ...suggestion, changes: [42] })), /invalid explanation/);
  assert.throws(() => parseSuggestion(JSON.stringify({ ...suggestion, improved: '' })), /improved prompt/);
  await assert.rejects(requestImprovement({ prompt: 'Hello' }, config, '', async () => new Response('private provider details', { status: 401 })), /failed \(401\)/);
  assert.deepEqual(parseSuggestion('```json\n' + JSON.stringify(suggestion) + '\n```'), suggestion);
});
