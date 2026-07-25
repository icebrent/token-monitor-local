'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'src/electron/renderer/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'src/electron/renderer/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/electron/renderer/styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/electron/preload.js'), 'utf8');

test('renderer exposes only local stats, settings, export, app, and window surfaces', () => {
  assert.match(preload, /exposeInMainWorld\('codexOffline'/);
  for (const forbidden of ['credential', 'account', 'provider', 'sync', 'appupdate', 'discord', 'openexternal']) {
    assert.doesNotMatch(preload.toLowerCase(), new RegExp(forbidden));
  }
});

test('local UI keeps periods, trends, tray hide, floating collapse, and export controls', () => {
  for (const marker of [
    'data-period="today"',
    'data-period="month"',
    'data-period="allTime"',
    'data-period="trends"',
    'id="collapse"',
    'class="compact-drag-region"',
    'id="expand"',
    'id="hide"',
    'id="export-now"'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(script, /api\.exports\.write/);
  assert.match(script, /api\.window\.collapse/);
  assert.match(script, /api\.window\.expand/);
});

test('floating mode keeps a drag region and restores the previous expanded bounds', () => {
  assert.match(styles, /\.compact-drag-region[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(styles, /\.compact-expand[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(main, /expandedBounds\s*=\s*mainWindow\.getBounds\(\)/);
  assert.match(main, /mainWindow\.setBounds\(expandedBounds,\s*true\)/);
  assert.match(main, /mainWindow\.setMinimumSize\(COMPACT_SIZE\.width,\s*COMPACT_SIZE\.height\)/);
  assert.match(main, /mainWindow\.setMinimumSize\(NORMAL_MINIMUM_SIZE\.width,\s*NORMAL_MINIMUM_SIZE\.height\)/);
});

test('renderer does not contain network APIs or remote URLs', () => {
  const source = `${html}\n${script}`;
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\/|wss?:\/\//i);
});
