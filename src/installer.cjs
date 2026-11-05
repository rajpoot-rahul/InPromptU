'use strict';
// Consent-based local AI setup: installs the official Ollama app and downloads one chosen open model.
// Nothing here runs unless the user explicitly agrees in the setup dialog.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { ollamaOrigin, DEFAULT_ENDPOINT } = require('./ollama.cjs');

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

function findOllama(platform = process.platform, env = process.env, exists = file => { try { return fs.statSync(file).isFile() || fs.statSync(file).isDirectory(); } catch { return false; } }) {
  const candidates = platform === 'darwin'
    ? ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications/Ollama.app'), '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']
    : platform === 'win32' ? [path.join(env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), ...String(env.PATH || '').split(';').filter(Boolean).map(dir => path.join(dir, 'ollama.exe'))]
      : String(env.PATH || '').split(':').filter(Boolean).map(dir => path.join(dir, 'ollama'));
  return candidates.find(exists) || '';
}

const run = (file, args, options = {}) => new Promise((resolve, reject) => execFile(file, args, { timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) })));

async function latestRelease(fetchFn = fetch) {
  const asset = process.platform === 'darwin' ? 'Ollama-darwin.zip' : 'OllamaSetup.exe';
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
  if (!response.ok) throw new Error(`The Ollama download failed (${response.status}).`);
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
const OLLAMA_SIGNER = /\b(Infra Technologies, Inc|Ollama)\b/i;
async function verifyMacApp(app, runFn = run) {
  await runFn('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const info = await runFn('/usr/bin/codesign', ['-dv', '--verbose=2', app]);
  const details = `${info.stdout}\n${info.stderr}`;
  const authority = details.match(/^Authority=Developer ID Application: (.+)$/m)?.[1] || '';
  const team = details.match(/^TeamIdentifier=(\S+)$/m)?.[1] || '';
  if (team !== OLLAMA_TEAM_ID || !authority) throw new Error('The downloaded app is not signed by Ollama (Infra Technologies, Inc), so it was not installed.');
  await runFn('/usr/sbin/spctl', ['--assess', '--type', 'execute', app]);
  return authority;
}
async function verifyWindowsInstaller(file, runFn = run) {
  const { stdout } = await runFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`]);
  const [status, subject] = stdout.trim().split('|');
  if (status !== 'Valid' || !OLLAMA_SIGNER.test(subject || '')) throw new Error('The downloaded installer is not validly signed by Ollama (Infra Technologies, Inc), so it was not run.');
  return subject;
}

async function waitForServer(endpoint = DEFAULT_ENDPOINT, timeoutMs = 90000, fetchFn = fetch) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const response = await fetchFn(`${ollamaOrigin(endpoint)}/api/version`); if (response.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Ollama was installed but did not start. Open the Ollama app once, then choose Check again.');
}

async function installOllama({ onProgress = () => {}, signal, fetchFn = fetch, runFn = run } = {}) {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Automatic installation is available on macOS and Windows. Install Ollama from ollama.com, then choose Check again.');
  const release = await latestRelease(fetchFn);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-ollama-'));
  try {
    const file = path.join(dir, path.basename(new URL(release.url).pathname) || 'ollama-download');
    onProgress({ stage: 'download', message: `Downloading Ollama ${release.version} from ${release.source}…`, done: 0, total: release.size || 0 });
    await download(release.url, file, { signal, fetchFn, onProgress: p => onProgress({ stage: 'download', message: `Downloading Ollama ${release.version}…`, ...p }) });
    onProgress({ stage: 'verify', message: 'Checking that the download is genuinely signed by Ollama…' });
    if (process.platform === 'darwin') {
      await runFn('/usr/bin/ditto', ['-x', '-k', file, dir]);
      const app = path.join(dir, 'Ollama.app');
      const signer = await verifyMacApp(app, runFn);
      let target = '/Applications/Ollama.app';
      try { fs.accessSync('/Applications', fs.constants.W_OK); } catch { target = path.join(os.homedir(), 'Applications/Ollama.app'); fs.mkdirSync(path.dirname(target), { recursive: true }); }
      if (fs.existsSync(target)) throw new Error(`An Ollama app already exists at ${target}. Open it, then choose Check again.`);
      onProgress({ stage: 'install', message: `Installing Ollama (signed by ${signer}) to ${path.dirname(target)}…` });
      await runFn('/usr/bin/ditto', [app, target]);
      await runFn('/usr/bin/open', ['-g', target]);
    } else {
      const signer = await verifyWindowsInstaller(file, runFn);
      onProgress({ stage: 'install', message: `Installing Ollama (signed by ${signer})…` });
      await runFn(file, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { timeout: 600000 });
    }
    onProgress({ stage: 'start', message: 'Starting Ollama…' });
    await waitForServer(DEFAULT_ENDPOINT, 90000, fetchFn);
    return { version: release.version, source: release.source };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
  if (!response.ok) throw new Error(`Ollama could not start the download (${response.status}).`);
  const layers = new Map(); let buffer = '', status = '';
  const decoder = new TextDecoder(); const reader = response.body.getReader();
  const handle = line => {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    if (data.error) throw new Error(/not found|file does not exist|manifest unknown/i.test(data.error) ? `The model “${name}” was not found in the Ollama library.` : `Ollama: ${String(data.error).slice(0, 200)}`);
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

module.exports = { CATALOG, MODEL, OLLAMA_TEAM_ID, systemSpecs, recommend, findOllama, latestRelease, download, verifyMacApp, verifyWindowsInstaller, waitForServer, installOllama, pullModel };
