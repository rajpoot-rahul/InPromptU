'use strict';
// Local Ollama discovery. Reads only; never pulls, deletes or starts models.
const DEFAULT_ENDPOINT = 'http://localhost:11434/api/chat';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function isLocalURL(raw) {
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) && LOCAL_HOSTS.includes(url.hostname); } catch { return false; }
}
function ollamaOrigin(endpoint = DEFAULT_ENDPOINT) {
  if (!isLocalURL(endpoint)) throw new Error('Local AI detection only checks Ollama on this computer (localhost).');
  return new URL(endpoint).origin;
}
async function getJSON(url, fetchFn, timeoutMs, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { redirect: 'error', signal: controller.signal, ...init });
    if (!response.ok) throw Object.assign(new Error(`Ollama responded with ${response.status}.`), { status: response.status });
    const text = await response.text();
    if (text.length > 2000000) throw new Error('Ollama returned too much data.');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}
function describeModel(item) {
  const details = item.details || {};
  return {
    name: String(item.name || item.model || '').slice(0, 200),
    sizeBytes: Number.isSafeInteger(item.size) ? item.size : null,
    family: typeof details.family === 'string' ? details.family : '',
    parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size : '',
    quantization: typeof details.quantization_level === 'string' ? details.quantization_level : ''
  };
}
async function probe(endpoint = DEFAULT_ENDPOINT, fetchFn = fetch, timeoutMs = 3000) {
  const origin = ollamaOrigin(endpoint);
  let version;
  try { version = (await getJSON(`${origin}/api/version`, fetchFn, timeoutMs)).version; }
  catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError || error.cause) return { status: 'not-running', origin, models: [], message: `Ollama is not responding at ${new URL(origin).host}. Open the Ollama app, or run “ollama serve” in a terminal.` };
    return { status: 'error', origin, models: [], message: 'Something is answering on this port, but it does not look like Ollama.' };
  }
  try {
    const data = await getJSON(`${origin}/api/tags`, fetchFn, timeoutMs);
    const models = (Array.isArray(data.models) ? data.models : []).map(describeModel).filter(m => m.name).slice(0, 200);
    if (!models.length) return { status: 'no-models', origin, version: String(version || ''), models, message: 'Ollama is running, but no models are installed yet.' };
    return { status: 'ready', origin, version: String(version || ''), models, message: `${version ? `Ollama ${version}` : 'Ollama'} is running with ${models.length} installed ${models.length === 1 ? 'model' : 'models'}.` };
  } catch { return { status: 'error', origin, version: String(version || ''), models: [], message: 'Ollama is running, but its installed model list could not be read.' }; }
}

module.exports = { DEFAULT_ENDPOINT, isLocalURL, ollamaOrigin, probe, describeModel };
