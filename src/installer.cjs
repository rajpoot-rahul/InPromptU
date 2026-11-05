'use strict';
// Consent-based local AI setup: installs the official Ollama app and downloads one chosen open model.
// Nothing here runs unless the user explicitly agrees in the setup dialog.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { ollamaOrigin, DEFAULT_ENDPOINT } = require('./ollama.cjs');
const { powershell, powershellEnv, parseDN } = require('./windows.cjs');

// Sizes are the registry download sizes; minRam is a practical floor for responsive use.
// gemma3:1b was tested and excluded: it echoes the request instead of following Impromptu's structured prompts.
const CATALOG = [
  { name: 'llama3.2:3b', label: 'Llama 3.2 · 3B', size: 2.02, minRam: 8, quality: 2, vision: false, note: 'Small and fast. Good everyday prompt help.', license: 'Llama 3.2 Community License' },
  { name: 'gemma3:4b', label: 'Gemma 3 · 4B', size: 3.35, minRam: 8, quality: 3, vision: true, note: 'Balanced, and can read screenshots for the mascot.', license: 'Gemma Terms of Use' },
  { name: 'qwen2.5:7b', label: 'Qwen 2.5 · 7B', size: 4.68, minRam: 16, quality: 4, vision: false, note: 'Stronger writing and analysis.', license: 'Apache 2.0' },
  { name: 'llama3.1:8b', label: 'Llama 3.1 · 8B', size: 4.92, minRam: 16, quality: 4, vision: false, note: 'Strong general assistant.', license: 'Llama 3.1 Community License' },
  { name: 'gemma3:12b', label: 'Gemma 3 · 12B', size: 8.16, minRam: 24, quality: 6, vision: true, note: 'High quality, reads screenshots well.', license: 'Gemma Terms of Use' },
  { name: 'phi4:14b', label: 'Phi-4 · 14B', size: 9.05, minRam: 24, quality: 6, vision: false, note: 'Strong reasoning for its size.', license: 'MIT' },
  { name: 'gemma3:27b', label: 'Gemma 3 · 27B', size: 17.41, minRam: 48, quality: 8, vision: true, note: 'Best quality here; large download and slower.', license: 'Gemma Terms of Use' }
];
const MODEL = /^[a-z0-9][a-z0-9._-]{0,80}(\/[a-z0-9][a-z0-9._-]{0,80})?(:[a-z0-9][a-z0-9._-]{0,60})?$/;

function systemSpecs(dir = os.homedir()) {
  let freeGB = null;
  try { const stat = fs.statfsSync(dir); freeGB = Math.round((stat.bavail * stat.bsize) / 1e9); } catch {}
  return { ramGB: Math.round(os.totalmem() / 1073741824), freeGB, platform: process.platform, arch: process.arch };
}
function recommend(specs, catalog = CATALOG) {
  const models = catalog.map(model => {
    const reasons = [];
    if (specs.ramGB < model.minRam) reasons.push(`needs ${model.minRam} GB RAM (this computer has ${specs.ramGB} GB)`);
    if (specs.freeGB !== null && specs.freeGB < model.size * 1.2 + 2) reasons.push(`needs about ${Math.ceil(model.size * 1.2 + 2)} GB free disk`);
    return { ...model, fits: !reasons.length, reason: reasons.join('; '), page: `https://ollama.com/library/${model.name.split(':')[0]}` };
  });
  const candidates = models.filter(m => m.fits && m.size <= 10);
  const best = candidates.sort((a, b) => b.quality - a.quality || Number(b.vision) - Number(a.vision) || a.size - b.size)[0];
  return models.map(m => ({ ...m, recommended: m.name === best?.name }));
}

const isFileOrApp = file => { try { const stat = fs.statSync(file); return stat.isFile() || stat.isDirectory(); } catch { return false; } };
// The official Windows installer is per-user: %LOCALAPPDATA%\Programs\Ollama holds ollama.exe and the "ollama app.exe" tray app.
function findOllama(platform = process.platform, env = process.env, exists = isFileOrApp) {
  const win = platform === 'win32';
  const pathDirs = String(env.PATH || env.Path || '').split(win ? ';' : ':').map(dir => dir.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  const candidates = platform === 'darwin'
    ? ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications/Ollama.app'), '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']
    : win ? [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'), env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Ollama', 'ollama.exe'), ...pathDirs.map(dir => path.win32.join(dir, 'ollama.exe'))].filter(Boolean)
      : pathDirs.map(dir => path.join(dir, 'ollama'));
  return candidates.find(exists) || '';
}

// Starts an installed Ollama in the background. Windows prefers the tray app, which runs the server and its updater.
function startOllama(found, { platform = process.platform, exists = isFileOrApp, execFn = execFile, spawnFn = spawn } = {}) {
  if (!found) throw new Error('The local AI runtime was not found on this computer.');
  if (platform === 'darwin' && found.endsWith('.app')) return new Promise((resolve, reject) => execFn('/usr/bin/open', ['-g', found], error => error ? reject(error) : resolve({ file: '/usr/bin/open', args: ['-g', found] })));
  const tray = platform === 'win32' ? path.win32.join(path.win32.dirname(found), 'ollama app.exe') : '';
  const [file, args] = tray && exists(tray) ? [tray, []] : [found, ['serve']];
  const child = spawnFn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on?.('error', () => {});
  child.unref?.();
  return Promise.resolve({ file, args });
}

const run = (file, args, options = {}) => new Promise((resolve, reject) => execFile(file, args, { timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) })));

async function latestRelease(fetchFn = fetch, platform = process.platform) {
  const asset = platform === 'darwin' ? 'Ollama-darwin.zip' : 'OllamaSetup.exe';
  try {
    const response = await fetchFn('https://api.github.com/repos/ollama/ollama/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, redirect: 'follow' });
    if (response.ok) {
      const data = await response.json();
      const found = (data.assets || []).find(a => a.name === asset);
      if (found) return { version: String(data.tag_name || ''), size: found.size, url: found.browser_download_url, source: 'GitHub release (github.com/ollama/ollama)' };
    }
  } catch {}
  return { version: '', size: null, url: `https://ollama.com/download/${asset}`, source: 'ollama.com' };
}

async function download(url, file, { onProgress = () => {}, signal, fetchFn = fetch, maxBytes = 2e9 } = {}) {
  const response = await fetchFn(url, { redirect: 'follow', signal });
  if (!response.ok) throw new Error(`The local AI runtime download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file, { mode: 0o600 });
  let done = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      done += value.length;
      if (done > maxBytes) throw new Error('The download is larger than expected and was stopped.');
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      onProgress({ done, total });
    }
  } finally { await new Promise(r => out.end(r)); }
  return done;
}

// Ollama ships as "Infra Technologies, Inc" (Apple Team ID 3MU9H2V9Y9); accept only that signer, notarized by Apple.
const OLLAMA_TEAM_ID = '3MU9H2V9Y9';
// OllamaSetup.exe carries a DigiCert EV code-signing certificate for Ollama Inc. (Ontario corporation 2713355),
// unchanged from v0.6.0 to v0.40.14. The registration number is pinned so a lookalike "Ollama" subject is refused.
const OLLAMA_WINDOWS_SIGNER = { CN: 'Ollama Inc.', O: 'Ollama Inc.', SERIALNUMBER: '2713355' };
function isOllamaWindowsSigner(subject) {
  const dn = parseDN(subject);
  return dn.CN === OLLAMA_WINDOWS_SIGNER.CN && dn.O === OLLAMA_WINDOWS_SIGNER.O && (dn.SERIALNUMBER || dn['OID.2.5.4.5']) === OLLAMA_WINDOWS_SIGNER.SERIALNUMBER;
}
async function verifyMacApp(app, runFn = run) {
  await runFn('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const info = await runFn('/usr/bin/codesign', ['-dv', '--verbose=2', app]);
  const details = `${info.stdout}\n${info.stderr}`;
  const authority = details.match(/^Authority=Developer ID Application: (.+)$/m)?.[1] || '';
  const team = details.match(/^TeamIdentifier=(\S+)$/m)?.[1] || '';
  if (team !== OLLAMA_TEAM_ID || !authority) throw new Error('The downloaded app is not signed by its expected publisher, so it was not installed.');
  await runFn('/usr/sbin/spctl', ['--assess', '--type', 'execute', app]);
  return authority;
}
// The file path travels in an environment variable, so no part of it is parsed as PowerShell.
const SIGNATURE_SCRIPT = '$s = Get-AuthenticodeSignature -LiteralPath $env:IMPROMPTU_VERIFY_FILE; [pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress';
async function readWindowsSignature(file, runFn = run, env = process.env) {
  const { stdout } = await runFn(powershell(env), ['-NoProfile', '-NonInteractive', '-Command', SIGNATURE_SCRIPT], { env: powershellEnv(env, { IMPROMPTU_VERIFY_FILE: file }) });
  try { const data = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim()); return { status: String(data.status || ''), subject: String(data.subject || '') }; }
  catch { return { status: '', subject: '' }; }
}
async function verifyWindowsInstaller(file, runFn = run, env = process.env) {
  const { status, subject } = await readWindowsSignature(file, runFn, env);
  if (status !== 'Valid' || !isOllamaWindowsSigner(subject)) throw new Error('The downloaded installer is not validly signed by its expected publisher, so it was not run.');
  return parseDN(subject).CN;
}

async function waitForServer(endpoint = DEFAULT_ENDPOINT, timeoutMs = 90000, fetchFn = fetch) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const response = await fetchFn(`${ollamaOrigin(endpoint)}/api/version`); if (response.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Local AI was installed but has not started yet. Wait a moment, then choose Check again.');
}

// OllamaSetup.exe bundles GPU runtimes: about 1.7 GB to download and several GB once installed.
const WINDOWS_INSTALL_FACTOR = 4;
async function installOllama({ onProgress = () => {}, signal, fetchFn = fetch, runFn = run, platform = process.platform, startFn = startOllama, findFn = findOllama, freeGB = () => systemSpecs().freeGB, serverTimeoutMs = 90000 } = {}) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Automatic installation is available on macOS and Windows.');
  const release = await latestRelease(fetchFn, platform);
  const free = freeGB();
  if (platform === 'win32' && release.size && free !== null && free < (release.size / 1e9) * WINDOWS_INSTALL_FACTOR + 1) throw new Error(`Not enough free disk space to install local AI (about ${Math.ceil((release.size / 1e9) * WINDOWS_INSTALL_FACTOR + 1)} GB needed, ${free} GB free).`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-ollama-'));
  try {
    const file = path.join(dir, path.basename(new URL(release.url).pathname) || 'ollama-download');
    onProgress({ stage: 'download', message: 'Downloading the local AI runtime…', done: 0, total: release.size || 0 });
    await download(release.url, file, { signal, fetchFn, maxBytes: platform === 'win32' ? 4e9 : 2e9, onProgress: p => onProgress({ stage: 'download', message: 'Downloading the local AI runtime…', ...p }) });
    onProgress({ stage: 'verify', message: 'Checking the download\'s signature…' });
    if (platform === 'darwin') {
      await runFn('/usr/bin/ditto', ['-x', '-k', file, dir]);
      const app = path.join(dir, 'Ollama.app');
      const signer = await verifyMacApp(app, runFn);
      let target = '/Applications/Ollama.app';
      try { fs.accessSync('/Applications', fs.constants.W_OK); } catch { target = path.join(os.homedir(), 'Applications/Ollama.app'); fs.mkdirSync(path.dirname(target), { recursive: true }); }
      if (fs.existsSync(target)) throw new Error(`The local AI runtime is already in ${path.dirname(target)}. Open it once, then choose Check again.`);
      onProgress({ stage: 'install', message: `Installing the local AI runtime (signature verified: ${signer}) to ${path.dirname(target)}…` });
      await runFn('/usr/bin/ditto', [app, target]);
      await runFn('/usr/bin/open', ['-g', target]);
    } else {
      const signer = await verifyWindowsInstaller(file, runFn);
      if (signal?.aborted) throw new Error('Setup was cancelled.');
      onProgress({ stage: 'install', message: 'Installing the local AI runtime (signature verified) for this Windows user…' });
      // Inno Setup: per-user install to %LOCALAPPDATA%\Programs\Ollama without UAC; its post-install step starts the tray app.
      await runFn(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], { timeout: 1200000 });
    }
    onProgress({ stage: 'start', message: 'Starting local AI…' });
    if (platform === 'win32') {
      try { await waitForServer(DEFAULT_ENDPOINT, Math.min(20000, serverTimeoutMs), fetchFn); }
      catch {
        const installed = findFn();
        if (!installed) throw new Error('Local AI setup finished, but the runtime could not be started. Restart Windows, then choose Check again.');
        await startFn(installed);
        await waitForServer(DEFAULT_ENDPOINT, serverTimeoutMs, fetchFn);
      }
    } else await waitForServer(DEFAULT_ENDPOINT, serverTimeoutMs, fetchFn);
    return { version: release.version, source: release.source };
  } finally {
    // Antivirus scanners can hold the installer open for a moment on Windows.
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
  }
}

// Streams /api/pull progress; Ollama reports per-layer totals that are summed here.
async function pullModel(name, { endpoint = DEFAULT_ENDPOINT, onProgress = () => {}, signal, fetchFn = fetch, stallMs = 120000 } = {}) {
  if (typeof name !== 'string' || !MODEL.test(name.trim())) throw new Error('Enter a model name like gemma3:4b.');
  // Ollama can stall near the end of a layer; stop after a quiet period so the user can resume.
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let lastDone = -1, quietSince = Date.now(), stalled = false;
  const watchdog = setInterval(() => { if (Date.now() - quietSince > stallMs) { stalled = true; controller.abort(); } }, Math.min(5000, stallMs));
  try {
  const response = await fetchFn(`${ollamaOrigin(endpoint)}/api/pull`, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name.trim(), stream: true }) });
  if (!response.ok) throw new Error(`The model download could not start (${response.status}).`);
  const layers = new Map(); let buffer = '', status = '';
  const decoder = new TextDecoder(); const reader = response.body.getReader();
  const handle = line => {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    if (data.error) throw new Error(/not found|file does not exist|manifest unknown/i.test(data.error) ? `The model “${name}” was not found in the model library.` : `Model download: ${String(data.error).slice(0, 200)}`);
    status = data.status || status;
    if (data.digest && data.total) layers.set(data.digest, { total: data.total, completed: data.completed || 0 });
    const total = [...layers.values()].reduce((n, l) => n + l.total, 0), done = [...layers.values()].reduce((n, l) => n + l.completed, 0);
    if (done !== lastDone || data.status !== status) { lastDone = done; quietSince = Date.now(); }
    onProgress({ stage: 'model', message: status === 'success' ? 'Model ready.' : /verifying/.test(status) ? 'Verifying the download…' : `Downloading ${name}…`, done, total });
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) { handle(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
  }
  handle(buffer);
  if (status !== 'success') throw new Error('The model download did not finish. Try again.');
  return { name: name.trim() };
  } catch (error) {
    if (stalled) throw new Error('The download stopped making progress for 2 minutes, usually a network hiccup. Choose Set up local AI again to resume; finished parts are kept.');
    throw error;
  } finally { clearInterval(watchdog); }
}

module.exports = { CATALOG, MODEL, OLLAMA_TEAM_ID, OLLAMA_WINDOWS_SIGNER, SIGNATURE_SCRIPT, systemSpecs, recommend, findOllama, startOllama, latestRelease, download, verifyMacApp, isOllamaWindowsSigner, readWindowsSignature, verifyWindowsInstaller, waitForServer, installOllama, pullModel };
