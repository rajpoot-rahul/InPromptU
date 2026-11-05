'use strict';
// Local AI is a Phase 2 preview: the app must not surface the runtime's brand, port or connection errors.
// The one exception is the explicit install consent text (and its source line), which must name the software.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flow = require('../src/setup-flow.js');
const { probe } = require('../src/ollama.cjs');
const { requestImprovement, validateConnection, assertAllowed } = require('../src/provider.cjs');
const { streamChat } = require('../src/chat.cjs');
const { describeScreens } = require('../src/mascot.cjs');
const { download, pullModel, waitForServer } = require('../src/installer.cjs');

const FORBIDDEN = /ollama|localhost:11434|ollama serve|not responding/i;
const src = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const local = { mode: 'ollama', endpoint: 'http://localhost:11434/api/chat', model: 'gemma4:latest' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const refused = async () => { throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }); };
const neutral = (text, where) => assert.doesNotMatch(String(text), FORBIDDEN, where);
const rejectsNeutral = async (promise, where) => {
  let error;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, `${where} should fail`);
  neutral(error.message, where);
  return error.message;
};

test('local runtime status messages are calm and product-neutral', async () => {
  for (const status of ['ready', 'no-models', 'not-running', 'error', 'surprise']) neutral(flow.localMessage(status, { count: 2 }), status);
  for (const text of [flow.LOCAL_UNAVAILABLE, flow.LOCAL_PHASE2, flow.SCREEN_PHASE2]) neutral(text, text);
  const down = await probe('http://localhost:59999/api/chat', refused);
  assert.equal(down.message, flow.LOCAL_UNAVAILABLE);
  const other = await probe(undefined, async () => new Response('nope', { status: 404 }));
  assert.equal(other.message, flow.LOCAL_UNAVAILABLE);
  const unreadable = await probe(undefined, async url => url.endsWith('/api/version') ? json({ version: '1.0' }) : new Response('{', { status: 200 }));
  assert.equal(unreadable.message, flow.LOCAL_UNAVAILABLE);
  neutral((await probe(undefined, async url => url.endsWith('/api/version') ? json({ version: '1.0' }) : json({ models: [] }))).message, 'no models');
  neutral((await probe(undefined, async url => url.endsWith('/api/version') ? json({ version: '1.0' }) : json({ models: [{ name: 'm' }] }))).message, 'ready');
  await rejectsNeutral(probe('https://remote.example/api/chat', refused), 'remote endpoint');
});

test('errors from Improve, Local chat and the mascot never name the runtime or its port', async () => {
  const unreachable = await rejectsNeutral(requestImprovement({ prompt: 'Hello there' }, local, '', refused), 'improve unreachable');
  assert.match(unreachable, /Phase 2 preview/);
  await rejectsNeutral(requestImprovement({ prompt: 'Hello there' }, local, '', async () => json({ error: 'model not found' }, 404)), 'improve missing model');
  await rejectsNeutral(requestImprovement({ prompt: 'Hello there' }, local, '', async () => json({ error: 'boom' }, 500)), 'improve failure');
  await rejectsNeutral(requestImprovement({ prompt: 'Hello there', action: 'compress' }, { mode: 'offline' }), 'offline compress');
  assert.throws(() => validateConnection({ ...local, endpoint: 'https://remote.example/api/chat' }), error => !FORBIDDEN.test(error.message));
  assert.throws(() => assertAllowed({ mode: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'm' }, true), error => !FORBIDDEN.test(error.message));

  const chat = { endpoint: local.endpoint, model: local.model, messages: [] };
  await rejectsNeutral(streamChat({ ...chat, fetchFn: refused }), 'chat unreachable');
  await rejectsNeutral(streamChat({ ...chat, fetchFn: async () => json({ error: 'model not found' }, 404) }), 'chat missing model');
  await rejectsNeutral(streamChat({ ...chat, fetchFn: async () => json({ error: 'boom' }, 500) }), 'chat failure');
  await rejectsNeutral(streamChat({ ...chat, fetchFn: async () => new Response('{"error":"runner crashed"}\n') }), 'chat stream error');
  await rejectsNeutral(streamChat({ ...chat, fetchFn: async () => new Response('not json\n') }), 'chat unreadable');

  const screen = { images: ['a'], endpoint: local.endpoint, model: 'm' };
  assert.equal(await rejectsNeutral(describeScreens({ ...screen, fetchFn: refused }), 'screen unreachable'), flow.SCREEN_PHASE2);
  await rejectsNeutral(describeScreens({ ...screen, fetchFn: async () => json({}, 500) }), 'screen failure');
  await rejectsNeutral(describeScreens({ ...screen, fetchFn: async () => json({ message: { content: '' } }) }), 'screen empty');
});

test('install progress and failures after consent stay neutral', async () => {
  await rejectsNeutral(download('https://example.invalid/file', '/dev/null', { fetchFn: async () => new Response('', { status: 404 }) }), 'download');
  await rejectsNeutral(pullModel('gemma3:4b', { fetchFn: async () => new Response('', { status: 500 }) }), 'pull start');
  await rejectsNeutral(pullModel('gemma3:4b', { fetchFn: async () => new Response('{"error":"pull model manifest: file does not exist"}\n') }), 'pull missing');
  await rejectsNeutral(waitForServer(local.endpoint, 1, refused), 'server start');
});

// Collects every string literal (template literals as their static text) from a JS source, skipping comments and regexes.
function literals(source) {
  const found = []; let i = 0, last = '';
  const regexAllowed = () => !last || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /^(return|typeof|case|in|of|void|delete|throw|new)$/.test(last);
  const readString = quote => { let text = ''; i++; while (i < source.length && source[i] !== quote) { if (source[i] === '\\') { text += source[i + 1]; i += 2; } else text += source[i++]; } i++; return text; };
  const readRegex = () => { let inClass = false; i++; while (i < source.length) { const c = source[i]; if (c === '\\') { i += 2; continue; } if (c === '[') inClass = true; else if (c === ']') inClass = false; else if (c === '/' && !inClass) { i++; break; } i++; } while (/\w/.test(source[i] || '')) i++; };
  const readTemplate = () => {
    const parts = []; let text = ''; i++;
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') { text += source[i + 1]; i += 2; }
      else if (source[i] === '$' && source[i + 1] === '{') { parts.push(text); text = ''; i += 2; readCode('}'); }
      else text += source[i++];
    }
    i++; parts.push(text); return parts.join('…');
  };
  function readCode(until) {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (until && c === until && depth === 0) { i++; last = c; return; }
      if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
      if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 2; continue; }
      if (c === "'" || c === '"') { found.push(readString(c)); last = 'x'; continue; }
      if (c === '`') { found.push(readTemplate()); last = 'x'; continue; }
      if (c === '/' && regexAllowed()) { readRegex(); last = 'x'; continue; }
      if ('{(['.includes(c)) depth++;
      if ('})]'.includes(c)) depth--;
      if (!/\s/.test(c)) last = /\w/.test(c) && /\w/.test(source[i - 1] || '') && /^\w+$/.test(last) ? last + c : c;
      i++;
    }
  }
  readCode('');
  return found;
}

// The install consent dialog names the software it installs and where it comes from; nothing else may.
const CONSENT = [/^Ollama is already running on this computer\. Nothing to install\.$/, /^Ollama is installed \(…\) but not running\. Impromptu will start it\.$/, /^Not installed\. Impromptu will download the official Ollama app, check it is signed by Ollama/, /^Not installed\. Impromptu will download Ollama …/, /^download and install Ollama$/];
const CODE_CONSTANT_FILES = ['setup-flow.js', 'ollama.cjs'];
function visibleLiteralProblems(file) {
  return literals(src(file)).filter(text => FORBIDDEN.test(text)).filter(text => {
    if (/11434/.test(text)) return !CODE_CONSTANT_FILES.includes(file);
    if (/^[a-z0-9_.:/-]+$/.test(text) || /^https:\/\/\S+$/.test(text)) return false;
    return !(file === 'renderer.js' && CONSENT.some(pattern => pattern.test(text)));
  });
}

test('the literal scanner sees strings and ignores regexes and comments', () => {
  assert.deepEqual(literals("if (/isn't|x/.test(a)) b('one'); // 'no'\nconst c = `a ${d ? 'two' : `in ${e}`} z`;"), ['one', 'two', 'in …', 'a … z']);
});

test('renderer-visible strings in scripts never mention the runtime outside the install consent', () => {
  for (const file of ['renderer.js', 'mascot.js', 'setup-flow.js', 'insights-view.js', 'agent-context-ui.js', 'agent-context.cjs', 'main.cjs', 'ollama.cjs', 'chat.cjs', 'provider.cjs', 'mascot.cjs']) {
    assert.deepEqual(visibleLiteralProblems(file), [], `${file} has user-visible runtime wording`);
  }
  const consent = literals(src('renderer.js')).filter(text => CONSENT.some(pattern => pattern.test(text)));
  assert.ok(consent.length >= 4, 'the install consent still names the software it installs');
});

function visibleHtml(html) {
  const withoutConsent = html.replace(/<dialog id="local-ai-dialog"[\s\S]*?<\/dialog>/, '');
  const attributes = [...withoutConsent.matchAll(/\s(?:placeholder|aria-label|title|alt)="([^"]*)"/g)].map(m => m[1]);
  const text = withoutConsent.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
  return [text, ...attributes].join('\n');
}

test('index.html and mascot.html show no runtime brand, port or connection error outside the install consent', () => {
  for (const file of ['index.html', 'mascot.html']) {
    const problems = visibleHtml(src(file)).split('\n').filter(line => FORBIDDEN.test(line)).map(line => line.trim());
    assert.deepEqual(problems, [], `${file} shows runtime wording`);
  }
  const consent = src('index.html').match(/<dialog id="local-ai-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(consent, /Ollama/, 'the install consent dialog still names the software');
});
