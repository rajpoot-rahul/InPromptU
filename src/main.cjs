'use strict';
const { app, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage, dialog, session, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { skills, analyze, normalizeInput } = require('./engine.cjs');
const { requestImprovement, validateConnection } = require('./provider.cjs');
const { KnowledgeService, sourceURL } = require('./knowledge.cjs');

app.setName('Impromptu');
if (process.env.IMPROMPTU_USER_DATA) app.setPath('userData', path.resolve(process.env.IMPROMPTU_USER_DATA));
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
let win, tray, state, knowledge, sessionKey = '', busy = false, quitting = false, shortcutRegistered = false;
const sourceLinks = new Set();
const shortcut = 'CommandOrControl+Shift+I';
const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;

function readState() {
  const defaults = { connection: { mode: 'offline', endpoint: '', model: '' }, theme: 'system', codexPath: '', importClipboard: true, history: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'workspace.json'), 'utf8'));
    return { ...defaults, connection: validateConnection(saved.connection), theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : 'system', codexPath: typeof saved.codexPath === 'string' ? saved.codexPath : '', importClipboard: saved.importClipboard !== false, history: Array.isArray(saved.history) ? saved.history.slice(0, 100) : [] };
  } catch { return defaults; }
}
function persist() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, 'workspace.tmp');
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, 'workspace.json'));
}
function publicState() {
  return { skills, connection: state.connection, theme: state.theme, knowledge: knowledge?.status(), hasKey: Boolean(sessionKey), importClipboard: state.importClipboard, history: state.history, platform: process.platform, shortcutRegistered, version: app.getVersion() };
}
function createKnowledgeService() {
  const cwd = path.join(app.getPath('userData'), 'knowledge-runtime');
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  return new KnowledgeService({ cwd, executable: state.codexPath, onProgress: message => { if (win && !win.isDestroyed()) win.webContents.send('knowledge-progress', message); } });
}
async function show(importText = false) {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (importText && state.importClipboard) {
    try {
      const value = await clipboard.readText();
      if (value.trim()) {
        const send = () => { if (win && !win.isDestroyed()) win.webContents.send('clipboard-invoked', value.slice(0, 30000)); };
        if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send();
      }
    } catch { win?.webContents.send('desktop-notice', 'Clipboard access was unavailable. You can paste the prompt into the editor.'); }
  }
}
function createWindow() {
  win = new BrowserWindow({ width: 1220, height: 850, minWidth: 860, minHeight: 650, backgroundColor: nativeTheme.shouldUseDarkColors ? '#121715' : '#f7f8fa', title: 'Impromptu', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', trafficLightPosition: { x: 20, y: 18 }, icon: path.join(__dirname, 'assets/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault(); });
  win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
}
function handle(name, handler) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame?.url !== entry) throw new Error('Untrusted app request.');
    return handler(...args);
  });
}

if (lock) {
  app.on('second-instance', () => show());
  app.whenReady().then(() => {
    state = readState();
    nativeTheme.themeSource = state.theme;
    nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#121715' : '#f7f8fa'); });
    knowledge = createKnowledgeService();
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    handle('bootstrap', () => publicState());
    handle('set-theme', theme => {
      if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Choose System, Light or Dark appearance.');
      const previous = state.theme;
      state.theme = theme;
      try { persist(); } catch (error) { state.theme = previous; throw error; }
      nativeTheme.themeSource = theme;
      return { theme };
    });
    handle('knowledge-connect', () => knowledge.connect());
    handle('knowledge-lookup', async input => {
      const result = await knowledge.lookup(input);
      sourceLinks.clear(); result.sources.forEach(source => sourceLinks.add(source.url));
      return result;
    });
    handle('knowledge-source', async url => {
      if (!sourceLinks.has(url) || !sourceURL(url)) throw new Error('Only retrieved Hyland source links can be opened.');
      await shell.openExternal(url); return true;
    });
    handle('knowledge-disconnect', () => { if (knowledge.active) throw new Error('Wait for the lookup to finish.'); knowledge.close(); sourceLinks.clear(); return knowledge.status(); });
    handle('knowledge-locate', async () => {
      if (knowledge.active) throw new Error('Wait for the lookup to finish.');
      const result = await dialog.showOpenDialog(win, { title: 'Choose the Codex executable', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Codex executable', extensions: ['exe'] }] } : {}) });
      if (result.canceled) return knowledge.status();
      const file = result.filePaths[0];
      if (!['codex', 'codex.exe'].includes(path.basename(file).toLowerCase()) || !fs.statSync(file).isFile()) throw new Error('Choose the codex or codex.exe executable installed by Codex.');
      knowledge.close(); state.codexPath = file; persist(); knowledge = createKnowledgeService(); return knowledge.status();
    });
    handle('analyze', input => analyze(input));
    handle('improve', async input => {
      if (busy) throw new Error('An improvement is already in progress.');
      busy = true;
      try { const start = Date.now(); return { ...await requestImprovement(input, state.connection, sessionKey), durationMs: Date.now() - start }; }
      finally { busy = false; }
    });
    handle('clipboard-read', async () => (await clipboard.readText()).slice(0, 30000));
    handle('clipboard-write', async value => { if (typeof value !== 'string' || value.length > 60000) throw new Error('Invalid clipboard text.'); await clipboard.writeText(value); return true; });
    handle('save-settings', input => {
      const connection = validateConnection(input);
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 5000) throw new Error('Invalid API key.');
      // Keys never reach disk and cannot be silently reused with a different endpoint.
      if (connection.endpoint !== state.connection.endpoint || connection.mode !== state.connection.mode || input.clearKey) sessionKey = '';
      if (input.apiKey) sessionKey = input.apiKey.trim();
      state.connection = connection;
      state.importClipboard = input.importClipboard === true;
      persist(); updateTray(); return publicState();
    });
    handle('save-history', payload => {
      const input = normalizeInput(payload.input);
      const result = payload.result;
      if (!result || typeof result.improved !== 'string' || result.improved.length > 60000 || !Array.isArray(result.changes) || !Array.isArray(result.questions)) throw new Error('Invalid saved suggestion.');
      const record = { id: crypto.randomUUID(), date: new Date().toISOString(), input, result, feedback: null };
      if (JSON.stringify(record).length > 160000) throw new Error('This session is too large to save.');
      state.history = [record, ...state.history].slice(0, 100); persist(); return record;
    });
    handle('feedback', ({ id, value }) => {
      if (!['helpful', 'needs-work', null].includes(value)) throw new Error('Invalid feedback.');
      const item = state.history.find(h => h.id === id); if (item) { item.feedback = value; persist(); } return state.history;
    });
    handle('delete-history', id => { state.history = state.history.filter(h => h.id !== id); persist(); return state.history; });
    handle('export-history', async () => {
      const result = await dialog.showSaveDialog(win, { title: 'Export your saved sessions', defaultPath: 'impromptu-history.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return false;
      fs.writeFileSync(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), sessions: state.history }, null, 2), { mode: 0o600 }); return true;
    });
    handle('hide', () => win.hide());
    handle('quit', () => app.quit());
    createWindow();
    shortcutRegistered = globalShortcut.register(shortcut, () => show(true));
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/tray.png')).resize({ width: 18, height: 18 });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon); tray.setToolTip('Impromptu — your prompt companion'); tray.on('click', () => show()); updateTray();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Impromptu', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Hide Impromptu', accelerator: 'Command+H', click: () => win.hide() }, { role: 'quit' }] }] : []),
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Window', submenu: [{ label: 'Show Impromptu', accelerator: shortcut, click: () => show(true) }, { role: 'minimize' }, ...(process.platform === 'win32' ? [{ role: 'quit' }] : [])] }
    ]));
  });
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Impromptu', click: () => show() },
    { label: 'Bring copied prompt', click: () => show(true) },
    { type: 'separator' },
    { label: 'Import clipboard on shortcut', type: 'checkbox', checked: state.importClipboard, click: item => { state.importClipboard = item.checked; persist(); win?.webContents.send('settings-changed', publicState()); } },
    { type: 'separator' }, { label: 'Quit Impromptu', click: () => app.quit() }
  ]));
}
app.on('activate', () => { if (state) show(); });
app.on('before-quit', () => { quitting = true; knowledge?.close(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
