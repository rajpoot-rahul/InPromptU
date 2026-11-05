'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mascot', {
  state: () => ipcRenderer.invoke('mascot-state'),
  action: (name, payload) => ipcRenderer.invoke('mascot-action', name, payload),
  expand: open => ipcRenderer.invoke('mascot-expand', open),
  typing: value => ipcRenderer.invoke('mascot-typing', value),
  onUpdate: callback => ipcRenderer.on('mascot-update', (_event, data) => callback(data))
});
