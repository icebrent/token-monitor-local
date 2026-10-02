 'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('startup and expanded minimum share complete HUD dimensions; mini restores the minimum', () => {
  const handlers = new Map(); const options = [];
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  let minimum; let bounds;
  const electron = {
    app: { setName() {}, setPath() {}, getPath: () => path.join(__dirname, 'missing-settings-fixture'), whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle: (key, handler) => handlers.set(key, handler), on() {} },
    screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display },
    BrowserWindow: class {
      constructor(value) { options.push(value); bounds = { x: 8, y: 8, width: value.width, height: value.height }; this.webContents = {}; }
      setOpacity() {} loadFile() {} on() {} once() {}
      getBounds() { return bounds; }
      setMinimumSize(width, height) { minimum = [width, height]; }
      setSize(width, height) { Object.assign(bounds, { width, height }); }
      setBounds(value) { bounds = value; }
    }
  };
  const context = vm.createContext({ require: (name) => name === 'electron' ? electron
    : name === './codexAppServerClient' ? { CodexAppServerClient: class {} }
      : name === '../shared/officialUsage' ? { OfficialUsageStore: class {} }
        : name === './offlinePolicy' ? { lockWebContents() {} } : require(name),
    __dirname: path.join(__dirname, '../../src/electron'), process });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8'), context);
  vm.runInContext('createWindow(); registerIpc();', context);
  assert.deepEqual([options[0].width, options[0].height, options[0].minWidth, options[0].minHeight], [440, 690, 440, 690]);
  const event = { sender: vm.runInContext('mainWindow.webContents', context) };
  handlers.get('window:collapse')(event);
  assert.deepEqual(minimum, [248, 64]);
  assert.deepEqual([bounds.width, bounds.height], [248, 64]);
  handlers.get('window:expand')(event);
  assert.deepEqual(minimum, [440, 690]);
  assert.deepEqual([bounds.width, bounds.height], [440, 690]);
  display.workArea = { x: 0, y: 0, width: 400, height: 650 };
  handlers.get('window:expand')(event);
  assert.deepEqual(minimum, [384, 634]);
  assert.deepEqual([bounds.width, bounds.height], [384, 634]);
});

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
