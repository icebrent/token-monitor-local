'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } = require('electron');
const chokidar = require('chokidar');
const { collectCodexUsage, createCodexParseCache } = require('../shared/codexJsonlParser');
const { exportFileSet } = require('../shared/exporter');
const {
  assertLocalPath,
  canonicalizeExistingLocalPath,
  comparablePath,
  fixedCodexRoots
} = require('../shared/localPaths');
const { installOfflineSessionPolicy, lockWebContents } = require('./offlinePolicy');

const APP_NAME = 'Codex Offline Monitor';
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const RENDERER_HTML = path.join(__dirname, 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, 'preload.js');
const DEFAULT_BOUNDS = { width: 380, height: 680 };
const SETTINGS_KEYS = new Set(['alwaysOnTop', 'opacity', 'theme', 'exportDir']);
const SESSION_PARTITION = 'codex-offline-memory';

app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

let mainWindow = null;
let tray = null;
let watcher = null;
let refreshTimer = null;
let quitting = false;
let roots = null;
let latestStats = null;
const parseCache = createCodexParseCache();
const allowedOpenPaths = new Set();

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function defaultSettings() {
  return { alwaysOnTop: true, opacity: 0.94, theme: 'system', exportDir: '' };
}

function normalizeSettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    alwaysOnTop: input.alwaysOnTop !== false,
    opacity: Math.min(1, Math.max(0.55, Number(input.opacity) || 0.94)),
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
    exportDir: typeof input.exportDir === 'string' ? input.exportDir : ''
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

function registerAllowedOpenPath(target) {
  const canonical = canonicalizeExistingLocalPath(target, { label: 'Allowed local path' });
  allowedOpenPaths.add(comparablePath(canonical));
  return canonical;
}

async function openAllowedPath(target) {
  const canonical = canonicalizeExistingLocalPath(target, { label: 'Local path' });
  if (!allowedOpenPaths.has(comparablePath(canonical))) {
    throw new Error('Path is not in the main-process local allowlist');
  }
  const error = await shell.openPath(canonical);
  if (error) throw new Error(error);
}

function publicStats() {
  if (latestStats) return latestStats;
  return {
    collectedAt: '',
    periods: {},
    history: { daily: [], monthly: [], summary: {} },
    diagnostics: {},
    error: ''
  };
}

function collectNow() {
  try {
    const result = collectCodexUsage({
      sessionsRoot: roots.sessionsRoot,
      cache: parseCache,
      allTimeSince: '2024-01-01'
    });
    latestStats = {
      collectedAt: new Date().toISOString(),
      periods: result.periods,
      history: result.history,
      diagnostics: result.diagnostics,
      error: ''
    };
  } catch (error) {
    latestStats = {
      ...publicStats(),
      collectedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stats:changed', latestStats);
  }
  return latestStats;
}

function scheduleCollect() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(collectNow, 350);
}

function startWatcher() {
  watcher = chokidar.watch(roots.sessionsRoot, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  });
  watcher.on('add', scheduleCollect);
  watcher.on('change', scheduleCollect);
  watcher.on('unlink', scheduleCollect);
}

function applyWindowSettings(settings) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
  mainWindow.setOpacity(settings.opacity);
}

function createWindow() {
  const settings = readSettings();
  mainWindow = new BrowserWindow({
    ...DEFAULT_BOUNDS,
    minWidth: 320,
    minHeight: 480,
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
    { label: '显示 / 隐藏', click: () => toggleWindow() },
    { label: '刷新本地日志', click: () => collectNow() },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
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
  ipcMain.handle('stats:get', (event) => {
    requireMainSender(event);
    return publicStats();
  });
  ipcMain.handle('stats:refresh', (event) => {
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
      if (SETTINGS_KEYS.has(key) && key !== 'exportDir') accepted[key] = value;
    }
    const next = normalizeSettings({ ...current, ...accepted });
    writeSettings(next);
    applyWindowSettings(next);
    return next;
  });
  ipcMain.handle('export:chooseDirectory', async (event) => {
    requireMainSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地导出目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length !== 1) return '';
    const selected = canonicalizeExistingLocalPath(
      assertLocalPath(result.filePaths[0], process.platform, 'Export directory'),
      { label: 'Export directory' }
    );
    const next = normalizeSettings({ ...readSettings(), exportDir: selected });
    writeSettings(next);
    registerAllowedOpenPath(selected);
    return selected;
  });
  ipcMain.handle('export:write', (event) => {
    requireMainSender(event);
    const settings = readSettings();
    if (!settings.exportDir) throw new Error('请先选择导出目录');
    const exportDir = canonicalizeExistingLocalPath(settings.exportDir, { label: 'Export directory' });
    if (!allowedOpenPaths.has(comparablePath(exportDir))) {
      throw new Error('Export directory is not in the main-process local allowlist');
    }
    const generatedAt = new Date().toISOString();
    const files = exportFileSet({ ...publicStats(), generatedAt });
    const written = [];
    for (const [index, file] of files.entries()) {
      const target = path.join(exportDir, file.name);
      try {
        const targetStat = fs.lstatSync(target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
          throw new Error(`Refusing to replace non-regular export target: ${file.name}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const temporary = path.join(exportDir, `.codex-offline-${process.pid}-${index}.tmp`);
      fs.writeFileSync(temporary, file.contents, { encoding: 'utf8', flag: 'wx' });
      try {
        fs.renameSync(temporary, target);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch (_) {}
        throw error;
      }
      written.push(registerAllowedOpenPath(target));
    }
    registerAllowedOpenPath(exportDir);
    return { generatedAt, files: written.map((file) => path.basename(file)) };
  });
  ipcMain.handle('export:openDirectory', async (event) => {
    requireMainSender(event);
    const exportDir = readSettings().exportDir;
    if (!exportDir) throw new Error('尚未选择导出目录');
    await openAllowedPath(exportDir);
  });
  ipcMain.handle('export:openLatest', async (event) => {
    requireMainSender(event);
    const exportDir = readSettings().exportDir;
    const latest = path.join(exportDir, 'codex-offline-usage.json');
    await openAllowedPath(latest);
  });
  ipcMain.handle('app:openUserData', async (event) => {
    requireMainSender(event);
    await openAllowedPath(app.getPath('userData'));
  });
  ipcMain.handle('window:collapse', (event) => {
    requireMainSender(event);
    mainWindow.setSize(176, 64, true);
  });
  ipcMain.handle('window:expand', (event) => {
    requireMainSender(event);
    mainWindow.setSize(DEFAULT_BOUNDS.width, DEFAULT_BOUNDS.height, true);
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
  registerAllowedOpenPath(app.getPath('userData'));
  installOfflineSessionPolicy(session.defaultSession);
  installOfflineSessionPolicy(session.fromPartition(SESSION_PARTITION, { cache: false }));
  roots = fixedCodexRoots();
  const savedExportDir = readSettings().exportDir;
  if (savedExportDir) {
    try { registerAllowedOpenPath(savedExportDir); } catch (_) {}
  }
  registerIpc();
  createWindow();
  createTray();
  collectNow();
  startWatcher();
});

app.on('before-quit', () => {
  quitting = true;
  clearTimeout(refreshTimer);
  watcher?.close();
});

app.on('window-all-closed', (event) => event.preventDefault());
