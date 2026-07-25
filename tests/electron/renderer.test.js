'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'src/electron/renderer/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'src/electron/renderer/app.js'), 'utf8');
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
    'id="hide"',
    'id="export-now"'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(script, /api\.exports\.write/);
  assert.match(script, /api\.window\.collapse/);
});

test('renderer does not contain network APIs or remote URLs', () => {
  const source = `${html}\n${script}`;
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\/|wss?:\/\//i);
});
