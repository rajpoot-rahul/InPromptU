const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CATALOG, recommend, findOllama, startOllama, pullModel, verifyMacApp, verifyWindowsInstaller, readWindowsSignature, isOllamaWindowsSigner, installOllama, latestRelease, download, SIGNATURE_SCRIPT } = require('../src/installer.cjs');
const { powershell, parseDN } = require('../src/windows.cjs');
// Subject of Ollama's Authenticode certificate as .NET prints it (from OllamaSetup.exe v0.40.14).
const OLLAMA_SUBJECT = 'CN=Ollama Inc., O=Ollama Inc., L=Toronto, S=Ontario, C=CA, SERIALNUMBER=2713355, OID.2.5.4.15=Private Organization, OID.1.3.6.1.4.1.311.60.2.1.2=Ontario, OID.1.3.6.1.4.1.311.60.2.1.3=CA';

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
  assert.equal(findOllama('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: '' }, file => file === 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe'), 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe');
  assert.equal(findOllama('win32', { Path: 'C:\\Windows;"D:\\Tools\\Ollama";' }, file => file === 'D:\\Tools\\Ollama\\ollama.exe'), 'D:\\Tools\\Ollama\\ollama.exe');
  assert.equal(findOllama('win32', { ProgramFiles: 'C:\\Program Files' }, file => file === 'C:\\Program Files\\Ollama\\ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe');
  assert.equal(findOllama('win32', {}, () => true).startsWith('\\'), false);
  assert.equal(findOllama('darwin', {}, () => false), '');
});

test('an installed but stopped Ollama starts its tray app on Windows, ollama serve otherwise, or the Mac app', async () => {
  const spawned = [];
  const spawnFn = (file, args, options) => { spawned.push({ file, args, options }); return { on() {}, unref() {} }; };
  const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe';
  assert.deepEqual(await startOllama(exe, { platform: 'win32', exists: file => file === 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama app.exe', spawnFn }), { file: 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama app.exe', args: [] });
  assert.deepEqual(await startOllama('D:\\Tools\\ollama.exe', { platform: 'win32', exists: () => false, spawnFn }), { file: 'D:\\Tools\\ollama.exe', args: ['serve'] });
  assert.ok(spawned.every(s => s.options.detached && s.options.windowsHide && s.options.stdio === 'ignore'));
  const opened = [];
  await startOllama('/Applications/Ollama.app', { platform: 'darwin', execFn: (file, args, done) => { opened.push([file, ...args]); done(null); }, spawnFn });
  assert.deepEqual(opened, [['/usr/bin/open', '-g', '/Applications/Ollama.app']]);
  assert.equal(spawned.length, 2);
  assert.throws(() => startOllama('', { platform: 'win32' }), /not found/);
});

test('only an app signed by Ollama and notarized is accepted; other signers are refused', async () => {
  const calls = [];
  const signed = (authority, team) => async (file, args) => { calls.push([file, args[0]]); return { stdout: '', stderr: file.endsWith('codesign') && args[0] === '-dv' ? `Identifier=com.electron.ollama\nAuthority=Developer ID Application: ${authority}\nTeamIdentifier=${team}` : '' }; };
  assert.equal(await verifyMacApp('/tmp/Ollama.app', signed('Infra Technologies, Inc (3MU9H2V9Y9)', '3MU9H2V9Y9')), 'Infra Technologies, Inc (3MU9H2V9Y9)');
  assert.deepEqual(calls.map(c => c[1]), ['--verify', '-dv', '--assess']);
  await assert.rejects(verifyMacApp('/tmp/Ollama.app', signed('Ollama Lookalike (EVIL12345)', 'EVIL12345')), /not signed by Ollama/);
  await assert.rejects(verifyMacApp('/tmp/Ollama.app', async () => { throw new Error('code object is not signed at all'); }), /not signed/);
});

test('Windows accepts only a valid Authenticode signature from Ollama Inc., checked without putting the path in a script', async () => {
  const calls = [];
  const signature = (status, subject) => async (file, args, options) => { calls.push({ file, args, options }); return { stdout: `\uFEFF${JSON.stringify({ status, subject })}\r\n`, stderr: '' }; };
  const env = { SystemRoot: 'C:\\Windows', PATH: 'C:\\evil' };
  const file = "C:\\Users\\O'Brien\\AppData\\Local\\Temp\\impromptu-ollama-x\\OllamaSetup.exe";
  assert.equal(await verifyWindowsInstaller(file, signature('Valid', OLLAMA_SUBJECT), env), 'Ollama Inc.');
  assert.equal(calls[0].file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(calls[0].args.at(-1), SIGNATURE_SCRIPT);
  assert.ok(!calls[0].args.join(' ').includes('OllamaSetup'));
  assert.equal(calls[0].options.env.IMPROMPTU_VERIFY_FILE, file);
  await verifyWindowsInstaller(file, signature('Valid', OLLAMA_SUBJECT), { ...env, PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules' });
  assert.equal(Object.keys(calls.at(-1).options.env).some(key => key.toLowerCase() === 'psmodulepath'), false);
  assert.equal(calls.at(-1).options.env.SystemRoot, 'C:\\Windows');
  await assert.rejects(verifyWindowsInstaller(file, signature('HashMismatch', OLLAMA_SUBJECT), env), /not validly signed by Ollama Inc/);
  await assert.rejects(verifyWindowsInstaller(file, signature('NotSigned', ''), env), /not validly signed/);
  await assert.rejects(verifyWindowsInstaller(file, signature('Valid', 'CN=Ollama Helper Ltd, O=Ollama Helper Ltd'), env), /not validly signed/);
  await assert.rejects(verifyWindowsInstaller(file, signature('Valid', 'CN=Ollama Inc., O=Ollama Inc., SERIALNUMBER=9999999'), env), /not validly signed/);
  await assert.rejects(verifyWindowsInstaller(file, signature('Valid', 'CN="Infra Technologies, Inc", O="Infra Technologies, Inc"'), env), /not validly signed/);
  await assert.rejects(verifyWindowsInstaller(file, async () => ({ stdout: 'garbage' }), env), /not validly signed/);
  assert.deepEqual(parseDN('CN="Smith, Jones ""Ltd""", O=Acme'), { CN: 'Smith, Jones "Ltd"', O: 'Acme' });
  assert.equal(isOllamaWindowsSigner('CN=Ollama Inc., O=Ollama Inc., OID.2.5.4.5=2713355'), true);
  assert.equal(powershell({}), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});

test('the Windows install downloads OllamaSetup.exe, verifies it, runs Inno Setup silently and starts Ollama if needed', async () => {
  const runs = [], started = [];
  let serverUp = false, versionCalls = 0;
  const asset = { name: 'OllamaSetup.exe', size: 1675999728, browser_download_url: 'https://github.com/ollama/ollama/releases/download/v0.40.14/OllamaSetup.exe' };
  const fetchFn = async url => {
    if (url.includes('api.github.com')) return new Response(JSON.stringify({ tag_name: 'v0.40.14', assets: [asset] }));
    if (url.endsWith('/OllamaSetup.exe')) return new Response(new Uint8Array(1000));
    if (url.endsWith('/api/version')) { versionCalls++; if (serverUp) return new Response('{"version":"0.40.14"}'); throw new TypeError('fetch failed'); }
    throw new Error(`unexpected ${url}`);
  };
  const runFn = async (file, args) => {
    runs.push([path.win32.basename(file), ...args]);
    return { stdout: file.endsWith('powershell.exe') ? JSON.stringify({ status: 'Valid', subject: OLLAMA_SUBJECT }) : '', stderr: '' };
  };
  const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe';
  const progress = [];
  const result = await installOllama({ platform: 'win32', fetchFn, runFn, freeGB: () => 50, findFn: () => exe, startFn: async found => { started.push(found); serverUp = true; }, serverTimeoutMs: 10, onProgress: p => progress.push(p.stage) });
  assert.equal(result.version, 'v0.40.14');
  assert.deepEqual(runs.map(r => r[0]), ['powershell.exe', 'OllamaSetup.exe']);
  assert.deepEqual(runs[1].slice(1), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-']);
  assert.deepEqual(started, [exe]);
  assert.ok(versionCalls >= 2);
  assert.deepEqual([...new Set(progress)], ['download', 'verify', 'install', 'start']);
  runs.length = 0;
  await assert.rejects(installOllama({ platform: 'win32', fetchFn, runFn: async (file, args) => { runs.push(path.win32.basename(file)); return { stdout: JSON.stringify({ status: 'Valid', subject: 'CN=Someone Else' }) }; }, freeGB: () => 50 }), /not validly signed/);
  assert.deepEqual(runs, ['powershell.exe']);
  await assert.rejects(installOllama({ platform: 'win32', fetchFn, runFn, freeGB: () => 3 }), /Not enough free disk space to install Ollama/);
  await assert.rejects(installOllama({ platform: 'linux', fetchFn, runFn }), /macOS and Windows/);
});

test('on a real Windows machine the signature script runs and .NET renders the Ollama subject as pinned', { skip: process.platform !== 'win32' && 'needs Windows PowerShell' }, async () => {
  const pem = fs.readFileSync(path.join(__dirname, 'fixtures', 'ollama-inc-codesign.pem'), 'utf8');
  const cer = path.join(os.tmpdir(), `impromptu-ollama-${Date.now()}.cer`);
  fs.writeFileSync(cer, Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64'));
  let subject;
  try { subject = execFileSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Cryptography.X509Certificates.X509Certificate2]::new($env:IMPROMPTU_CERT).Subject'], { env: { ...process.env, IMPROMPTU_CERT: cer }, encoding: 'utf8' }).trim(); }
  finally { fs.rmSync(cer, { force: true }); }
  console.log(`.NET subject of Ollama's certificate: ${subject}`);
  assert.ok(isOllamaWindowsSigner(subject), `pin rejected the real subject: ${subject}`);
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const signature = await readWindowsSignature(system);
  if (signature.status !== 'Valid') {
    const raw = require('node:child_process').spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', SIGNATURE_SCRIPT], { env: { ...process.env, IMPROMPTU_VERIFY_FILE: system }, encoding: 'utf8' });
    assert.fail(`signature script returned ${JSON.stringify(signature)}; raw stdout ${JSON.stringify(raw.stdout)} stderr ${JSON.stringify(raw.stderr)}`);
  }
  assert.match(signature.subject, /Microsoft/);
  await assert.rejects(verifyWindowsInstaller(system), /not validly signed by Ollama Inc/);
  const tricky = path.join(os.tmpdir(), `impromptu 'quote' $(x) ${Date.now()}.exe`);
  fs.writeFileSync(tricky, 'not signed');
  try { const unsigned = await readWindowsSignature(tricky); assert.ok(unsigned.status && unsigned.status !== 'Valid', JSON.stringify(unsigned)); } finally { fs.rmSync(tricky, { force: true }); }
});

test('release lookup prefers the official GitHub release and falls back to ollama.com', async () => {
  for (const [platform, asset] of [['darwin', 'Ollama-darwin.zip'], ['win32', 'OllamaSetup.exe']]) {
    const ok = await latestRelease(async () => new Response(JSON.stringify({ tag_name: 'v0.40.4', assets: [{ name: 'Ollama-darwin.zip', size: 200000000, browser_download_url: 'https://github.com/ollama/ollama/releases/download/v0.40.4/Ollama-darwin.zip' }, { name: 'OllamaSetup.exe', size: 1675999728, browser_download_url: 'https://github.com/ollama/ollama/releases/download/v0.40.4/OllamaSetup.exe' }] })), platform);
    assert.deepEqual([ok.version, ok.url.endsWith(asset), ok.source], ['v0.40.4', true, 'GitHub release (github.com/ollama/ollama)']);
    const fallback = await latestRelease(async () => { throw new TypeError('offline'); }, platform);
    assert.equal(fallback.url, `https://ollama.com/download/${asset}`);
  }
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
