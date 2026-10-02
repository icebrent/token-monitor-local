'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, Tray } = require('electron');
const { CodexAppServerClient } = require('./codexAppServerClient');
const { OfficialUsageStore } = require('../shared/officialUsage');
const { installOfflineSessionPolicy, lockWebContents } = require('./offlinePolicy');

const APP_NAME = 'Codex Offline Monitor';
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const RENDERER_HTML = path.join(__dirname, 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, 'preload.js');
const PREFERRED_BOUNDS = { width: 450, height: 660 };
const NORMAL_MINIMUM_SIZE = { width: 320, height: 480 };
const WORK_AREA_MARGIN = 8;
const COMPACT_SIZE = { width: 248, height: 64 };
const SETTINGS_KEYS = new Set(['alwaysOnTop', 'opacity', 'theme', 'refreshIntervalSec']);
const SESSION_PARTITION = 'codex-offline-memory';

app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

let mainWindow = null;
let tray = null;
const officialClient = new CodexAppServerClient();
const officialStore = new OfficialUsageStore(officialClient);
let refreshTimer = null;
let quitting = false;
let latestStats = null;
let compactMode = false;
let expandedPosition = null;



function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function defaultSettings() {
  return { alwaysOnTop: true, opacity: 0.94, theme: 'system', refreshIntervalSec: 300 };
}

function normalizeSettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    alwaysOnTop: input.alwaysOnTop !== false,
    opacity: Math.min(1, Math.max(0.55, Number(input.opacity) || 0.94)),
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
    refreshIntervalSec: [0, 60, 300, 900].includes(input.refreshIntervalSec) ? input.refreshIntervalSec : 300
  };
}

function readSettings() {
  try {
    const file = settingsPath();
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return defaultSettings();
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    return defaultSettings();
  }
}

function writeSettings(settings) {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const temporary = path.join(userData, `settings-${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporary, settingsPath());
}

function publicStats() { return { ...officialStore.snapshot, refreshIntervalSec: readSettings().refreshIntervalSec }; }

function scheduleRefresh(settings) {
  clearInterval(refreshTimer);
  refreshTimer = settings.refreshIntervalSec ? setInterval(collectNow, settings.refreshIntervalSec * 1000) : null;
}

async function collectNow({ onShow = false } = {}) {
  await (onShow ? officialStore.refreshOnShow() : officialStore.refresh());
  latestStats = publicStats();
  if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stats:changed', latestStats);
  }
  return latestStats;
}

function applyWindowSettings(settings) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
  mainWindow.setOpacity(settings.opacity);
}

function normalBoundsForDisplay(display, position = null) {
  const workArea = display.workArea;
  const availableWidth = Math.max(1, workArea.width - WORK_AREA_MARGIN * 2);
  const availableHeight = Math.max(1, workArea.height - WORK_AREA_MARGIN * 2);
  const width = Math.min(PREFERRED_BOUNDS.width, availableWidth);
  const height = Math.min(PREFERRED_BOUNDS.height, availableHeight);
  const bounds = { width, height };
  if (position) {
    bounds.x = Math.min(
      Math.max(position.x, workArea.x + WORK_AREA_MARGIN),
      workArea.x + workArea.width - width - WORK_AREA_MARGIN
    );
    bounds.y = Math.min(
      Math.max(position.y, workArea.y + WORK_AREA_MARGIN),
      workArea.y + workArea.height - height - WORK_AREA_MARGIN
    );
  }
  return bounds;
}

function normalMinimumSize(bounds) {
  return {
    width: Math.min(NORMAL_MINIMUM_SIZE.width, bounds.width),
    height: Math.min(NORMAL_MINIMUM_SIZE.height, bounds.height)
  };
}

function createWindow() {
  const settings = readSettings();
  const initialBounds = normalBoundsForDisplay(screen.getPrimaryDisplay());
  const initialMinimum = normalMinimumSize(initialBounds);
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: initialMinimum.width,
    minHeight: initialMinimum.height,
    show: false,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: '#00000000',
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: SESSION_PARTITION,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
      navigateOnDragDrop: false
    }
  });
  lockWebContents(mainWindow.webContents, RENDERER_HTML);
  mainWindow.setOpacity(settings.opacity);
  mainWindow.loadFile(RENDERER_HTML);
  mainWindow.on('show', () => collectNow({ onShow: true }));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const image = nativeImage.createFromPath(APP_ICON).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { label: 'Refresh Official Usage', click: () => collectNow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', toggleWindow);
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function requireMainSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('IPC sender is not the application window');
  }
}

function registerIpc() {
  ipcMain.handle('usage:getOfficial', (event) => {
    requireMainSender(event);
    return publicStats();
  });
  ipcMain.handle('usage:refreshOfficial', (event) => {
    requireMainSender(event);
    return collectNow();
  });
  ipcMain.handle('settings:get', (event) => {
    requireMainSender(event);
    return readSettings();
  });
  ipcMain.handle('settings:update', (event, patch) => {
    requireMainSender(event);
    const current = readSettings();
    const accepted = {};
    for (const [key, value] of Object.entries(patch || {})) {
      if (SETTINGS_KEYS.has(key)) accepted[key] = value;
    }
    const next = normalizeSettings({ ...current, ...accepted });
    writeSettings(next);
    applyWindowSettings(next);
    scheduleRefresh(next);
    return next;
  });
  ipcMain.handle('window:collapse', (event) => {
    requireMainSender(event);
    if (!compactMode) {
      const { x, y } = mainWindow.getBounds();
      expandedPosition = { x, y };
    }
    compactMode = true;
    mainWindow.setMinimumSize(COMPACT_SIZE.width, COMPACT_SIZE.height);
    mainWindow.setSize(COMPACT_SIZE.width, COMPACT_SIZE.height, true);
  });
  ipcMain.handle('window:expand', (event) => {
    requireMainSender(event);
    const targetPoint = expandedPosition || mainWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: targetPoint.x, y: targetPoint.y });
    const bounds = normalBoundsForDisplay(display, expandedPosition);
    const minimum = normalMinimumSize(bounds);
    mainWindow.setBounds(bounds, true);
    mainWindow.setMinimumSize(minimum.width, minimum.height);
    compactMode = false;
  });
  ipcMain.on('window:minimize', (event) => {
    requireMainSender(event);
    mainWindow.minimize();
  });
  ipcMain.on('window:hide', (event) => {
    requireMainSender(event);
    mainWindow.hide();
  });
}

app.whenReady().then(() => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  installOfflineSessionPolicy(session.defaultSession);
  installOfflineSessionPolicy(session.fromPartition(SESSION_PARTITION, { cache: false }));

  registerIpc();
  createWindow();
  createTray();
  collectNow();
  scheduleRefresh(readSettings());
});

app.on('before-quit', () => {
  quitting = true;
  clearInterval(refreshTimer);
  officialClient.close();
});

app.on('window-all-closed', (event) => event.preventDefault());
