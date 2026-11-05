const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ContextBridge, MAX_BODY } = require('../src/context-bridge.cjs');
const { AgentContext } = require('../src/agent-context.cjs');
function send(bridge, { token = bridge.token, origin, host, method = 'POST', route = '/context', body = '{}', type = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: bridge.port, method, path: route, headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, ...(origin ? { Origin: origin } : {}), ...(host ? { Host: host } : {}) } }, response => {
      let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve({ code: response.statusCode, headers: response.headers, text }));
    });
    req.on('error', reject); req.end(body);
  });
}
test('paired loopback bridge ingests real payloads, rejects unauthenticated and web-origin requests, and never exposes history', async t => {
  const service = new AgentContext();
  const bridge = new ContextBridge({ receive: payload => service.receive(payload) });
  t.after(() => bridge.stop()); await bridge.start();
  assert.equal(bridge.server.address().address, '127.0.0.1');
  assert.match(bridge.pairing(), /^impromptu:\d+:[a-f0-9]{64}$/);
  const body = JSON.stringify({ url: 'https://chatgpt.com/c/demo', title: 'Demo', messages: [{ role: 'user', text: 'Keep SQLite offline.' }] });
  assert.equal((await send(bridge, { body, token: 'wrong' })).code, 401);
  assert.equal((await send(bridge, { body, origin: 'https://chatgpt.com' })).code, 403);
  assert.equal((await send(bridge, { body, host: 'evil.example' })).code, 403);
  assert.equal((await send(bridge, { body, method: 'GET' })).code, 400);
  assert.equal((await send(bridge, { body, type: 'text/plain' })).code, 400);
  assert.equal((await send(bridge, { body: 'invalid json' })).code, 400);
  assert.equal((await send(bridge, { body: 'x'.repeat(MAX_BODY + 1) })).code, 413);
  const accepted = await send(bridge, { body, origin: `chrome-extension://${'a'.repeat(32)}` });
  assert.equal(accepted.code, 200); assert.equal(accepted.headers['access-control-allow-origin'], undefined);
  assert.doesNotMatch(accepted.text, /SQLite/); assert.equal(service.status().entries.length, 1);
  const old = bridge.token; bridge.stop(); await bridge.start();
  assert.notEqual(bridge.token, old); assert.equal((await send(bridge, { token: old, body })).code, 401);
});
