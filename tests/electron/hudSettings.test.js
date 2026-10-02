 'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('settings IPC applies pin/opacity and schedules validated refresh intervals, including Manual', () => {
  const handlers = new Map(); const timers = []; const clears = []; const windowCalls = [];
  let saved; let pending;
  const mockFs = { lstatSync() { if (!saved) throw new Error('missing'); return { isFile: () => true, isSymbolicLink: () => false }; },
    readFileSync: () => saved, mkdirSync() {}, writeFileSync: (_, text) => { pending = text; }, renameSync: () => { saved = pending; } };
  const electron = { app: { setName() {}, setPath() {}, getPath: () => 'C:/test', whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle: (key, handler) => handlers.set(key, handler), on() {} } };
  const context = vm.createContext({ require: (name) => name === 'electron' ? electron : name === 'node:fs' ? mockFs
    : name === './codexAppServerClient' ? { CodexAppServerClient: class {} }
      : name === '../shared/officialUsage' ? { OfficialUsageStore: class {} }
        : name === './offlinePolicy' ? {} : require(name), __dirname: path.join(__dirname, '../../src/electron'), process,
    setInterval: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearInterval: (timer) => clears.push(timer) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8'), context);
  context.testWindow = { webContents: {}, isDestroyed: () => false, setAlwaysOnTop: (value) => windowCalls.push(['pin', value]), setOpacity: (value) => windowCalls.push(['opacity', value]) };
  vm.runInContext('mainWindow = testWindow; registerIpc(); scheduleRefresh(readSettings());', context);
  assert.equal(timers.at(-1).ms, 300000);
  const update = handlers.get('settings:update'); const event = { sender: context.testWindow.webContents };
  const manual = update(event, { refreshIntervalSec: 0, alwaysOnTop: false, opacity: 0.9, exportDir: 'C:/ignored' });
  assert.equal(manual.refreshIntervalSec, 0); assert.equal(timers.length, 1); assert.ok(clears.length > 0);
  assert.equal(manual.exportDir, undefined); assert.deepEqual(windowCalls.slice(-2), [['pin', false], ['opacity', 0.9]]);
  update(event, { refreshIntervalSec: 900 }); assert.equal(timers.at(-1).ms, 900000);
  update(event, { refreshIntervalSec: 60 }); assert.equal(timers.at(-1).ms, 60000);
  update(event, { refreshIntervalSec: 2 }); assert.equal(timers.at(-1).ms, 300000);
  assert.throws(() => update({ sender: {} }, { theme: 'dark' }), /IPC sender/);
  assert.ok([...handlers.keys()].every((key) => !/export|openUserData/.test(key)));
});
