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

test('named providers pin destinations and send validated AI requests', async () => {
  for (const [mode, endpoint] of Object.entries({ openrouter: 'https://openrouter.ai/api/v1/chat/completions', huggingface: 'https://router.huggingface.co/v1/chat/completions' })) {
    const connection = { mode, endpoint: 'https://wrong.example', model: mode === 'openrouter' ? 'openrouter/free' : 'openai/gpt-oss-120b' };
    assert.equal(validateConnection(connection).endpoint, endpoint);
    await assert.rejects(requestImprovement({ prompt: 'Hello' }, connection, '', () => { throw new Error('Must not fetch'); }), /API key/);
    const result = await requestImprovement({ prompt: 'Draft a response.' }, connection, 'provider-key', async (url, options) => {
      assert.equal(url, endpoint);
      assert.equal(options.headers.Authorization, 'Bearer provider-key');
      assert.equal(JSON.parse(options.body).model, connection.model);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }));
    });
    assert.equal(result.mode, mode);
    assert.equal(result.improved, suggestion.improved);
    for (const [status, message] of [[402, /credits/], [429, /quota/]]) {
      await assert.rejects(requestImprovement({ prompt: 'Hello' }, connection, 'provider-key', async () => new Response('', { status })), message);
    }
  }
});

test('Bedrock validates profile and region and drops any supplied HTTP endpoint', () => {
  const input = { mode: 'bedrock', profile: 'hyland-dev', region: 'us-east-1', model: 'approved-claude-id', endpoint: 'https://wrong.example' };
  assert.equal(validateConnection(input).endpoint, '');
  for (const profile of ['', '--profile', 'name;command', '../secret']) assert.throws(() => validateConnection({ ...input, profile }));
  assert.throws(() => validateConnection({ ...input, region: 'https://wrong.example' }));
});
test('Bedrock Converse uses chosen SSO profile, model and bounded generation', async () => {
  const { converse } = require('../src/bedrock.cjs');
  let destroyed = false;
  const dependencies = {
    fromSSO: options => { assert.equal(options.profile, 'hyland'); return 'sso-provider'; },
    ConverseCommand: class { constructor(input) { this.input = input; } },
    BedrockRuntimeClient: class {
      constructor(options) { assert.equal(options.region, 'us-east-1'); assert.equal(options.credentials, 'sso-provider'); }
      async send(command) { assert.equal(command.input.modelId, 'claude-id'); assert.equal(command.input.inferenceConfig.maxTokens, 4096); assert.equal(command.input.system[0].text, 'instructions'); return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify(suggestion) }] } }, usage: { inputTokens: 20, outputTokens: 30 } }; }
      destroy() { destroyed = true; }
    }
  };
  const result = await converse({ profile: 'hyland', region: 'us-east-1', model: 'claude-id' }, [{ content: 'instructions' }, { content: 'draft' }], dependencies);
  assert.equal(parseSuggestion(result.content).improved, suggestion.improved);
  assert.equal(result.usage.outputTokens, 30);
  assert.equal(destroyed, true);
});

test('AWS CLI discovery handles Windows installation paths and semicolon-separated PATH', () => {
  const { findAws } = require('../src/bedrock.cjs');
  const installed = 'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe';
  assert.equal(findAws({ platform: 'win32', env: {}, exists: file => file === installed }), installed);
  const custom = 'D:\\Company Tools\\aws.exe';
  assert.equal(findAws({ platform: 'win32', env: { PATH: 'C:\\Other;D:\\Company Tools' }, exists: file => file === custom }), custom);
  assert.equal(findAws({ platform: 'win32', env: {}, exists: () => false }), '');
});
