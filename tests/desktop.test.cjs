const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('desktop IPC awaits clipboard operations, and the shortcut imports copied text', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'impromptu-test-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const handlers = new Map(), shortcuts = new Map(), events = [];
  let ready, window, copied = 'Synthetic test prompt';
  class BrowserWindow {
    constructor() { window = this; this.webContents = { send: (...args) => events.push(args), isLoading: () => false, setWindowOpenHandler() {}, on() {} }; }
    loadFile() {} on() {} isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {} hide() {}
  }
  class Tray { setToolTip() {} on() {} setContextMenu() {} }
  const image = { resize() { return this; }, setTemplateImage() {} };
  const fake = {
    app: { setName() {}, requestSingleInstanceLock: () => true, getPath: () => data, getVersion: () => 'test', on() {}, whenReady: () => ({ then: callback => ready = callback }) },
    BrowserWindow, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    clipboard: { readText: async () => copied, writeText: async value => { await Promise.resolve(); copied = value; } },
    globalShortcut: { register: (name, fn) => { shortcuts.set(name, fn); return true; }, unregisterAll() {} },
    Tray, Menu: { buildFromTemplate: value => value, setApplicationMenu() {} }, nativeImage: { createFromPath: () => image },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, on() {} },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }, dialog: {}
  };
  const dir = path.resolve(__dirname, '../src');
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'main.cjs'), 'utf8'), { require: name => name === 'electron' ? fake : name.startsWith('./') ? require(path.join(dir, name)) : require(name), __dirname: dir, process: { platform: 'darwin', env: {} }, console });
  ready();
  const sender = { sender: window.webContents, senderFrame: { url: pathToFileURL(path.join(dir, 'index.html')).href } };
  assert.equal(await handlers.get('clipboard-read')(sender), 'Synthetic test prompt');
  await handlers.get('clipboard-write')(sender, 'Improved test prompt');
  assert.equal(copied, 'Improved test prompt');
  await shortcuts.get('CommandOrControl+Shift+I')();
  assert.equal(events.at(-1)[0], 'clipboard-invoked');
  assert.equal(events.at(-1)[1], 'Improved test prompt');
  await assert.rejects(handlers.get('clipboard-read')({ sender: {}, senderFrame: { url: 'https://untrusted.example' } }), /Untrusted/);
});
