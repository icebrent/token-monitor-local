'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexOffline', {
  stats: {
    get: () => ipcRenderer.invoke('stats:get'),
    refresh: () => ipcRenderer.invoke('stats:refresh'),
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
  exports: {
    chooseDirectory: () => ipcRenderer.invoke('export:chooseDirectory'),
    write: () => ipcRenderer.invoke('export:write'),
    openDirectory: () => ipcRenderer.invoke('export:openDirectory'),
    openLatest: () => ipcRenderer.invoke('export:openLatest')
  },
  app: {
    openUserData: () => ipcRenderer.invoke('app:openUserData')
  },
  window: {
    collapse: () => ipcRenderer.invoke('window:collapse'),
    expand: () => ipcRenderer.invoke('window:expand'),
    minimize: () => ipcRenderer.send('window:minimize'),
    hide: () => ipcRenderer.send('window:hide')
  }
});
