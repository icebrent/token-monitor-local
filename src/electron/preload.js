'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexOffline', {
  stats: {
    get: () => ipcRenderer.invoke('usage:getOfficial'),
    refresh: () => ipcRenderer.invoke('usage:refreshOfficial'),
    onChanged: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('stats:changed', listener);
      return () => ipcRenderer.removeListener('stats:changed', listener);
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch)
  },
  window: {
    collapse: () => ipcRenderer.invoke('window:collapse'),
    expand: () => ipcRenderer.invoke('window:expand'),
    minimize: () => ipcRenderer.send('window:minimize'),
    hide: () => ipcRenderer.send('window:hide')
  }
});
