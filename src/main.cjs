'use strict';
const { app, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage, dialog, session, shell, nativeTheme, desktopCapturer, screen, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { analyze, normalizeInput } = require('./engine.cjs');
const { requestImprovement, validateConnection, assertAllowed, complete } = require('./provider.cjs');
const ollama = require('./ollama.cjs');
const { ChatStore, streamChat, LIMITS: chatLimits } = require('./chat.cjs');
const { SkillStore, generateSkill } = require('./skills.cjs');
const learning = require('./learning.cjs');
const { EvidenceCache, evidenceContext, summaries: evidenceSummaries } = require('./evidence.cjs');
const mascotLib = require('./mascot.cjs');
const contextLib = require('./context.cjs');
const installer = require('./installer.cjs');
const { KnowledgeService, sourceURL } = require('./knowledge.cjs');

app.setName('Impromptu');
if (process.env.IMPROMPTU_USER_DATA) app.setPath('userData', path.resolve(process.env.IMPROMPTU_USER_DATA));
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
let chats, skillStore, packStore, inboxWatcher = null;
const evidenceCache = new EvidenceCache();
const coach = new mascotLib.Coach();
let mascotWin = null, mascotTimer = null, mascotView = { busy: '', capturing: false, message: null, nudge: null, vision: { ok: false, message: 'Checking your local model…' } };
const chatReplies = new Map();
let win, tray, state, knowledge, sessionKey = '', busy = false, quitting = false, shortcutRegistered = false;
const sourceLinks = new Set();
const shortcut = 'CommandOrControl+Shift+I';
const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
const themes = ['system', 'light', 'dark', 'glass', 'max-ind'];

function appearanceState() {
  return { theme: state.theme, reducedTransparency: Boolean(nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors) };
}
function glassEnabled() {
  return process.platform === 'darwin' && state.theme === 'glass' && !appearanceState().reducedTransparency;
}
function windowBackground() {
  return glassEnabled() ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#121715' : '#f7f8fa';
}
function updateWindowAppearance() {
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin') win.setVibrancy(glassEnabled() ? 'under-window' : null);
  win.setBackgroundColor(windowBackground());
  win.webContents.send('appearance-changed', appearanceState());
}
function applyAppearance() {
  nativeTheme.themeSource = ['glass', 'max-ind'].includes(state.theme) ? 'system' : state.theme;
  updateWindowAppearance();
}

function readState() {
  const defaults = { connection: { mode: 'offline', endpoint: '', model: '' }, theme: 'system', codexPath: '', importClipboard: true, localOnly: false, setup: { dismissed: false, completedAt: '' }, chat: { saveNewChats: true, model: '' }, learning: { events: {}, manual: {}, runs: [] }, ranked: { joined: false, alias: '', joinedAt: '', board: [] }, mascot: { ...mascotLib.DEFAULTS }, history: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'workspace.json'), 'utf8'));
    return { ...defaults, connection: validateConnection(saved.connection), theme: themes.includes(saved.theme) ? saved.theme : 'system', codexPath: typeof saved.codexPath === 'string' ? saved.codexPath : '', importClipboard: saved.importClipboard !== false, localOnly: saved.localOnly === true, setup: { dismissed: saved.setup?.dismissed === true, completedAt: typeof saved.setup?.completedAt === 'string' ? saved.setup.completedAt : '' }, chat: { saveNewChats: saved.chat?.saveNewChats !== false, model: typeof saved.chat?.model === 'string' ? saved.chat.model.slice(0, 200) : '' }, learning: readLearning(saved.learning), ranked: readRanked(saved.ranked), mascot: mascotLib.readSettings(saved.mascot), history: Array.isArray(saved.history) ? saved.history.slice(0, 100) : [] };
  } catch { return defaults; }
}
function readLearning(raw) {
  const events = {}, manual = {};
  for (const [key, value] of Object.entries(raw?.events || {})) if (/^[a-z]{2,20}$/.test(key) && Number.isSafeInteger(value) && value >= 0) events[key] = value;
  for (const [key, value] of Object.entries(raw?.manual || {})) if (learning.MILESTONES.some(m => m.id === key && !m.auto) && typeof value === 'string') manual[key] = value;
  return { events, manual, runs: Array.isArray(raw?.runs) ? raw.runs.filter(run => run && typeof run.id === 'string' && Array.isArray(run.tasks)).slice(0, 20) : [] };
}
function readRanked(raw) {
  const board = (Array.isArray(raw?.board) ? raw.board : []).flatMap(card => { try { return [{ ...learning.validateScorecard({ ...card, format: 'impromptu-scorecard', version: 1, answered: learning.TASKS.length }), importedAt: String(card.importedAt || '') }]; } catch { return []; } }).slice(0, 200);
  let alias = ''; try { alias = raw?.alias ? learning.validAlias(raw.alias) : ''; } catch {}
  return { joined: raw?.joined === true && Boolean(alias), alias, joinedAt: typeof raw?.joinedAt === 'string' ? raw.joinedAt : '', board };
}
function ownCard() {
  const run = state.learning.runs.find(item => item.answered === learning.TASKS.length);
  return state.ranked.joined && run ? learning.makeScorecard(run, state.ranked.alias, app.getVersion()) : null;
}
function rankedState() {
  const own = ownCard();
  return { joined: state.ranked.joined, alias: state.ranked.alias, joinedAt: state.ranked.joinedAt, hasCard: Boolean(own), imported: state.ranked.board.length, ...learning.leaderboard(state.ranked.board, own) };
}
function learn(event) {
  state.learning.events[event] = (state.learning.events[event] || 0) + 1;
  try { persist(); } catch {}
}
function learningState() {
  return { ...learning.publicCurriculum(), progress: learning.progress({ history: state.history, events: state.learning.events, skills: skillStore.all(), manual: state.learning.manual, runs: state.learning.runs }), runs: state.learning.runs, events: state.learning.events, ranked: rankedState() };
}
function assertRemoteAllowed(purpose) {
  if (state.localOnly) throw new Error(`Local-only mode is on. ${purpose} Turn off local-only mode in Settings to use it.`);
}
function persist() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, 'workspace.tmp');
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, 'workspace.json'));
}
function publicState() {
  return { skills: skillStore.all(), connection: state.connection, ...appearanceState(), knowledge: knowledge?.status(), hasKey: Boolean(sessionKey), importClipboard: state.importClipboard, localOnly: state.localOnly, setup: state.setup, chat: state.chat, history: state.history, platform: process.platform, shortcutRegistered, version: app.getVersion() };
}
function createKnowledgeService() {
  const cwd = path.join(app.getPath('userData'), 'knowledge-runtime');
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  return new KnowledgeService({ cwd, executable: state.codexPath, onProgress: message => { if (win && !win.isDestroyed()) win.webContents.send('knowledge-progress', message); } });
}
async function show(importText = false) {
  let selected = '';
  // With the mascot on and Accessibility granted, the shortcut copies the selection itself.
  if (importText && state.importClipboard && state.mascot.enabled && mascotPermissions().accessibility) {
    try { selected = await mascotLib.grabSelection({ clipboard }); } catch {}
  }
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (importText && state.importClipboard) {
    try {
      const value = selected.trim() ? selected : await clipboard.readText();
      if (value.trim()) {
        const send = () => { if (win && !win.isDestroyed()) win.webContents.send('clipboard-invoked', value.slice(0, 30000)); };
        if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send();
      }
    } catch { win?.webContents.send('desktop-notice', 'Clipboard access was unavailable. You can paste the prompt into the editor.'); }
  }
}
const inboxDir = () => path.join(app.getPath('home'), 'Impromptu', 'Inbox');
const skillTargets = () => ({ cursor: path.join(app.getPath('home'), '.cursor', 'skills', 'impromptu-handoff', 'SKILL.md'), 'claude-code': path.join(app.getPath('home'), '.claude', 'skills', 'impromptu-handoff', 'SKILL.md'), codex: path.join(app.getPath('home'), '.codex', 'skills', 'impromptu-handoff', 'SKILL.md') });
function watchInbox() {
  try { inboxWatcher?.close(); } catch {}
  inboxWatcher = null;
  if (!fs.existsSync(inboxDir())) return;
  let timer;
  try { inboxWatcher = fs.watch(inboxDir(), () => { clearTimeout(timer); timer = setTimeout(() => win?.webContents.send('context-inbox-changed', contextLib.inboxFiles(inboxDir()).length), 400); }); inboxWatcher.unref?.(); } catch {}
}
function contextState() {
  const targets = skillTargets();
  return { packs: packStore.summaries(), inbox: { path: inboxDir(), exists: fs.existsSync(inboxDir()), files: contextLib.inboxFiles(inboxDir()) }, skills: Object.entries(targets).map(([tool, file]) => ({ tool, path: file, installed: fs.existsSync(file) })), prompt: contextLib.handoffPrompt(inboxDir()), sections: contextLib.SECTIONS };
}
function ensureInbox() { fs.mkdirSync(inboxDir(), { recursive: true, mode: 0o700 }); watchInbox(); }
const mascotEntry = pathToFileURL(path.join(__dirname, 'mascot.html')).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function mascotPermissions() {
  if (process.platform === 'darwin') return { screen: systemPreferences.getMediaAccessStatus('screen') === 'granted', accessibility: systemPreferences.isTrustedAccessibilityClient(false) };
  return { screen: process.platform === 'win32', accessibility: process.platform === 'win32' };
}
async function mascotVision() {
  const endpoint = state.connection.mode === 'ollama' ? state.connection.endpoint : ollama.DEFAULT_ENDPOINT;
  const model = state.mascot.visionModel || (state.connection.mode === 'ollama' ? state.connection.model : '') || state.chat.model;
  const found = await ollama.probe(endpoint);
  if (found.status !== 'ready') return { ok: false, message: found.message };
  if (!model) return { ok: false, message: 'Choose a local vision model in Settings → Mascot.' };
  if (!found.models.some(m => m.name === model)) return { ok: false, message: `${model} is not installed in Ollama.` };
  if (!await mascotLib.visionCapable(endpoint, model)) return { ok: false, message: `${model} cannot read images. Choose a vision model in Settings → Mascot.` };
  return { ok: true, endpoint, model };
}
function mascotPublic() { return { ...mascotView, permissions: mascotPermissions(), scrollFrames: state.mascot.scrollFrames }; }
function pushMascot() { if (mascotWin && !mascotWin.isDestroyed()) mascotWin.webContents.send('mascot-update', mascotPublic()); }
function mascotBounds(expanded) {
  const area = screen.getPrimaryDisplay().workArea;
  const width = expanded ? 320 : 96, height = expanded ? 480 : 96;
  return { x: area.x + area.width - width - 12, y: area.y + area.height - height - 12, width, height };
}
function createMascot() {
  if (mascotWin && !mascotWin.isDestroyed()) return;
  const mac = process.platform === 'darwin';
  mascotWin = new BrowserWindow({ ...mascotBounds(false), transparent: true, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: false, show: false, title: 'Impromptu mascot', ...(mac ? { type: 'panel', acceptFirstMouse: true } : {}), webPreferences: { preload: path.join(__dirname, 'mascot-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  mascotWin.setAlwaysOnTop(true, 'floating');
  mascotWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mascotWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mascotWin.webContents.on('will-navigate', (event, url) => { if (url !== mascotEntry) event.preventDefault(); });
  mascotWin.once('ready-to-show', () => mascotWin?.showInactive());
  mascotWin.on('closed', () => { mascotWin = null; });
  mascotWin.loadFile(path.join(__dirname, 'mascot.html'));
  refreshMascotVision();
  clearInterval(mascotTimer);
  mascotTimer = setInterval(() => maybeNudge(), 5 * 60000);
}
function closeMascot() { clearInterval(mascotTimer); mascotTimer = null; if (mascotWin && !mascotWin.isDestroyed()) mascotWin.destroy(); mascotWin = null; }
async function refreshMascotVision() { mascotView.vision = await mascotVision().catch(error => ({ ok: false, message: error.message })); pushMascot(); return mascotView.vision; }
function maybeNudge(nudge) {
  if (!state.mascot.enabled || !state.mascot.nudges || mascotView.nudge || mascotView.busy) return;
  const next = nudge || coach.check({ breakMinutes: state.mascot.breakMinutes });
  if (next) { mascotView.nudge = next; pushMascot(); }
}
function routeMain(channel, payload) {
  show().then(() => { const send = () => win?.webContents.send(channel, payload); if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send(); });
}
async function screenTask(name, payload) {
  const permissions = mascotPermissions();
  if (!permissions.screen) throw new Error('Grant Screen Recording permission in Impromptu Settings → Mascot first.');
  if (name === 'read-page' && !permissions.accessibility) throw new Error('Reading a whole page scrolls it for you. Grant Accessibility permission in Settings → Mascot first.');
  const vision = await refreshMascotVision();
  if (!vision.ok) throw new Error(vision.message);
  const question = name === 'ask-screen' ? String(payload?.question || '').slice(0, mascotLib.LIMITS.question) : name === 'read-page' ? 'Read this whole page and give me its full context: what it is, the key points in order, and any decisions, requests or open questions.' : 'Explain what is on this screen and summarise the important points.';
  if (name === 'ask-screen' && !question.trim()) throw new Error('Type a question about the screen first.');
  Object.assign(mascotView, { busy: 'Reading your screen…', capturing: true, message: null, nudge: null }); pushMascot();
  const frames = [];
  try {
    if (process.platform === 'darwin' && !(await mascotLib.seesOtherApps({ desktopCapturer, ownPid: process.pid, appName: app.getName() }))) throw new Error('macOS is not letting Impromptu see other apps, so the capture would be blank. In System Settings → Privacy & Security → Screen & System Audio Recording, remove Impromptu with the minus button, add it again, then quit and reopen Impromptu.');
    mascotWin?.hide(); await wait(250);
    frames.push(await mascotLib.captureDisplay({ desktopCapturer, screen }));
    if (name === 'read-page') {
      let scrolled = 0;
      for (let i = 1; i < state.mascot.scrollFrames; i++) {
        await mascotLib.sendKeys('pageDown'); scrolled++; await wait(500);
        const frame = await mascotLib.captureDisplay({ desktopCapturer, screen });
        if (frame.hash === frames.at(-1).hash) break;
        frames.push(frame);
      }
      for (let i = 0; i < scrolled; i++) await mascotLib.sendKeys('pageUp').catch(() => {});
    }
  } catch (error) { Object.assign(mascotView, { busy: '', capturing: false }); mascotWin?.showInactive(); throw error; }
  Object.assign(mascotView, { capturing: false, busy: `Reading ${frames.length === 1 ? 'the screen' : `${frames.length} screens`} with ${vision.model} on this computer…` });
  mascotWin?.showInactive(); pushMascot();
  try {
    const result = await mascotLib.describeScreens({ images: frames.map(frame => frame.base64), question, endpoint: vision.endpoint, model: vision.model });
    const chat = chats.create({ model: vision.model, temporary: !state.chat.saveNewChats });
    chats.append(chat.id, { role: 'user', content: `[${name === 'read-page' ? `Read ${frames.length} ${frames.length === 1 ? 'screen' : 'screens'} of this page` : 'Screen capture'}] ${result.question}` });
    chats.append(chat.id, { role: 'assistant', content: result.text, model: vision.model, usage: result.usage, durationMs: result.durationMs });
    learn('screen');
    mascotView.message = { text: `Read by ${vision.model} on this computer in ${(result.durationMs / 1000).toFixed(1)} s. Screenshots were not saved.`, detail: result.text.slice(0, 6000), actions: [{ name: 'copy-answer', label: 'Copy', payload: { chatId: chat.id } }, { name: 'open-chat', label: 'Continue in Local chat', payload: { chatId: chat.id } }, { name: 'dismiss', label: 'Close' }] };
  } finally { mascotView.busy = ''; }
}
async function mascotAction(name, payload) {
  if (!state.mascot.enabled) throw new Error('Turn on the mascot in Settings first.');
  if (mascotView.busy) throw new Error('Wait for the current action to finish.');
  mascotView.message = null;
  if (name === 'open-app') await show();
  else if (name === 'dismiss') mascotView.message = null;
  else if (name === 'copy-answer') {
    const answer = chats.get(String(payload?.chatId || '')).messages.findLast(m => m.role === 'assistant');
    if (answer) clipboard.writeText(answer.content);
    mascotView.message = { text: 'Answer copied.', actions: [{ name: 'dismiss', label: 'OK' }] };
  }
  else if (name === 'nudge-dismiss') mascotView.nudge = null;
  else if (name === 'nudge-action') {
    mascotView.nudge = null;
    if (payload?.label === 'Explain my prompt') routeMain('mascot-route', { view: 'workspace', action: 'explain' });
    else if (payload?.label === 'Open the Prompt workspace') routeMain('mascot-route', { view: 'workspace' });
  } else if (name === 'open-chat') {
    if (typeof payload?.chatId !== 'string') throw new Error('Invalid chat.');
    routeMain('mascot-open-chat', payload.chatId);
  } else if (name === 'selection-workspace' || name === 'selection-knowledge') {
    if (!mascotPermissions().accessibility) throw new Error('Grant Accessibility permission in Settings → Mascot so Impromptu can copy your selection.');
    const text = await mascotLib.grabSelection({ clipboard });
    if (!text.trim()) mascotView.message = { text: 'No selected text was found. Select some text in any app, then try again.', tone: 'warning' };
    else routeMain('mascot-text', { text, target: name === 'selection-knowledge' ? 'knowledge' : 'workspace' });
  } else if (['explain-screen', 'ask-screen', 'read-page'].includes(name)) await screenTask(name, payload);
  else throw new Error('Unknown mascot action.');
  return mascotPublic();
}
function createWindow() {
  const mac = process.platform === 'darwin';
  win = new BrowserWindow({ width: 1220, height: 850, minWidth: 860, minHeight: 650, backgroundColor: windowBackground(), title: 'Impromptu', titleBarStyle: mac ? 'hiddenInset' : 'default', trafficLightPosition: { x: 20, y: 18 }, ...(mac ? { show: false, vibrancy: glassEnabled() ? 'under-window' : undefined, visualEffectState: 'followWindow' } : {}), icon: path.join(__dirname, 'assets/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, additionalArguments: [`--impromptu-theme=${state.theme}`, `--impromptu-reduced-transparency=${appearanceState().reducedTransparency}`] } });
  if (mac) win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
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
    applyAppearance();
    nativeTheme.on('updated', updateWindowAppearance);
    knowledge = createKnowledgeService();
    chats = new ChatStore(path.join(app.getPath('userData'), 'chats.json'));
    skillStore = new SkillStore(path.join(app.getPath('userData'), 'skills.json'));
    packStore = new contextLib.PackStore(path.join(app.getPath('userData'), 'context-packs.json'));
    watchInbox();
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    handle('bootstrap', () => publicState());
    handle('set-theme', theme => {
      if (!themes.includes(theme)) throw new Error(`Choose ${themes.join(', ')} appearance.`);
      const previous = state.theme;
      state.theme = theme;
      try { persist(); } catch (error) { state.theme = previous; throw error; }
      applyAppearance();
      return appearanceState();
    });
    const knowledgeRemote = 'Knowledge lookups contact Atlassian and the model in your Codex account.';
    handle('knowledge-connect', () => { assertRemoteAllowed(knowledgeRemote); return knowledge.connect(); });
    handle('knowledge-lookup', async input => {
      assertRemoteAllowed(knowledgeRemote);
      const result = await knowledge.lookup(input);
      sourceLinks.clear(); result.sources.forEach(source => sourceLinks.add(source.url)); evidenceCache.sources.forEach(source => sourceLinks.add(source.url));
      return result;
    });
    handle('evidence-lookup', async query => {
      assertRemoteAllowed(knowledgeRemote);
      if (typeof query !== 'string' || !query.trim()) throw new Error('Add a search topic, or write your prompt first.');
      const result = await knowledge.lookup({ message: query.slice(0, 12000), query: query.slice(0, 1000), draft: false });
      result.sources.forEach(source => sourceLinks.add(source.url));
      return { sources: evidenceCache.remember(result), warnings: result.warnings, query: result.query, searchedAt: result.searchedAt };
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
      try {
        assertAllowed(state.connection, state.localOnly);
        const evidence = evidenceCache.select(input?.evidence);
        const request = evidence.length ? { ...input, context: [typeof input.context === 'string' ? input.context.trim() : '', evidenceContext(evidence)].filter(Boolean).join('\n\n') } : input;
        const start = Date.now(); const result = await requestImprovement(request, state.connection, sessionKey, undefined, skillStore.all());
        if (evidence.length) result.evidence = evidenceSummaries(evidence); skillStore.recordUse(result.skillId); learn(result.action || 'improve'); coach.record(result.action || 'improve', input?.prompt || ''); maybeNudge(); return { ...result, durationMs: Date.now() - start }; }
      finally { busy = false; }
    });
    handle('local-ai-detect', endpoint => ollama.probe(typeof endpoint === 'string' && endpoint ? endpoint : state.connection.mode === 'ollama' ? state.connection.endpoint : ollama.DEFAULT_ENDPOINT));
    handle('local-ai-use', input => adoptLocalModel(input));
    async function adoptLocalModel(input) {
      if (busy) throw new Error('Wait for the current request to finish.');
      const connection = validateConnection({ mode: 'ollama', endpoint: input?.endpoint || ollama.DEFAULT_ENDPOINT, model: input?.model });
      const found = await ollama.probe(connection.endpoint);
      if (found.status !== 'ready') throw new Error(found.message);
      if (!found.models.some(model => model.name === connection.model)) throw new Error(`“${connection.model}” is not installed in Ollama. Choose one of the installed models.`);
      busy = true;
      try {
        const start = Date.now();
        await requestImprovement({ prompt: 'Write a friendly two-sentence invitation to a fictional book club.' }, connection, '');
        if (state.connection.mode !== 'ollama' || state.connection.endpoint !== connection.endpoint) sessionKey = '';
        state.connection = connection; state.localOnly = input.localOnly !== false;
        state.setup = { dismissed: state.setup.dismissed, completedAt: new Date().toISOString() };
        persist(); updateTray();
        return { durationMs: Date.now() - start, state: publicState() };
      } finally { busy = false; }
    }
    let installJob = null;
    const sendSetupProgress = progress => { if (win && !win.isDestroyed()) win.webContents.send('local-ai-progress', progress); };
    handle('local-ai-plan', async () => {
      const specs = installer.systemSpecs();
      const found = await ollama.probe(ollama.DEFAULT_ENDPOINT);
      return { specs, catalog: installer.recommend(specs), ollama: { path: installer.findOllama(), running: found.status !== 'not-running' && found.status !== 'error', status: found.status, models: found.models.map(m => m.name) }, platform: process.platform, installing: Boolean(installJob) };
    });
    handle('local-ai-release', () => installer.latestRelease());
    handle('local-ai-install', async ({ consent, model, localOnly } = {}) => {
      if (consent !== true) throw new Error('Agree to the downloads before setting up local AI.');
      if (installJob) throw new Error('Local AI setup is already running.');
      if (typeof model !== 'string' || !installer.MODEL.test(model.trim())) throw new Error('Choose a model to download.');
      const controller = new AbortController();
      installJob = controller;
      try {
        let found = await ollama.probe(ollama.DEFAULT_ENDPOINT);
        if (found.status === 'not-running' || found.status === 'error') {
          const existing = installer.findOllama();
          if (!existing) await installer.installOllama({ signal: controller.signal, onProgress: sendSetupProgress });
          else {
            sendSetupProgress({ stage: 'start', message: 'Starting the Ollama already on this computer…' });
            if (existing.endsWith('.app')) await new Promise((resolve, reject) => require('node:child_process').execFile('/usr/bin/open', ['-g', existing], error => error ? reject(error) : resolve()));
            else require('node:child_process').spawn(existing, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            await installer.waitForServer(ollama.DEFAULT_ENDPOINT);
          }
          found = await ollama.probe(ollama.DEFAULT_ENDPOINT);
          if (found.status === 'error' || found.status === 'not-running') throw new Error(found.message);
        }
        if (!found.models.some(m => m.name === model.trim())) {
          const specs = installer.systemSpecs();
          const known = installer.CATALOG.find(m => m.name === model.trim());
          if (known && specs.freeGB !== null && specs.freeGB < known.size * 1.2 + 2) throw new Error(`Not enough free disk space for ${known.name} (about ${Math.ceil(known.size * 1.2 + 2)} GB needed).`);
          await installer.pullModel(model, { signal: controller.signal, onProgress: sendSetupProgress });
        }
        sendSetupProgress({ stage: 'test', message: `Testing ${model} with a fictional sample prompt…` });
        const result = await adoptLocalModel({ model: model.trim(), localOnly: localOnly !== false }).catch(error => { throw /did not return|invalid suggestion|invalid explanation/i.test(error.message) ? new Error(`${model} downloaded, but it could not complete the test prompt, so it is probably too small for prompt help. Choose a larger model; you can remove this one later with “ollama rm ${model}”.`) : error; });
        sendSetupProgress({ stage: 'done', message: 'Local AI is ready.' });
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Setup was cancelled. Anything already installed stays; you can resume at any time.');
        throw error;
      } finally { installJob = null; }
    });
    handle('local-ai-cancel', () => { installJob?.abort(); return true; });
    const chatEndpoint = () => state.connection.mode === 'ollama' ? state.connection.endpoint : ollama.DEFAULT_ENDPOINT;
    const chatModel = value => { if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Choose a local model for this chat.'); return value.trim(); };
    handle('chat-list', () => chats.summaries());
    handle('chat-get', id => chats.get(id));
    const cloudModes = ['bedrock', 'openrouter', 'huggingface', 'compatible'];
    const cloudLabel = connection => ({ bedrock: `AWS Bedrock (${connection.region})`, openrouter: 'OpenRouter', huggingface: 'Hugging Face', compatible: (() => { try { return `Custom API (${new URL(connection.endpoint).host})`; } catch { return 'Custom API'; } })() }[connection.mode] || connection.mode);
    const cloudProblem = () => {
      if (!cloudModes.includes(state.connection.mode)) return 'Set up a cloud provider in Settings first.';
      try { assertAllowed(state.connection, state.localOnly); } catch (error) { return error.message; }
      if (['openrouter', 'huggingface'].includes(state.connection.mode) && !sessionKey) return 'Enter the API key in Settings. Keys are kept only until you quit.';
      return '';
    };
    handle('chat-providers', async () => {
      const found = await ollama.probe(chatEndpoint());
      const names = { bedrock: 'AWS Bedrock', openrouter: 'OpenRouter', huggingface: 'Hugging Face', compatible: 'Custom API' };
      return {
        local: found.status === 'ready' ? found.models.map(m => ({ model: m.name, label: `Local LLM · ${m.name}` })) : [],
        localMessage: found.status === 'ready' ? '' : found.message,
        cloud: cloudModes.map(mode => {
          const current = state.connection.mode === mode;
          const problem = current ? cloudProblem() : `Set up ${names[mode]} in Settings to use it here.`;
          return { mode, label: current ? `${cloudLabel(state.connection)} · ${state.connection.model}` : names[mode], available: !problem, reason: problem };
        }),
        localOnly: state.localOnly
      };
    });
    handle('chat-new', input => {
      if (input?.provider === 'cloud') {
        const problem = cloudProblem();
        if (problem) throw new Error(problem);
        return chats.create({ model: state.connection.model, provider: 'cloud', providerLabel: cloudLabel(state.connection), temporary: !state.chat.saveNewChats });
      }
      return chats.create({ model: chatModel(input?.model), temporary: !state.chat.saveNewChats });
    });
    handle('chat-send', async ({ chatId, text, model } = {}) => {
      if (typeof text !== 'string' || !text.trim() || text.length > chatLimits.message) throw new Error(`Write a message of 1–${chatLimits.message.toLocaleString()} characters.`);
      const chat = chats.get(chatId);
      if (chatReplies.has(chat.id)) throw new Error('Wait for the current reply, or stop it.');
      const cloud = chat.provider === 'cloud';
      if (cloud) { const problem = cloudProblem(); if (problem) throw new Error(`${problem} This chat uses ${chat.providerLabel || 'a cloud provider'}.`); model = state.connection.model; }
      else model = chatModel(model);
      const user = chats.append(chat.id, { role: 'user', content: text.trim() });
      const controller = new AbortController();
      chatReplies.set(chat.id, controller);
      if (!cloud && state.chat.model !== model) { state.chat = { ...state.chat, model }; persist(); }
      const start = Date.now(); let partial = '';
      try {
        const { text: reply, usage } = cloud ? await (async () => {
          const response = await complete(chats.context(chat.id), state.connection, sessionKey);
          if (controller.signal.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
          const text = String(response.content || '').trim();
          if (!text) throw new Error('The provider returned an empty reply. Try again.');
          if (win && !win.isDestroyed()) win.webContents.send('chat-delta', { chatId: chat.id, delta: text });
          return { text, usage: response.usage };
        })() : await streamChat({ endpoint: chatEndpoint(), model, messages: chats.context(chat.id), signal: controller.signal, onDelta: delta => { partial += delta; if (win && !win.isDestroyed()) win.webContents.send('chat-delta', { chatId: chat.id, delta }); } });
        const message = chats.append(chat.id, { role: 'assistant', content: reply, model, usage, durationMs: Date.now() - start });
        learn('chat'); coach.record('chat', text);
        maybeNudge(mascotLib.factCheckNudge(reply, chats.get(chat.id).messages.filter(m => m.role === 'user').map(m => m.content).join('\n')) || undefined);
        return { chat: chats.get(chat.id), message };
      } catch (error) {
        if (controller.signal.aborted) {
          if (partial.trim()) chats.append(chat.id, { role: 'assistant', content: partial, model, usage: null, durationMs: Date.now() - start, stopped: true });
          return { chat: chats.get(chat.id), stopped: true };
        }
        // Roll back so the user can retry without a duplicate message.
        chats.removeMessage(chat.id, user.id);
        throw error;
      } finally { chatReplies.delete(chat.id); }
    });
    handle('chat-stop', id => { chatReplies.get(id)?.abort(); return true; });
    handle('chat-delete', id => { if (chatReplies.has(id)) throw new Error('Stop the reply before deleting this chat.'); return chats.delete(id); });
    handle('chat-clear', () => { if (chatReplies.size) throw new Error('Stop the current reply first.'); return chats.clear(); });
    handle('chat-settings', input => { state.chat = { ...state.chat, saveNewChats: input?.saveNewChats !== false }; persist(); return publicState(); });
    handle('chat-export', async () => {
      const saved = chats.conversations.filter(c => !c.temporary);
      if (!saved.length) throw new Error('There are no saved chats to export.');
      const result = await dialog.showSaveDialog(win, { title: 'Export your saved chats', defaultPath: 'impromptu-chats.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return false;
      fs.writeFileSync(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), conversations: saved }, null, 2), { mode: 0o600 }); return true;
    });
    handle('skill-generate', async source => {
      if (busy) throw new Error('Wait for the current request to finish.');
      assertAllowed(state.connection, state.localOnly);
      busy = true;
      try { const start = Date.now(); return { ...await generateSkill(source, state.connection, sessionKey), durationMs: Date.now() - start }; }
      finally { busy = false; }
    });
    handle('skill-save', raw => { const skill = skillStore.save(raw); if (!raw.id) learn('skill'); return { skill, skills: skillStore.all() }; });
    handle('learning-state', () => learningState());
    handle('learning-mark', ({ id, done } = {}) => {
      const milestone = learning.MILESTONES.find(m => m.id === id);
      if (!milestone || milestone.auto) throw new Error('This milestone completes automatically from your work.');
      if (done) state.learning.manual[id] = new Date().toISOString(); else delete state.learning.manual[id];
      persist(); return learningState();
    });
    handle('benchmark-submit', answers => {
      const run = learning.scoreRun(answers);
      state.learning.runs = [run, ...state.learning.runs].slice(0, 20); persist();
      return { run, state: learningState() };
    });
    handle('learning-erase', () => { state.learning = { events: {}, manual: {}, runs: [] }; state.ranked = { joined: false, alias: '', joinedAt: '', board: [] }; persist(); return learningState(); });
    handle('ranked-join', ({ alias, consent } = {}) => {
      if (consent !== true) throw new Error('Confirm what is shared before joining ranked mode.');
      state.ranked = { ...state.ranked, joined: true, alias: learning.validAlias(alias), joinedAt: new Date().toISOString() }; persist(); return learningState();
    });
    handle('ranked-leave', ({ clearBoard } = {}) => { state.ranked = { joined: false, alias: '', joinedAt: '', board: clearBoard ? [] : state.ranked.board }; persist(); return learningState(); });
    handle('ranked-remove', alias => { state.ranked.board = state.ranked.board.filter(card => card.alias !== alias); persist(); return learningState(); });
    handle('ranked-export', async () => {
      if (!state.ranked.joined) throw new Error('Join ranked mode first.');
      const card = ownCard();
      if (!card) throw new Error(`Complete a benchmark attempt with all ${learning.TASKS.length} tasks answered, then export your card.`);
      const result = await dialog.showSaveDialog(win, { title: 'Export your score card', defaultPath: `impromptu-scorecard-${card.alias.replace(/[^\w.-]+/g, '-')}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return false;
      fs.writeFileSync(result.filePath, JSON.stringify(card, null, 2), { mode: 0o600 }); return true;
    });
    handle('ranked-import', async () => {
      if (!state.ranked.joined) throw new Error('Join ranked mode first.');
      const result = await dialog.showOpenDialog(win, { title: 'Import teammates’ score cards', properties: ['openFile', 'multiSelections'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return null;
      let added = 0, updated = 0; const skipped = [];
      for (const file of result.filePaths.slice(0, 50)) {
        try {
          if (fs.statSync(file).size > 100000) throw new Error('file is too large');
          const card = learning.validateScorecard(JSON.parse(fs.readFileSync(file, 'utf8')));
          if (card.alias.toLowerCase() === state.ranked.alias.toLowerCase()) throw new Error('this is your own name; your card is added automatically');
          const index = state.ranked.board.findIndex(item => item.alias.toLowerCase() === card.alias.toLowerCase());
          if (index === -1) { state.ranked.board.push({ ...card, importedAt: new Date().toISOString() }); added++; }
          else if (card.date > state.ranked.board[index].date) { state.ranked.board[index] = { ...card, importedAt: new Date().toISOString() }; updated++; }
          else skipped.push(`${card.alias}: already have this or a newer attempt`);
        } catch (error) { skipped.push(`${path.basename(file)}: ${error instanceof SyntaxError ? 'not valid JSON' : error.message}`); }
      }
      state.ranked.board = state.ranked.board.slice(0, 200); persist();
      return { added, updated, skipped, state: learningState() };
    });
    handle('open-reading', async url => { if (typeof url !== 'string' || !learning.readingAllowed(url)) throw new Error('Only links from the Learner track can be opened.'); await shell.openExternal(url); return true; });
    handle('skill-delete', id => { skillStore.delete(id); return skillStore.all(); });
    handle('skill-export', async () => {
      if (!skillStore.custom.length) throw new Error('Create a skill before exporting.');
      const result = await dialog.showSaveDialog(win, { title: 'Export your skills', defaultPath: 'impromptu-skills.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return false;
      fs.writeFileSync(result.filePath, JSON.stringify(skillStore.exportable(), null, 2), { mode: 0o600 }); return true;
    });
    handle('skill-import', async () => {
      const result = await dialog.showOpenDialog(win, { title: 'Import skills', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return null;
      const file = result.filePaths[0];
      if (fs.statSync(file).size > 1000000) throw new Error('This file is too large to be a skills export.');
      let data; try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('This file is not valid JSON.'); }
      return { ...skillStore.importSkills(data), skills: skillStore.all() };
    });
    const handleMascot = (name, handler) => ipcMain.handle(name, async (event, ...args) => {
      if (!mascotWin || event.sender !== mascotWin.webContents || event.senderFrame?.url !== mascotEntry) throw new Error('Untrusted mascot request.');
      return handler(...args);
    });
    handleMascot('mascot-state', () => mascotPublic());
    handleMascot('mascot-expand', open => { mascotWin?.setBounds(mascotBounds(open === true)); return true; });
    handleMascot('mascot-typing', typing => { if (!mascotWin) return false; mascotWin.setFocusable(typing === true); if (typing === true) mascotWin.focus(); return true; });
    handleMascot('mascot-action', async (name, payload) => { try { return await mascotAction(name, payload); } finally { pushMascot(); } });
    const mascotSettings = async () => {
      const found = await ollama.probe(state.connection.mode === 'ollama' ? state.connection.endpoint : ollama.DEFAULT_ENDPOINT);
      return { settings: state.mascot, permissions: mascotPermissions(), platform: process.platform, models: found.models.map(m => m.name), ollama: found.status, vision: state.mascot.enabled ? await refreshMascotVision() : await mascotVision() };
    };
    handle('mascot-settings', () => mascotSettings());
    handle('mascot-enable', async ({ consent } = {}) => {
      if (consent !== true) throw new Error('Confirm what the mascot can see before turning it on.');
      if (!['darwin', 'win32'].includes(process.platform)) throw new Error('The mascot is available on macOS and Windows.');
      state.mascot = { ...state.mascot, enabled: true, consentAt: new Date().toISOString() }; persist(); createMascot(); return mascotSettings();
    });
    handle('mascot-disable', () => { state.mascot = { ...state.mascot, enabled: false, consentAt: '' }; persist(); closeMascot(); mascotView.nudge = null; return mascotSettings(); });
    handle('mascot-update', input => { state.mascot = mascotLib.readSettings({ ...state.mascot, ...input, enabled: state.mascot.enabled, consentAt: state.mascot.consentAt }); persist(); refreshMascotVision(); pushMascot(); return mascotSettings(); });
    handle('mascot-permission', async kind => {
      if (process.platform !== 'darwin') return mascotSettings();
      if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
      else if (kind === 'screen') await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
      else throw new Error('Unknown permission.');
      await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture'}`);
      return mascotSettings();
    });
    handle('context-state', () => contextState());
    handle('context-get', id => packStore.get(id));
    handle('context-import-paste', ({ text, redactSecrets } = {}) => { const pack = packStore.add(text, { origin: 'paste', redactSecrets: redactSecrets !== false }); learn('pack'); return { pack, state: contextState() }; });
    handle('context-import-inbox', ({ name, redactSecrets } = {}) => {
      const text = contextLib.readInboxFile(inboxDir(), name);
      const pack = packStore.add(text, { origin: 'inbox', fileName: name, redactSecrets: redactSecrets !== false });
      try { contextLib.archiveInboxFile(inboxDir(), name); } catch {}
      learn('pack'); return { pack, state: contextState() };
    });
    handle('context-update', ({ id, text } = {}) => packStore.update(id, text));
    handle('context-delete', id => { packStore.delete(id); return contextState(); });
    handle('context-open-inbox', async () => { ensureInbox(); const error = await shell.openPath(inboxDir()); if (error) throw new Error(error); return contextState(); });
    handle('context-install-skill', tool => {
      const file = skillTargets()[tool];
      if (!file) throw new Error('Unknown tool.');
      ensureInbox();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contextLib.skillFile(inboxDir()), { mode: 0o644 });
      return contextState();
    });
    handle('context-remove-skill', tool => {
      const file = skillTargets()[tool];
      if (!file) throw new Error('Unknown tool.');
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('name: impromptu-handoff')) { fs.rmSync(file); try { fs.rmdirSync(path.dirname(file)); } catch {} }
      return contextState();
    });
    handle('context-export', async id => {
      const pack = packStore.get(id);
      const result = await dialog.showSaveDialog(win, { title: 'Export context pack', defaultPath: `${pack.title.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'context-pack'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled) return false;
      fs.writeFileSync(result.filePath, pack.text, { mode: 0o600 }); return true;
    });
    handle('setup-dismiss', () => { state.setup = { ...state.setup, dismissed: true }; persist(); return publicState(); });
    const helpLinks = { 'ollama-download': 'https://ollama.com/download', 'ollama-models': 'https://ollama.com/search' };
    handle('open-help', async id => {
      const model = typeof id === 'string' && id.startsWith('model:') ? installer.CATALOG.find(m => `model:${m.name}` === id) : null;
      if (model) { await shell.openExternal(`https://ollama.com/library/${model.name.split(':')[0]}`); return true; }
      if (!Object.hasOwn(helpLinks, id)) throw new Error('Unknown help link.'); await shell.openExternal(helpLinks[id]); return true;
    });
    handle('clipboard-read', async () => (await clipboard.readText()).slice(0, 30000));
    handle('clipboard-write', async value => { if (typeof value !== 'string' || value.length > 60000) throw new Error('Invalid clipboard text.'); await clipboard.writeText(value); return true; });
    let awsLoginPending = false;
    handle('aws-sso-login', async profile => {
      if (awsLoginPending) throw new Error('AWS sign-in is already open.');
      assertRemoteAllowed('AWS sign-in is only needed for Amazon Bedrock, a cloud provider.');
      awsLoginPending = true;
      try { return await require('./bedrock.cjs').signIn(profile); } finally { awsLoginPending = false; }
    });
    handle('test-connection', async input => {
      if (busy) throw new Error('Wait for the current request to finish.');
      const connection = assertAllowed(validateConnection(input), typeof input.localOnly === 'boolean' ? input.localOnly : state.localOnly);
      if (connection.mode === 'offline') throw new Error('Choose an AI provider to test.');
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 5000) throw new Error('Invalid API key.');
      const key = input.apiKey.trim() || (!input.clearKey && connection.mode === state.connection.mode && connection.endpoint === state.connection.endpoint ? sessionKey : '');
      busy = true;
      try {
        await requestImprovement({ prompt: 'Write a friendly two-sentence invitation to a fictional book club.' }, connection, key);
        return { message: 'Connected. The model returned a valid prompt improvement. Save settings to use it.' };
      } finally { busy = false; }
    });
    handle('save-settings', input => {
      const connection = assertAllowed(validateConnection(input), input.localOnly === true);
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 5000) throw new Error('Invalid API key.');
      // Keys never reach disk and cannot be silently reused with a different endpoint.
      if (connection.endpoint !== state.connection.endpoint || connection.mode !== state.connection.mode || input.clearKey) sessionKey = '';
      if (input.apiKey) sessionKey = input.apiKey.trim();
      state.connection = connection;
      state.importClipboard = input.importClipboard === true;
      state.localOnly = input.localOnly === true;
      persist(); updateTray(); return publicState();
    });
    handle('save-history', payload => {
      const input = normalizeInput(payload.input, skillStore.all());
      const result = payload.result;
      if (!result || typeof result.improved !== 'string' || result.improved.length > 60000 || !Array.isArray(result.changes) || !Array.isArray(result.questions)) throw new Error('Invalid saved suggestion.');
      const action = result.action === 'compress' ? 'compress' : 'improve';
      const record = { id: crypto.randomUUID(), date: new Date().toISOString(), action, input, result, feedback: null };
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
    if (state.mascot.enabled) createMascot();
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
app.on('before-quit', () => { quitting = true; try { inboxWatcher?.close(); } catch {} knowledge?.close(); for (const controller of chatReplies.values()) controller.abort(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
