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

test('Codex is found on Windows as codex.exe on PATH or inside an npm global install behind the codex.cmd shim', () => {
  const { findCodex } = require('../src/codex.cjs');
  const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const nested = `${npm}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
  const options = files => ({ platform: 'win32', arch: 'x64', home: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', Path: `C:\\Windows;"${npm}"` }, exists: file => files.includes(file) });
  assert.equal(findCodex('', options([`${npm}\\codex.cmd`, nested])), nested);
  assert.equal(findCodex('', options(['C:\\Windows\\codex.exe', nested])), 'C:\\Windows\\codex.exe');
  assert.equal(findCodex('D:\\Codex\\codex.exe', options(['D:\\Codex\\codex.exe', nested])), 'D:\\Codex\\codex.exe');
  const arm = `${npm}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\bin\\codex.exe`;
  assert.equal(findCodex('', { ...options([arm]), arch: 'arm64' }), arm);
  assert.equal(findCodex('', options([`${npm}\\codex.cmd`])), '');
  assert.equal(findCodex('', { platform: 'darwin', env: { PATH: '/usr/bin:/opt/tools' }, home: '/Users/me', exists: file => file === '/opt/tools/codex' }), '/opt/tools/codex');
});

test('Mac Codex discovery works without a terminal PATH for system apps, user apps and both Homebrew prefixes', () => {
  const { findCodex } = require('../src/codex.cjs');
  const home = '/Users/Example Person';
  const paths = [
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    `${home}/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`,
    `${home}/Applications/Codex.app/Contents/Resources/codex`,
    `${home}/.local/bin/codex`, '/opt/homebrew/bin/codex', '/usr/local/bin/codex'
  ];
  for (const arch of ['arm64', 'x64']) {
    for (const executable of paths) {
      assert.equal(findCodex('', { platform: 'darwin', arch, home, env: { PATH: '/usr/bin:/bin' }, exists: file => file === executable }), executable);
    }
  }
  const chosen = `${home}/Dev tools/codex`;
  assert.equal(findCodex(chosen, { platform: 'darwin', home, env: {}, exists: file => file === chosen || file === paths[0] }), chosen);
  assert.equal(findCodex('', { platform: 'darwin', home, env: { PATH: '' }, exists: file => file === 'codex' }), '');
});

test('Codex paths with spaces are passed to spawn without a shell', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu codex '));
  const executable = path.join(folder, 'codex');
  fs.writeFileSync(executable, 'synthetic executable');
  const { child } = transport(); let options;
  const client = new CodexClient({ executable, cwd: folder, spawnFn: (file, args, opts) => {
    assert.equal(file, executable); assert.deepEqual(args.slice(0, 2), ['app-server', '--stdio']); options = opts; return child;
  } });
  try {
    await client.start();
    assert.equal(options.cwd, folder); assert.equal(options.shell, undefined);
  } finally { client.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
