const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const insights = require('../src/insights.cjs');

function desktop(t, { platform = 'darwin', theme = 'system', dialog = {} } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-test-'));
  fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify({ connection: { mode: 'offline', endpoint: '', model: '' }, theme, history: [] }));
  const handlers = new Map(), shortcuts = new Map(), events = [], windows = [], appCalls = [], trays = [], opened = [], appEvents = new Map();
  // Runs the app's own quit cleanup so fs.watch handles close; unref'd watchers still kept the Windows test process alive.
  t.after(() => { for (const name of ['before-quit', 'will-quit']) for (const listener of appEvents.get(name) || []) listener(); });
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  let ready, window, copied = 'Synthetic test prompt';
  class BrowserWindow {
    constructor(options) { windows.push(this); if (!window) window = this; this.options = options; this.alwaysOnTop = []; this.vibrancy = options.vibrancy || null; this.background = options.backgroundColor; this.vibrancyCalls = 0; this.webContents = { send: (...args) => events.push(args), isLoading: () => false, setWindowOpenHandler() {}, on() {} }; }
    loadFile() {} on() {} once() {} isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {} hide() {}
    setVibrancy(value) { this.vibrancy = value; this.vibrancyCalls++; }
    setAlwaysOnTop(...args) { this.alwaysOnTop.push(args); } setVisibleOnAllWorkspaces() {} showInactive() {} setBounds() {} setFocusable() {} destroy() { this.destroyed = true; }
    setBackgroundColor(value) { this.background = value; }
  }
  class Tray { constructor(image) { this.image = image; trays.push(this); } setToolTip() {} on() {} setContextMenu() {} }
  const image = file => ({ file, template: false, representations: [], resize(size) { return { ...this, size, toPNG: () => Buffer.from(`${path.basename(file)}@${size.width}`) }; }, setTemplateImage(value) { this.template = value; }, addRepresentation(rep) { this.representations.push(rep); } });
  const menus = [];
  const fake = {
    app: { setName() {}, setAppUserModelId: id => appCalls.push(['setAppUserModelId', id]), requestSingleInstanceLock: () => true, getPath: () => data, getVersion: () => 'test', on: (name, listener) => appEvents.set(name, [...(appEvents.get(name) || []), listener]), whenReady: () => ({ then: callback => ready = callback }) },
    BrowserWindow, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    clipboard: { readText: async () => copied, writeText: async value => { await Promise.resolve(); copied = value; } },
    globalShortcut: { register: (name, fn) => { shortcuts.set(name, fn); return true; }, unregisterAll() {} },
    Tray, Menu: { buildFromTemplate: value => value, setApplicationMenu: value => menus.push(value) }, nativeImage: { createFromPath: file => image(file), createEmpty: () => image('') },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, prefersReducedTransparency: false, shouldUseHighContrastColors: false, on(_event, callback) { this.updated = callback; } },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }, dialog, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) }, systemPreferences: { getMediaAccessStatus: () => 'denied', isTrustedAccessibilityClient: () => false }, desktopCapturer: { getSources: async () => [] },
    shell: { openExternal: async url => { opened.push(url); }, openPath: async file => { opened.push(file); return ''; } }
  };
  const dir = path.resolve(__dirname, '../src');
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'main.cjs'), 'utf8'), { require: name => name === 'electron' ? fake : name.startsWith('./') ? require(path.join(dir, name)) : require(name), __dirname: dir, process: { platform, env: {} }, console, AbortController, URL, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} });
  ready();
  const sender = { sender: window.webContents, senderFrame: { url: pathToFileURL(path.join(dir, 'index.html')).href } };
  return { handlers, shortcuts, events, sender, window, windows, appCalls, trays, menus, data, opened, nativeTheme: fake.nativeTheme, copied: () => copied };
}

test('Windows sets the installer app ID, shows a full-colour tray icon and uses Ctrl+Shift+I; the Mac keeps its template icon', async t => {
  const win = desktop(t, { platform: 'win32' });
  assert.deepEqual(win.appCalls, [['setAppUserModelId', 'com.impromptu.companion']]);
  assert.ok(win.shortcuts.has('CommandOrControl+Shift+I'));
  const icon = win.trays[0].image;
  assert.deepEqual(icon.representations.map(r => [r.scaleFactor, r.width]), [[1, 16], [1.25, 20], [1.5, 24], [2, 32]]);
  assert.ok(icon.representations.every(r => String(r.buffer).startsWith('icon.png@')));
  const winMenu = win.menus[0];
  assert.deepEqual([...winMenu.map(m => m.label)], ['Edit', 'Window']);
  assert.ok(winMenu[1].submenu.some(item => item.role === 'quit'));
  assert.equal(win.window.options.titleBarStyle, 'default');
  assert.equal(win.window.options.vibrancy, undefined);
  const mac = desktop(t);
  assert.deepEqual(mac.appCalls, []);
  assert.equal(path.basename(mac.trays[0].image.file), 'tray.png');
  assert.equal(mac.trays[0].image.template, true);
  assert.equal(mac.menus[0][0].label, 'Impromptu');
});

test('the Windows mascot is a non-activating, always-on-top tool window that needs no permission prompts', async t => {
  const { handlers, sender, windows } = desktop(t, { platform: 'win32' });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const on = await handlers.get('mascot-enable')(sender, { consent: true });
  assert.equal(on.platform, 'win32');
  assert.deepEqual([on.permissions.screen, on.permissions.accessibility], [true, true]);
  const mascot = windows.at(-1);
  assert.equal(mascot.options.title, 'Impromptu mascot');
  assert.deepEqual([mascot.options.type, mascot.options.focusable, mascot.options.transparent, mascot.options.alwaysOnTop, mascot.options.skipTaskbar, mascot.options.acceptFirstMouse], ['toolbar', false, true, true, true, undefined]);
  assert.deepEqual(mascot.alwaysOnTop[0], [true, 'floating']);
  assert.equal(mascot.options.webPreferences.sandbox, true);
  assert.equal((await handlers.get('mascot-permission')(sender, 'accessibility')).permissions.accessibility, true);
  const mac = desktop(t);
  await mac.handlers.get('mascot-enable')(mac.sender, { consent: true });
  assert.equal(mac.windows.at(-1).options.type, 'panel');
});

test('Windows context hand-off uses the home folder for the inbox and each tool skill', async t => {
  const { handlers, sender, data } = desktop(t, { platform: 'win32' });
  const state = await handlers.get('context-state')(sender);
  assert.equal(state.inbox.path, path.join(data, 'Impromptu', 'Inbox'));
  assert.deepEqual([...state.skills.map(s => path.relative(data, s.path))], [path.join('.cursor', 'skills', 'impromptu-handoff', 'SKILL.md'), path.join('.claude', 'skills', 'impromptu-handoff', 'SKILL.md'), path.join('.codex', 'skills', 'impromptu-handoff', 'SKILL.md')]);
  assert.ok(state.prompt.includes(path.join(data, 'Impromptu', 'Inbox')));
});

test('Windows Hyland latest learning uses the home folder, imports CRLF sessions and opens attachments by stored index only', async t => {
  const { handlers, sender, data, opened } = desktop(t, { platform: 'win32' });
  const folder = path.join(data, 'Impromptu', 'Learning', '2026-10-29-fictional-windows');
  assert.equal((await handlers.get('hyland-state')(sender)).folder.path, path.join(data, 'Impromptu', 'Learning'));
  fs.mkdirSync(path.join(folder, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'attachments', 'notes.txt'), 'fictional');
  fs.writeFileSync(path.join(folder, 'session.md'), '---\r\nformat: impromptu-learning-session/1\r\nseries: Fictional Series\r\ntitle: Windows session\r\ndate: 2026-10-29\r\n---\r\n## Summary\r\nA fictional summary.\r\n## Action items\r\n- Try it\r\n## Attachments\r\n- [Notes](attachments\\notes.txt)\r\n- [Drive](C:\\Windows\\notepad.exe)\r\n');
  const scan = await handlers.get('hyland-scan')(sender);
  const s = scan.state.series[0].sessions[0];
  assert.deepEqual([scan.added, s.title, s.summary, s.actionItems, s.attachments.map(a => a.kind)], [1, 'Windows session', 'A fictional summary.', ['Try it'], ['file', 'blocked']]);
  await handlers.get('hyland-open')(sender, { id: s.id, target: 0 });
  await assert.rejects(handlers.get('hyland-open')(sender, { id: s.id, target: 1 }), /blocked/);
  assert.deepEqual(opened, [fs.realpathSync(path.join(folder, 'attachments', 'notes.txt'))]);
});

test('Hyland latest learning imports the folder, persists status, and opens only safe attachments', async t => {
  const { handlers, sender, data, opened } = desktop(t);
  const folder = path.join(data, 'Impromptu', 'Learning', '2026-10-29-fictional-office-hours');
  fs.mkdirSync(path.join(folder, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'attachments', 'slides.pdf'), 'pdf');
  fs.writeFileSync(path.join(folder, 'session.md'), '---\nformat: impromptu-learning-session/1\nseries: Fictional Office Hours\ntitle: Agents 101\ndate: 2026-10-29\nsource: teams-recap\nurl: https://example.org/rec\n---\n## Summary\nA fictional intro.\n## Attachments\n- [Slides](attachments/slides.pdf)\n- [Bad](http://example.org/x)\n');
  assert.equal((await handlers.get('hyland-state')(sender)).folder.pending, 1);
  const scan = await handlers.get('hyland-scan')(sender);
  assert.deepEqual([scan.added, scan.state.progress.total, scan.state.folder.pending], [1, 1, 0]);
  const id = scan.state.series[0].sessions[0].id;
  const after = await handlers.get('hyland-status')(sender, { id, reviewed: true, attended: true });
  assert.deepEqual([after.progress.reviewed, after.progress.attended], [1, 1]);
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'learning-sessions.json'), 'utf8')).sessions[0];
  assert.ok(saved.reviewed && saved.attended);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(data, 'learning-sessions.json')).mode & 0o777, 0o600);
  await handlers.get('hyland-open')(sender, { id, target: 'source' });
  await handlers.get('hyland-open')(sender, { id, target: 0 });
  await assert.rejects(handlers.get('hyland-open')(sender, { id, target: 1 }), /blocked/);
  await assert.rejects(handlers.get('hyland-open')(sender, { id, target: 'https://evil.example' }), /no longer exists/);
  assert.deepEqual(opened, ['https://example.org/rec', fs.realpathSync(path.join(folder, 'attachments', 'slides.pdf'))]);
  const pasted = await handlers.get('hyland-paste')(sender, { text: 'Meeting notes\nFictional recap.\nFollow-up tasks\n- Try it', title: 'Recap', series: 'Fictional Office Hours', date: '2026-11-01' });
  assert.deepEqual([pasted.status, pasted.session.actionItems[0], pasted.state.progress.total], ['added', 'Try it', 2]);
  await assert.rejects(handlers.get('hyland-paste')(sender, { text: 'x', url: 'javascript:alert(1)' }), /https/);
  await assert.rejects(handlers.get('hyland-summarize')(sender, { id, provider: 'cloud' }), /cloud provider in Settings/);
  await assert.rejects(handlers.get('hyland-summarize')(sender, { id, provider: 'https://evil.example' }), /Choose a local model/);
  await assert.rejects(handlers.get('hyland-summarize')(sender, { id, provider: 'local:' }), /Choose a local model/);
  await assert.rejects(handlers.get('hyland-status')({ sender: {}, senderFrame: { url: 'https://untrusted.example' } }, { id, reviewed: false }), /Untrusted/);
});

test('desktop IPC awaits clipboard operations, and the shortcut imports copied text', async t => {
  const { handlers, shortcuts, events, sender, copied } = desktop(t);
  assert.equal(await handlers.get('clipboard-read')(sender), 'Synthetic test prompt');
  await handlers.get('clipboard-write')(sender, 'Improved test prompt');
  assert.equal(copied(), 'Improved test prompt');
  await shortcuts.get('CommandOrControl+Shift+I')();
  assert.equal(events.at(-1)[0], 'clipboard-invoked');
  assert.equal(events.at(-1)[1], 'Improved test prompt');
  await assert.rejects(handlers.get('clipboard-read')({ sender: {}, senderFrame: { url: 'https://untrusted.example' } }), /Untrusted/);
});

test('Mac Glass persists, follows system appearance, and respects accessibility changes', async t => {
  const { handlers, sender, window, data, nativeTheme, events } = desktop(t);
  const result = await handlers.get('set-theme')(sender, 'glass');
  assert.equal(result.theme, 'glass');
  assert.equal(nativeTheme.themeSource, 'system');
  assert.equal(window.vibrancy, 'under-window');
  assert.equal(window.background, '#00000000');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'workspace.json'))).theme, 'glass');
  nativeTheme.shouldUseDarkColors = true;
  nativeTheme.prefersReducedTransparency = true;
  nativeTheme.updated();
  assert.equal(window.vibrancy, null);
  assert.equal(window.background, '#121715');
  assert.equal(events.at(-1)[1].reducedTransparency, true);
  assert.equal(events.at(-1)[1].theme, 'glass');
  nativeTheme.prefersReducedTransparency = false;
  nativeTheme.shouldUseHighContrastColors = true;
  nativeTheme.updated();
  assert.equal(window.vibrancy, null);
  nativeTheme.shouldUseHighContrastColors = false;
  nativeTheme.updated();
  assert.equal(window.vibrancy, 'under-window');
  await handlers.get('set-theme')(sender, 'dark');
  assert.equal(nativeTheme.themeSource, 'dark');
  assert.equal(window.vibrancy, null);
  assert.equal(window.background, '#121715');
  const restored = desktop(t, { theme: 'glass' });
  assert.equal(restored.window.options.vibrancy, 'under-window');
  assert.equal(restored.window.options.backgroundColor, '#00000000');
  assert.ok(restored.window.options.webPreferences.additionalArguments.includes('--impromptu-theme=glass'));
});

test('Windows Glass follows system appearance without macOS vibrancy', async t => {
  const { handlers, sender, window, nativeTheme } = desktop(t, { platform: 'win32', theme: 'glass' });
  assert.equal((await handlers.get('bootstrap')(sender)).theme, 'glass');
  await handlers.get('set-theme')(sender, 'glass');
  assert.equal(nativeTheme.themeSource, 'system');
  assert.equal(window.options.titleBarStyle, 'default');
  await handlers.get('set-theme')(sender, 'dark');
  assert.equal(nativeTheme.themeSource, 'dark');
  assert.equal(window.vibrancyCalls, 0);
  assert.equal(window.options.vibrancy, undefined);
});

test('Max-ind persists and follows system appearance on Mac and Windows', async t => {
  const { handlers, sender, nativeTheme, window, data } = desktop(t);
  await handlers.get('set-theme')(sender, 'max-ind');
  assert.equal(nativeTheme.themeSource, 'system');
  assert.equal(window.vibrancy, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'workspace.json'))).theme, 'max-ind');
  const restored = desktop(t, { theme: 'max-ind' });
  assert.equal((await restored.handlers.get('bootstrap')(restored.sender)).theme, 'max-ind');
  const windows = desktop(t, { platform: 'win32', theme: 'max-ind' });
  assert.equal((await windows.handlers.get('bootstrap')(windows.sender)).theme, 'max-ind');
  await windows.handlers.get('set-theme')(windows.sender, 'max-ind');
  assert.equal(windows.nativeTheme.themeSource, 'system');
  assert.equal(windows.window.vibrancyCalls, 0);
});

test('guided local setup tests the chosen installed model, then saves it with local-only mode', async t => {
  const { handlers, sender, data } = desktop(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const chats = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/version')) return new Response(JSON.stringify({ version: '0.40.4' }));
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'gemma4:latest' }] }));
    chats.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ improved: 'Invite readers to a fictional book club.', changes: [], questions: [] }) } }));
  };
  assert.equal((await handlers.get('local-ai-detect')(sender)).status, 'ready');
  await assert.rejects(handlers.get('local-ai-use')(sender, { model: 'missing:latest' }), /not installed/);
  assert.equal(chats.length, 0);
  const result = await handlers.get('local-ai-use')(sender, { model: 'gemma4:latest', localOnly: true });
  assert.equal(chats.length, 1);
  assert.equal(chats[0].messages[1].content.includes('fictional book club'), true);
  assert.equal(result.state.connection.mode, 'ollama');
  assert.equal(result.state.localOnly, true);
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'workspace.json')));
  assert.deepEqual([saved.connection.model, saved.localOnly, Boolean(saved.setup.completedAt)], ['gemma4:latest', true, true]);
  await assert.rejects(handlers.get('local-ai-use')(sender, { model: 'gemma4:latest', endpoint: 'https://remote.example/api/chat' }), /localhost/);
});

test('local-only mode is enforced in the main process for cloud providers and knowledge', async t => {
  const { handlers, sender, data, opened } = desktop(t);
  const base = { endpoint: '', model: 'openrouter/free', apiKey: '', importClipboard: true };
  await assert.rejects(handlers.get('save-settings')(sender, { ...base, mode: 'openrouter', localOnly: true }), /Local-only mode is on/);
  await assert.rejects(handlers.get('test-connection')(sender, { ...base, mode: 'openrouter', localOnly: true }), /Local-only mode is on/);
  const saved = await handlers.get('save-settings')(sender, { ...base, mode: 'offline', localOnly: true });
  assert.equal(saved.localOnly, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'workspace.json'))).localOnly, true);
  await assert.rejects(handlers.get('knowledge-connect')(sender), /Knowledge lookups contact Atlassian/);
  await assert.rejects(handlers.get('knowledge-lookup')(sender, { message: 'What is ABC-1?' }), /Local-only mode is on/);
  await assert.rejects(handlers.get('aws-sso-login')(sender, 'hyland'), /Local-only mode is on/);
  await assert.rejects(handlers.get('open-help')(sender, 'https://evil.example'), /Unknown help link/);
  assert.equal(await handlers.get('open-help')(sender, 'openrouter-keys'), true);
  assert.equal(opened.at(-1), 'https://openrouter.ai/settings/keys');
  assert.equal((await handlers.get('setup-dismiss')(sender)).setup.dismissed, true);
  const restored = desktop(t);
  assert.equal((await restored.handlers.get('bootstrap')(restored.sender)).setup.dismissed, false);
});

test('local chat streams replies, rolls back failures, keeps stopped partials and honours temporary mode', async t => {
  const { handlers, sender, events, data } = desktop(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const line = value => new TextEncoder().encode(JSON.stringify(value) + '\n');
  let mode = 'ok', urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(url);
    if (mode === 'down') throw new TypeError('fetch failed');
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(line({ message: { content: 'Local ' } }));
      if (mode === 'hang') { options.signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))); return; }
      controller.enqueue(line({ message: { content: 'answer' } })); controller.enqueue(line({ done: true, prompt_eval_count: 9, eval_count: 2 })); controller.close();
    } }));
  };
  const chat = await handlers.get('chat-new')(sender, { model: 'gemma4:latest' });
  const result = await handlers.get('chat-send')(sender, { chatId: chat.id, text: 'What is tokenmining?', model: 'gemma4:latest' });
  assert.equal(result.message.content, 'Local answer');
  assert.deepEqual(result.message.usage, { input: 9, output: 2 });
  assert.deepEqual(events.filter(e => e[0] === 'chat-delta').map(e => e[1].delta), ['Local ', 'answer']);
  assert.ok(urls.every(url => url.startsWith('http://localhost:11434/')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'chats.json'))).conversations[0].messages.length, 2);

  mode = 'down';
  await assert.rejects(handlers.get('chat-send')(sender, { chatId: chat.id, text: 'Second question', model: 'gemma4:latest' }), /not responding/);
  assert.equal((await handlers.get('chat-get')(sender, chat.id)).messages.length, 2);

  mode = 'hang';
  const pending = handlers.get('chat-send')(sender, { chatId: chat.id, text: 'Long answer please', model: 'gemma4:latest' });
  await new Promise(resolve => setTimeout(resolve, 20));
  await assert.rejects(handlers.get('chat-delete')(sender, chat.id), /Stop the reply/);
  await handlers.get('chat-stop')(sender, chat.id);
  const stopped = await pending;
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.chat.messages.at(-1).content, 'Local ');
  assert.equal(stopped.chat.messages.at(-1).stopped, true);

  mode = 'ok';
  assert.equal((await handlers.get('chat-settings')(sender, { saveNewChats: false })).chat.saveNewChats, false);
  const temporary = await handlers.get('chat-new')(sender, { model: 'gemma4:latest' });
  assert.equal(temporary.temporary, true);
  await handlers.get('chat-send')(sender, { chatId: temporary.id, text: 'Do not keep this', model: 'gemma4:latest' });
  assert.ok(!fs.readFileSync(path.join(data, 'chats.json'), 'utf8').includes('Do not keep this'));
  assert.deepEqual(await handlers.get('chat-clear')(sender), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'chats.json'))).conversations, []);
  await assert.rejects(handlers.get('chat-send')(sender, { chatId: chat.id, text: 'gone', model: 'gemma4:latest' }), /no longer exists/);
});

test('skills IPC saves custom skills into the app catalog and generation honours local-only mode', async t => {
  const { handlers, sender, data } = desktop(t);
  const saved = await handlers.get('skill-save')(sender, { name: 'Release note', category: 'Engineering', instructions: 'List user-facing changes first.' });
  assert.ok(saved.skills.some(s => s.id === saved.skill.id && s.custom));
  assert.ok((await handlers.get('bootstrap')(sender)).skills.some(s => s.name === 'Release note'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'skills.json'))).skills.length, 1);
  await handlers.get('save-settings')(sender, { mode: 'openrouter', endpoint: '', model: 'openrouter/free', apiKey: 'test-key', importClipboard: true, localOnly: false });
  await handlers.get('save-settings')(sender, { mode: 'offline', endpoint: '', model: '', apiKey: '', importClipboard: true, localOnly: true });
  await assert.rejects(handlers.get('skill-generate')(sender, 'A workflow'), /needs an AI model/);
  const result = await handlers.get('improve')(sender, { prompt: 'Write release notes.', skillId: saved.skill.id });
  assert.match(result.improved, /List user-facing changes first/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'skills.json'))).skills[0].uses, 1);
  assert.equal((await handlers.get('skill-delete')(sender, saved.skill.id)).some(s => s.custom), false);
});

test('learning IPC counts activity, scores benchmarks, guards links and erases on request', async t => {
  const { handlers, sender, data } = desktop(t);
  const initial = await handlers.get('learning-state')(sender);
  assert.equal(initial.progress.completed, 0);
  assert.equal(initial.tasks.length, 6);
  assert.ok(initial.tasks.every(task => task.referenceScore >= 80));
  await handlers.get('improve')(sender, { prompt: 'Summarise the notes below for my team as 5 bullets. Do not add facts.' });
  assert.equal((await handlers.get('learning-state')(sender)).events.improve, 1);
  await assert.rejects(handlers.get('learning-mark')(sender, { id: 'basics', done: true }), /automatically/);
  assert.equal((await handlers.get('learning-mark')(sender, { id: 'agents', done: true })).progress.milestones.find(m => m.id === 'agents').done, true);
  const { run } = await handlers.get('benchmark-submit')(sender, { 'meeting-summary': 'Summarise the transcript below for my manager in 5 bullets: decisions, owners, next steps.' });
  assert.ok(run.total > 50);
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'workspace.json')));
  assert.equal(saved.learning.runs.length, 1);
  assert.ok(saved.learning.manual.agents);
  await assert.rejects(handlers.get('open-reading')(sender, 'https://evil.example/'), /Only links/);
  const erased = await handlers.get('learning-erase')(sender);
  assert.deepEqual([erased.runs.length, erased.progress.completed, Object.keys(erased.events).length], [0, 0, 0]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'workspace.json'))).learning, { events: {}, manual: {}, runs: [] });
});

test('Improve records into the local prompt log, which can be turned off, erased and exported; coaching respects local-only', async t => {
  for (const platform of ['darwin', 'win32']) {
    const exportPath = path.join(os.tmpdir(), `impromptu-log-export-${platform}-${process.pid}.json`);
    t.after(() => fs.rmSync(exportPath, { force: true }));
    const { handlers, sender, data, opened } = desktop(t, { platform, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: exportPath }) } });
    const file = path.join(data, 'prompt-log.json');
    assert.deepEqual([(await handlers.get('insights-state')(sender)).summary.total, fs.existsSync(file)], [0, false]);
    await handlers.get('improve')(sender, { prompt: 'Summarise the Q3 notes below for my manager as 5 bullets.', context: 'Private context text', skillId: 'summary' });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.entries.length, 1);
    assert.deepEqual([saved.entries[0].action, saved.entries[0].mode, saved.entries[0].skillId], ['improve', 'offline', 'summary']);
    assert.ok(saved.entries[0].signals.includes('format'));
    assert.ok(!JSON.stringify(saved).includes('Private context text'));
    if (platform === 'darwin' && process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const state = await handlers.get('insights-state')(sender);
    assert.deepEqual([state.enabled, state.count, state.summary.total, state.canCoach], [true, 1, 1, false]);
    assert.equal((await handlers.get('insights-settings')(sender, { enabled: false })).enabled, false);
    await handlers.get('improve')(sender, { prompt: 'Not recorded while history is off.' });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).entries.length, 1);
    await handlers.get('insights-settings')(sender, { enabled: true });
    assert.equal(await handlers.get('insights-export')(sender), true);
    assert.equal(JSON.parse(fs.readFileSync(exportPath, 'utf8')).format, 'impromptu-prompt-log');
    await assert.rejects(handlers.get('insights-coach')(sender), /needs an AI model/);
    await handlers.get('open-reading')(sender, insights.READINGS.tips.url);
    assert.deepEqual(opened, [insights.READINGS.tips.url]);
    await assert.rejects(handlers.get('open-reading')(sender, 'https://evil.example/'), /Only links/);
    assert.equal((await handlers.get('insights-erase')(sender)).count, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries, []);
    await assert.rejects(handlers.get('insights-export')(sender), /no prompt history/);
    await assert.rejects(handlers.get('insights-state')({ sender: {}, senderFrame: { url: 'https://untrusted.example' } }), /Untrusted/);
  }
  const { handlers, sender } = desktop(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const sent = [];
  globalThis.fetch = async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Name your audience more often.","focus":["Audience"],"tips":["Add: for my manager."]}' } }] })); };
  await handlers.get('improve')(sender, { prompt: 'help with the thing' });
  await handlers.get('save-settings')(sender, { mode: 'compatible', endpoint: 'https://approved.example/v1/chat/completions', model: 'team-model', apiKey: 'key', importClipboard: true, localOnly: false });
  const coached = await handlers.get('insights-coach')(sender);
  assert.deepEqual([coached.summary, coached.local, coached.model], ['Name your audience more often.', false, 'team-model']);
  assert.match(sent[0].body.messages[0].content, /untrusted data/);
  assert.ok(sent[0].body.messages[1].content.includes('help with the thing'));
  await handlers.get('save-settings')(sender, { mode: 'compatible', endpoint: 'http://localhost:8080/v1/chat/completions', model: 'local-model', apiKey: '', importClipboard: true, localOnly: true });
  assert.equal((await handlers.get('insights-coach')(sender)).local, true);
  assert.equal(sent.at(-1).url, 'http://localhost:8080/v1/chat/completions');
});

test('ranked mode is opt-in, shares scores only, validates imported cards and can be left', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-cards-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let savePath = path.join(dir, 'mine.json'), openPaths = [];
  const { handlers, sender } = desktop(t, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: savePath }), showOpenDialog: async () => ({ canceled: false, filePaths: openPaths }) } });
  const { TASKS } = require('../src/learning.cjs');
  await assert.rejects(handlers.get('ranked-join')(sender, { alias: 'Tester' }), /Confirm what is shared/);
  await assert.rejects(handlers.get('ranked-export')(sender), /Join ranked mode first/);
  await assert.rejects(handlers.get('ranked-join')(sender, { alias: '<x>', consent: true }), /display name/);
  assert.equal((await handlers.get('ranked-join')(sender, { alias: 'Tester', consent: true })).ranked.joined, true);
  await assert.rejects(handlers.get('ranked-export')(sender), /all 6 tasks/);
  const secret = 'SECRET-PROMPT-TEXT';
  await handlers.get('benchmark-submit')(sender, Object.fromEntries(TASKS.map(task => [task.id, `${task.reference} ${secret}`])));
  assert.equal(await handlers.get('ranked-export')(sender), true);
  const exported = fs.readFileSync(savePath, 'utf8');
  assert.ok(!exported.includes(secret));
  assert.deepEqual(Object.keys(JSON.parse(exported)).sort(), ['alias', 'answered', 'app', 'date', 'format', 'tasks', 'total', 'version']);
  const card = (alias, score) => ({ format: 'impromptu-scorecard', version: 1, alias, total: score, answered: 6, tasks: Object.fromEntries(TASKS.map(task => [task.id, score])), date: new Date().toISOString() });
  const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
  openPaths = [write('a.json', card('Asha', 60)), write('b.json', card('Ben', 100)), write('tampered.json', { ...card('Cara', 40), total: 99 }), write('bad.json', '{nope'), write('own.json', card('Tester', 10))];
  const imported = await handlers.get('ranked-import')(sender);
  assert.deepEqual([imported.added, imported.updated, imported.skipped.length], [2, 0, 3]);
  assert.ok(imported.skipped.some(reason => /does not match/.test(reason)));
  const board = imported.state.ranked;
  assert.deepEqual(board.entries.map(e => [e.rank, e.alias]), [[1, 'Ben'], [2, 'Tester'], [3, 'Asha']]);
  assert.equal(board.entries[0].alias, 'Ben');
  assert.equal(board.entries.find(e => e.you).alias, 'Tester');
  assert.equal(board.participants, 3);
  const left = await handlers.get('ranked-leave')(sender, { clearBoard: true });
  assert.deepEqual([left.ranked.joined, left.ranked.participants], [false, 0]);
});

test('Prompt workspace evidence is guarded: unknown selections fail and local-only blocks lookups', async t => {
  const { handlers, sender } = desktop(t);
  await assert.rejects(handlers.get('improve')(sender, { prompt: 'Explain onboarding.', evidence: ['S1'] }), /no longer available/);
  await assert.rejects(handlers.get('evidence-lookup')(sender, '   '), /Add a search topic/);
  await handlers.get('save-settings')(sender, { mode: 'offline', endpoint: '', model: '', apiKey: '', importClipboard: true, localOnly: true });
  await assert.rejects(handlers.get('evidence-lookup')(sender, 'onboarding'), /Local-only mode is on/);
  assert.equal((await handlers.get('improve')(sender, { prompt: 'Explain onboarding to new joiners.' })).evidence, undefined);
});

test('the mascot needs explicit consent, reports permissions, and turning it off revokes consent', async t => {
  const { handlers, sender, data } = desktop(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => url.endsWith('/api/version') ? new Response(JSON.stringify({ version: '1' })) : url.endsWith('/api/tags') ? new Response(JSON.stringify({ models: [{ name: 'gemma4:latest' }] })) : new Response(JSON.stringify({ capabilities: ['vision'] }));
  await assert.rejects(handlers.get('mascot-enable')(sender, {}), /Confirm what the mascot can see/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'workspace.json'))).mascot, undefined);
  const on = await handlers.get('mascot-enable')(sender, { consent: true });
  assert.equal(on.settings.enabled, true);
  assert.deepEqual([on.permissions.screen, on.permissions.accessibility], [false, false]);
  assert.ok(JSON.parse(fs.readFileSync(path.join(data, 'workspace.json'))).mascot.consentAt);
  const updated = await handlers.get('mascot-update')(sender, { breakMinutes: 60, scrollFrames: 3, visionModel: 'gemma4:latest', enabled: false, consentAt: '' });
  assert.deepEqual([updated.settings.enabled, updated.settings.breakMinutes, updated.settings.scrollFrames], [true, 60, 3]);
  const off = await handlers.get('mascot-disable')(sender);
  assert.deepEqual([off.settings.enabled, off.settings.consentAt], [false, '']);
  await assert.rejects(handlers.get('mascot-permission')(sender, 'microphone'), /Unknown permission/);
});

test('context IPC installs only its own skill file, imports from the inbox and archives the file', async t => {
  const { handlers, sender, data } = desktop(t);
  const state = await handlers.get('context-state')(sender);
  assert.equal(state.inbox.path, path.join(data, 'Impromptu', 'Inbox'));
  assert.equal(JSON.stringify(state.skills.map(s => [s.tool, s.installed])), JSON.stringify([['cursor', false], ['claude-code', false], ['codex', false]]));
  const installed = await handlers.get('context-install-skill')(sender, 'cursor');
  const skill = path.join(data, '.cursor', 'skills', 'impromptu-handoff', 'SKILL.md');
  assert.equal(installed.skills.find(s => s.tool === 'cursor').installed, true);
  assert.ok(fs.readFileSync(skill, 'utf8').includes(path.join(data, 'Impromptu', 'Inbox')));
  await assert.rejects(handlers.get('context-install-skill')(sender, '../../etc'), /Unknown tool/);
  fs.writeFileSync(path.join(data, 'Impromptu', 'Inbox', 'handoff.md'), '---\nformat: impromptu-context-pack/1\nsource: codex\ntitle: Sample hand-off\n---\n## Goal\nTest\n## Open questions\nNone');
  const imported = await handlers.get('context-import-inbox')(sender, { name: 'handoff.md' });
  assert.equal(imported.pack.title, 'Sample hand-off');
  assert.equal(imported.state.inbox.files.length, 0);
  await assert.rejects(handlers.get('context-import-inbox')(sender, { name: '../workspace.json' }), /Choose a pack file/);
  fs.writeFileSync(path.join(data, '.claude-skill-other.md'), 'x');
  const other = path.join(data, '.codex', 'skills', 'impromptu-handoff', 'SKILL.md');
  fs.mkdirSync(path.dirname(other), { recursive: true }); fs.writeFileSync(other, 'name: someone-else');
  await handlers.get('context-remove-skill')(sender, 'codex');
  assert.equal(fs.existsSync(other), true);
  await handlers.get('context-remove-skill')(sender, 'cursor');
  assert.equal(fs.existsSync(skill), false);
});

test('context IPC installs only its own skill file, imports from the inbox and archives the file', async t => {
  const { handlers, sender, data } = desktop(t);
  const state = await handlers.get('context-state')(sender);
  assert.equal(state.inbox.path, path.join(data, 'Impromptu', 'Inbox'));
  assert.equal(JSON.stringify(state.skills.map(s => [s.tool, s.installed])), JSON.stringify([['cursor', false], ['claude-code', false], ['codex', false]]));
  const installed = await handlers.get('context-install-skill')(sender, 'cursor');
  const skill = path.join(data, '.cursor', 'skills', 'impromptu-handoff', 'SKILL.md');
  assert.equal(installed.skills.find(s => s.tool === 'cursor').installed, true);
  assert.ok(fs.readFileSync(skill, 'utf8').includes(path.join(data, 'Impromptu', 'Inbox')));
  await assert.rejects(handlers.get('context-install-skill')(sender, '../../etc'), /Unknown tool/);
  fs.writeFileSync(path.join(data, 'Impromptu', 'Inbox', 'handoff.md'), '---\nformat: impromptu-context-pack/1\nsource: codex\ntitle: Sample hand-off\n---\n## Goal\nTest\n## Open questions\nNone');
  const imported = await handlers.get('context-import-inbox')(sender, { name: 'handoff.md' });
  assert.equal(imported.pack.title, 'Sample hand-off');
  assert.equal(imported.state.inbox.files.length, 0);
  await assert.rejects(handlers.get('context-import-inbox')(sender, { name: '../workspace.json' }), /Choose a pack file/);
  fs.writeFileSync(path.join(data, '.claude-skill-other.md'), 'x');
  const other = path.join(data, '.codex', 'skills', 'impromptu-handoff', 'SKILL.md');
  fs.mkdirSync(path.dirname(other), { recursive: true }); fs.writeFileSync(other, 'name: someone-else');
  await handlers.get('context-remove-skill')(sender, 'codex');
  assert.equal(fs.existsSync(other), true);
  await handlers.get('context-remove-skill')(sender, 'cursor');
  assert.equal(fs.existsSync(skill), false);
});

test('chats can use the configured cloud provider: listed, multi-turn, labelled, and blocked by local-only mode', async t => {
  const { handlers, sender, events } = desktop(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('http://localhost:11434')) throw new TypeError('fetch failed');
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: `Cloud reply ${sent.length}` } }], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
  };
  await handlers.get('save-settings')(sender, { mode: 'compatible', endpoint: 'https://approved.example/v1/chat/completions', model: 'team-model', apiKey: 'key', importClipboard: true, localOnly: false });
  const providers = await handlers.get('chat-providers')(sender);
  assert.equal(providers.local.length, 0);
  assert.deepEqual(providers.cloud.map(p => p.mode), ['openrouter', 'bedrock', 'huggingface', 'compatible']);
  assert.equal(providers.cloud.find(p => p.mode === 'compatible').available, true);
  assert.match(providers.cloud.find(p => p.mode === 'bedrock').reason, /Set up AWS Bedrock/);
  const chat = await handlers.get('chat-new')(sender, { provider: 'cloud' });
  assert.deepEqual([chat.provider, chat.providerLabel, chat.model], ['cloud', 'Custom API (approved.example)', 'team-model']);
  const first = await handlers.get('chat-send')(sender, { chatId: chat.id, text: 'Here is my context pack.' });
  assert.equal(first.message.content, 'Cloud reply 1');
  assert.deepEqual(first.message.usage, { input: 50, output: 5 });
  await handlers.get('chat-send')(sender, { chatId: chat.id, text: 'And the follow-up?' });
  assert.equal(JSON.stringify(sent[1].messages.map(m => m.role)), JSON.stringify(['system', 'user', 'assistant', 'user']));
  assert.match(sent[1].messages[0].content, /configured AI provider/);
  assert.ok(events.some(e => e[0] === 'chat-delta' && e[1].delta === 'Cloud reply 2'));
  await assert.rejects(handlers.get('save-settings')(sender, { mode: 'compatible', endpoint: 'https://approved.example/v1/chat/completions', model: 'team-model', apiKey: '', importClipboard: true, localOnly: true }), /Local-only mode is on/);
  await handlers.get('save-settings')(sender, { mode: 'offline', endpoint: '', model: '', apiKey: '', importClipboard: true, localOnly: true });
  await assert.rejects(handlers.get('chat-send')(sender, { chatId: chat.id, text: 'Blocked?' }), /This chat uses Custom API/);
  await assert.rejects(handlers.get('chat-new')(sender, { provider: 'cloud' }), /Set up a cloud provider/);
  assert.equal((await handlers.get('chat-providers')(sender)).cloud.every(p => !p.available), true);
});

test('one-click local AI needs consent, reuses a running Ollama, downloads the chosen model, then tests and saves it', async t => {
  const { handlers, sender, events } = desktop(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let pulled = false;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/version')) return new Response(JSON.stringify({ version: '0.40.4' }));
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: pulled ? [{ name: 'gemma3:4b' }] : [] }));
    if (url.endsWith('/api/pull')) { pulled = true; return new Response([{ status: 'pulling x', digest: 'x', total: 10, completed: 10 }, { status: 'success' }].map(l => JSON.stringify(l)).join('\n')); }
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ improved: 'Invite readers.', changes: [], questions: [] }) } }));
  };
  await assert.rejects(handlers.get('local-ai-install')(sender, { model: 'gemma3:4b' }), /Agree to the downloads/);
  await assert.rejects(handlers.get('local-ai-install')(sender, { consent: true, model: 'bad model!' }), /Choose a model/);
  const plan = await handlers.get('local-ai-plan')(sender);
  assert.equal(plan.ollama.running, true);
  assert.ok(plan.catalog.some(m => m.recommended));
  const result = await handlers.get('local-ai-install')(sender, { consent: true, model: 'gemma3:4b', localOnly: true });
  assert.equal(pulled, true);
  assert.deepEqual([result.state.connection.mode, result.state.connection.model, result.state.localOnly], ['ollama', 'gemma3:4b', true]);
  assert.ok(events.some(e => e[0] === 'local-ai-progress' && e[1].stage === 'done'));
});
