'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('minimize and Show / Hide use tray; quit button and native close exit the app', async () => {
  const events = new Map(); const ipc = new Map(); const calls = [];
  let window; let visible = true; let minimized = false; let ready;
  const electron = {
    app: { setName() {}, setAppUserModelId() {}, setPath() {}, getPath: () => 'missing-settings', whenReady: () => ({ then: (fn) => { ready = fn; } }), on() {}, quit() { calls.push(['quit']); } },
    ipcMain: { handle() {}, on: (name, fn) => ipc.set(name, fn) },
    session: { defaultSession: {}, fromPartition: () => ({}) },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeImage: { createFromPath: () => ({ resize: () => 'portrait' }) },
    Menu: { buildFromTemplate: (items) => items },
    Tray: class {
      setToolTip() {} setContextMenu(items) { this.menu = items; } on() {}
    },
    BrowserWindow: class {
      constructor() { window = this; this.webContents = { send() {} }; }
      setOpacity() {} loadFile() {} once() {} isDestroyed() { return false; }
      on(name, fn) { events.set(name, fn); }
      isVisible() { return visible; } isMinimized() { return minimized; }
      setSkipTaskbar(value) { calls.push(['skipTaskbar', value]); }
      hide() { visible = false; calls.push(['hide']); events.get('hide')(); }
      show() { visible = true; calls.push(['show']); events.get('show')(); }
      restore() { minimized = false; calls.push(['restore']); }
      focus() { calls.push(['focus']); }
    }
  };
  const snapshot = { limits: [], errors: {} };
  const context = vm.createContext({ __dirname: path.join(__dirname, '../../src/electron'), process,
    setInterval: () => 1, clearInterval() {},
    require: (name) => name === 'electron' ? electron : name === 'node:fs' ? { mkdirSync() {}, lstatSync() { throw Error('missing'); } }
      : name === './codexAppServerClient' ? { CodexAppServerClient: class {} }
        : name === '../shared/officialUsage' ? { OfficialUsageStore: class { constructor() { this.snapshot = snapshot; } async refresh() {} async refreshOnShow() {} } }
          : name === './offlinePolicy' ? { lockWebContents() {}, installOfflineSessionPolicy() {} }
            : name === './trayQuota' ? { createTrayQuota: () => ({ update: (_tray, _snapshot, hidden) => calls.push(['quota', hidden]) }) }
              : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8'), context);
  ready(); await new Promise(setImmediate); calls.length = 0;
  ipc.get('window:minimize')({ sender: window.webContents });
  assert.equal(visible, false);
  assert.deepEqual(calls[0], ['skipTaskbar', true]);
  assert.deepEqual(calls.at(-1), ['quota', true]);
  assert.throws(() => ipc.get('window:minimize')({ sender: {} }), /IPC sender/);
  vm.runInContext("tray.menu.find(item => item.label === 'Show / Hide').click()", context);
  await new Promise(setImmediate);
  assert.equal(visible, true);
  assert.ok(calls.some((call) => call[0] === 'skipTaskbar' && call[1] === false));
  assert.deepEqual(calls.at(-1), ['quota', false]);
  calls.length = 0;
  vm.runInContext("tray.menu.find(item => item.label === 'Show / Hide').click()", context);
  assert.equal(visible, false);
  assert.deepEqual(calls.at(-1), ['quota', true]);
  visible = true; minimized = true;
  events.get('minimize')();
  assert.equal(visible, false);
  vm.runInContext('toggleWindow()', context);
  assert.equal(minimized, false); assert.equal(visible, true);
  assert.throws(() => ipc.get('window:quit')({ sender: {} }), /IPC sender/);
  events.get('close')();
  assert.equal(visible, true);
  assert.deepEqual(calls.at(-1), ['quit']);
  const closeCount = calls.filter((call) => call[0] === 'quit').length;
  events.get('close')();
  assert.equal(calls.filter((call) => call[0] === 'quit').length, closeCount);
  ipc.get('window:quit')({ sender: window.webContents });
  assert.deepEqual(calls.at(-1), ['quit']);
});
