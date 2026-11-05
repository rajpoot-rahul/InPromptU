const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function desktop(t, { platform = 'darwin', theme = 'system' } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-test-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify({ connection: { mode: 'offline', endpoint: '', model: '' }, theme, history: [] }));
  const handlers = new Map(), shortcuts = new Map(), events = [];
  let ready, window, copied = 'Synthetic test prompt';
  class BrowserWindow {
    constructor(options) { window = this; this.options = options; this.vibrancy = options.vibrancy || null; this.background = options.backgroundColor; this.vibrancyCalls = 0; this.webContents = { send: (...args) => events.push(args), isLoading: () => false, setWindowOpenHandler() {}, on() {} }; }
    loadFile() {} on() {} once() {} isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {} hide() {}
    setVibrancy(value) { this.vibrancy = value; this.vibrancyCalls++; }
    setBackgroundColor(value) { this.background = value; }
  }
  class Tray { setToolTip() {} on() {} setContextMenu() {} }
  const image = { resize() { return this; }, setTemplateImage() {} };
  const fake = {
    app: { setName() {}, requestSingleInstanceLock: () => true, getPath: () => data, getVersion: () => 'test', on() {}, whenReady: () => ({ then: callback => ready = callback }) },
    BrowserWindow, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    clipboard: { readText: async () => copied, writeText: async value => { await Promise.resolve(); copied = value; } },
    globalShortcut: { register: (name, fn) => { shortcuts.set(name, fn); return true; }, unregisterAll() {} },
    Tray, Menu: { buildFromTemplate: value => value, setApplicationMenu() {} }, nativeImage: { createFromPath: () => image },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, prefersReducedTransparency: false, shouldUseHighContrastColors: false, on(_event, callback) { this.updated = callback; } },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }, dialog: {}
  };
  const dir = path.resolve(__dirname, '../src');
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'main.cjs'), 'utf8'), { require: name => name === 'electron' ? fake : name.startsWith('./') ? require(path.join(dir, name)) : require(name), __dirname: dir, process: { platform, env: {} }, console });
  ready();
  const sender = { sender: window.webContents, senderFrame: { url: pathToFileURL(path.join(dir, 'index.html')).href } };
  return { handlers, shortcuts, events, sender, window, data, nativeTheme: fake.nativeTheme, copied: () => copied };
}

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

test('Windows keeps its existing themes and rejects the Mac Glass option', async t => {
  const { handlers, sender, window, nativeTheme } = desktop(t, { platform: 'win32', theme: 'glass' });
  assert.equal((await handlers.get('bootstrap')(sender)).theme, 'system');
  await assert.rejects(handlers.get('set-theme')(sender, 'glass'), /Choose/);
  await handlers.get('set-theme')(sender, 'dark');
  assert.equal(nativeTheme.themeSource, 'dark');
  assert.equal(window.vibrancyCalls, 0);
  assert.equal(window.options.vibrancy, undefined);
});

test('Max-ind persists on Mac, follows system appearance, and stays unavailable on Windows', async t => {
  const { handlers, sender, nativeTheme, window, data } = desktop(t);
  await handlers.get('set-theme')(sender, 'max-ind');
  assert.equal(nativeTheme.themeSource, 'system');
  assert.equal(window.vibrancy, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'workspace.json'))).theme, 'max-ind');
  const restored = desktop(t, { theme: 'max-ind' });
  assert.equal((await restored.handlers.get('bootstrap')(restored.sender)).theme, 'max-ind');
  const windows = desktop(t, { platform: 'win32', theme: 'max-ind' });
  assert.equal((await windows.handlers.get('bootstrap')(windows.sender)).theme, 'system');
  await assert.rejects(windows.handlers.get('set-theme')(windows.sender, 'max-ind'), /Choose/);
});
