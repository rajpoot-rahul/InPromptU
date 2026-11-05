'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Seed the saved appearance before the first visible frame; bootstrap remains authoritative.
window.addEventListener('DOMContentLoaded', () => {
  const argument = name => process.argv.find(value => value.startsWith(`--impromptu-${name}=`))?.split('=')[1];
  const theme = argument('theme');
  if (['system', 'light', 'dark', 'glass', 'max-ind'].includes(theme)) document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.reducedTransparency = String(argument('reduced-transparency') === 'true');
}, { once: true });
contextBridge.exposeInMainWorld('impromptu', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  setTheme: theme => ipcRenderer.invoke('set-theme', theme),
  analyze: input => ipcRenderer.invoke('analyze', input),
  improve: input => ipcRenderer.invoke('improve', input),
  connectKnowledge: () => ipcRenderer.invoke('knowledge-connect'),
  lookupKnowledge: input => ipcRenderer.invoke('knowledge-lookup', input),
  openSource: url => ipcRenderer.invoke('knowledge-source', url),
  disconnectKnowledge: () => ipcRenderer.invoke('knowledge-disconnect'),
  locateCodex: () => ipcRenderer.invoke('knowledge-locate'),
  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  copy: text => ipcRenderer.invoke('clipboard-write', text),
  awsSignIn: profile => ipcRenderer.invoke('aws-sso-login', profile),
  testConnection: settings => ipcRenderer.invoke('test-connection', settings),
  saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  saveHistory: session => ipcRenderer.invoke('save-history', session),
  feedback: input => ipcRenderer.invoke('feedback', input),
  deleteHistory: id => ipcRenderer.invoke('delete-history', id),
  exportHistory: () => ipcRenderer.invoke('export-history'),
  hide: () => ipcRenderer.invoke('hide'),
  quit: () => ipcRenderer.invoke('quit'),
  onInvoke: callback => ipcRenderer.on('clipboard-invoked', (_event, text) => callback(text)),
  onSettings: callback => ipcRenderer.on('settings-changed', (_event, data) => callback(data)),
  onAppearance: callback => ipcRenderer.on('appearance-changed', (_event, data) => callback(data)),
  onNotice: callback => ipcRenderer.on('desktop-notice', (_event, message) => callback(message)),
  onKnowledgeProgress: callback => ipcRenderer.on('knowledge-progress', (_event, message) => callback(message))
});
