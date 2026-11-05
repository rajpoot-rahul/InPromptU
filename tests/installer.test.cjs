const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CATALOG, recommend, findOllama, pullModel, verifyMacApp, verifyWindowsInstaller, latestRelease, download } = require('../src/installer.cjs');

test('recommendations follow the computer: memory floors, disk space and a sensible default download', () => {
  const pick = specs => recommend(specs).find(m => m.recommended)?.name;
  assert.equal(pick({ ramGB: 8, freeGB: 100 }), 'gemma3:4b');
  assert.equal(pick({ ramGB: 16, freeGB: 100 }), 'qwen2.5:7b');
  assert.equal(pick({ ramGB: 64, freeGB: 600 }), 'gemma3:12b');
  assert.equal(pick({ ramGB: 4, freeGB: 100 }), undefined);
  assert.equal(pick({ ramGB: 64, freeGB: 5 }), 'llama3.2:3b');
  assert.equal(CATALOG.some(m => m.name === 'gemma3:1b'), false);
  const small = recommend({ ramGB: 8, freeGB: 100 });
  assert.match(small.find(m => m.name === 'gemma3:27b').reason, /needs 48 GB RAM/);
  assert.equal(small.filter(m => m.recommended).length, 1);
  assert.ok(CATALOG.every(m => m.license && m.size > 0));
});

test('existing Ollama installs are found on each platform', () => {
  assert.equal(findOllama('darwin', {}, file => file === '/opt/homebrew/bin/ollama'), '/opt/homebrew/bin/ollama');
  assert.equal(findOllama('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: '' }, file => file.endsWith(path.join('Programs', 'Ollama', 'ollama.exe'))), path.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'Ollama', 'ollama.exe'));
  assert.equal(findOllama('darwin', {}, () => false), '');
});

test('only an app signed by Ollama and notarized is accepted; other signers are refused', async () => {
  const calls = [];
  const signed = (authority, team) => async (file, args) => { calls.push([file, args[0]]); return { stdout: '', stderr: file.endsWith('codesign') && args[0] === '-dv' ? `Identifier=com.electron.ollama\nAuthority=Developer ID Application: ${authority}\nTeamIdentifier=${team}` : '' }; };
  assert.equal(await verifyMacApp('/tmp/Ollama.app', signed('Infra Technologies, Inc (3MU9H2V9Y9)', '3MU9H2V9Y9')), 'Infra Technologies, Inc (3MU9H2V9Y9)');
  assert.deepEqual(calls.map(c => c[1]), ['--verify', '-dv', '--assess']);
  await assert.rejects(verifyMacApp('/tmp/Ollama.app', signed('Ollama Lookalike (EVIL12345)', 'EVIL12345')), /not signed by Ollama/);
  await assert.rejects(verifyMacApp('/tmp/Ollama.app', async () => { throw new Error('code object is not signed at all'); }), /not signed/);
  assert.match(await verifyWindowsInstaller('C:\\tmp\\OllamaSetup.exe', async () => ({ stdout: 'Valid|CN="Infra Technologies, Inc", O="Infra Technologies, Inc"' })), /Infra Technologies/);
  await assert.rejects(verifyWindowsInstaller('C:\\tmp\\OllamaSetup.exe', async () => ({ stdout: 'NotSigned|' })), /not validly signed/);
});

test('release lookup prefers the official GitHub release and falls back to ollama.com', async () => {
  const asset = process.platform === 'darwin' ? 'Ollama-darwin.zip' : 'OllamaSetup.exe';
  const ok = await latestRelease(async () => new Response(JSON.stringify({ tag_name: 'v0.40.4', assets: [{ name: asset, size: 200000000, browser_download_url: `https://github.com/ollama/ollama/releases/download/v0.40.4/${asset}` }] })));
  assert.deepEqual([ok.version, ok.size, ok.source], ['v0.40.4', 200000000, 'GitHub release (github.com/ollama/ollama)']);
  const fallback = await latestRelease(async () => { throw new TypeError('offline'); });
  assert.equal(fallback.url, `https://ollama.com/download/${asset}`);
});

test('downloads stream to disk with progress and stop at the size limit', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-dl-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const progress = [];
  const body = () => new Response(new Uint8Array(5000), { headers: { 'content-length': '5000' } });
  assert.equal(await download('https://x/y', path.join(dir, 'a'), { fetchFn: async () => body(), onProgress: p => progress.push(p) }), 5000);
  assert.equal(progress.at(-1).total, 5000);
  await assert.rejects(download('https://x/y', path.join(dir, 'b'), { fetchFn: async () => body(), maxBytes: 100 }), /larger than expected/);
  await assert.rejects(download('https://x/y', path.join(dir, 'c'), { fetchFn: async () => new Response('', { status: 404 }) }), /failed \(404\)/);
});

test('model pulls report summed layer progress and clear errors', async () => {
  const stream = lines => new Response(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const updates = [];
  await pullModel('gemma3:4b', { onProgress: p => updates.push(p), fetchFn: async (url, options) => { assert.equal(url, 'http://localhost:11434/api/pull'); assert.equal(JSON.parse(options.body).model, 'gemma3:4b'); return stream([{ status: 'pulling manifest' }, { status: 'pulling a', digest: 'a', total: 100, completed: 50 }, { status: 'pulling b', digest: 'b', total: 300, completed: 300 }, { status: 'verifying sha256 digest' }, { status: 'success' }]); } });
  assert.ok(updates.some(u => u.total === 400 && u.done === 350));
  assert.equal(updates.at(-1).message, 'Model ready.');
  await assert.rejects(pullModel('nope:1b', { fetchFn: async () => stream([{ error: 'pull model manifest: file does not exist' }]) }), /was not found/);
  await assert.rejects(pullModel('half:1b', { fetchFn: async () => stream([{ status: 'pulling a', digest: 'a', total: 10, completed: 5 }]) }), /did not finish/);
  await assert.rejects(pullModel('bad name; rm -rf', { fetchFn: () => { throw new Error('must not fetch'); } }), /model name/);
});

test('a stalled model download stops with a resumable message instead of waiting forever', async () => {
  const fetchFn = async (_url, options) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ status: 'pulling a', digest: 'a', total: 100, completed: 99 }) + '\n'));
    options.signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  } }));
  await assert.rejects(pullModel('gemma3:1b', { fetchFn, stallMs: 50 }), /stopped making progress.*resume/);
});
