const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { CodexClient } = require('../src/codex.cjs');

function transport() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); const sent = [];
  child.stdin = new Writable({ write(chunk, _encoding, done) { const message = JSON.parse(chunk.toString()); sent.push(message); if (message.method === 'initialize') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\n')); done(); } });
  return { child, sent };
}

test('Codex transport frames split Unicode JSON and refuses unsolicited operation requests', async () => {
  const { child, sent } = transport(); const client = new CodexClient({ executable: process.execPath, spawnFn: () => child });
  await client.start();
  const reply = client.request('test/read', {}); const id = sent.at(-1).id;
  const bytes = Buffer.from(JSON.stringify({ id, result: { text: 'Reply ✓ नमस्ते' } }) + '\n');
  for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
  assert.equal((await reply).text, 'Reply ✓ नमस्ते');
  child.stdout.write(JSON.stringify({ id: 'tool-1', method: 'item/tool/call', params: { tool: 'send_message' } }) + '\n');
  assert.equal(sent.at(-1).error.code, -32601);
  child.stdout.write(JSON.stringify({ id: 'tool-2', method: 'mcpServer/elicitation/request', params: {} }) + '\n');
  assert.equal(sent.at(-1).result.action, 'decline');
  client.close();
});

test('an old process exit cannot disconnect a newly opened session', async () => {
  const first = transport(), second = transport(); let n = 0;
  const client = new CodexClient({ executable: process.execPath, spawnFn: () => (++n === 1 ? first.child : second.child) });
  await client.start(); client.close(); await client.start(); first.child.emit('exit');
  const pending = client.request('test/read', {}); second.child.stdout.write(JSON.stringify({ id: second.sent.at(-1).id, result: true }) + '\n');
  assert.equal(await pending, true); client.close();
});
