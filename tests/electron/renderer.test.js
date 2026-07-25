'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'src/electron/renderer/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'src/electron/renderer/app.js'), 'utf8');
const analysisScript = fs.readFileSync(path.join(root, 'src/electron/renderer/analysis.js'), 'utf8');
const modelRowsScript = fs.readFileSync(path.join(root, 'src/electron/renderer/modelRows.js'), 'utf8');
const tokenTransitionScript = fs.readFileSync(path.join(root, 'src/electron/renderer/tokenTransition.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/electron/renderer/styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/electron/preload.js'), 'utf8');
const modelRowsContext = { window: {} };
vm.runInNewContext(modelRowsScript, modelRowsContext);
const tokenTransitionContext = { window: {} };
vm.runInNewContext(tokenTransitionScript, tokenTransitionContext);
const analysisContext = { window: {} };
vm.runInNewContext(analysisScript, analysisContext);

test('renderer exposes only local stats, settings, export, app, and window surfaces', () => {
  assert.match(preload, /exposeInMainWorld\('codexOffline'/);
  for (const forbidden of ['credential', 'account', 'provider', 'sync', 'appupdate', 'discord', 'openexternal']) {
    assert.doesNotMatch(preload.toLowerCase(), new RegExp(forbidden));
  }
});

test('local UI keeps overview periods, analysis views, tray hide, floating collapse, and export controls', () => {
  for (const marker of [
    'id="view-select"',
    '<option value="overview">总览</option>',
    '<option value="analysis">分析</option>',
    'data-period="today"',
    'data-period="month"',
    'data-period="allTime"',
    'data-analysis="overview"',
    'data-analysis="models"',
    'data-analysis="projects"',
    'data-analysis="dates"',
    'id="collapse"',
    'class="compact-drag-region"',
    'id="expand"',
    'id="hide"',
    'id="export-now"',
    'id="settings-trigger"',
    'id="settings-sheet"',
    'id="settings-backdrop"'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(script, /api\.exports\.write/);
  assert.match(script, /api\.window\.collapse/);
  assert.match(script, /api\.window\.expand/);
  assert.doesNotMatch(html, /data-period="trends"|data-range=/);
  assert.doesNotMatch(html, /<details/);
});

test('analysis reuses the original heatmap and sparkline algorithms', () => {
  const api = analysisContext.window.codexAnalysis;
  const intensities = api.computeHeatmapIntensities([
    { date: '2026-07-21', tokens: 0 },
    { date: '2026-07-22', tokens: 1 },
    { date: '2026-07-23', tokens: 25 },
    { date: '2026-07-24', tokens: 50 },
    { date: '2026-07-25', tokens: 100 }
  ]);
  assert.equal(JSON.stringify(intensities.map((day) => day.tokenIntensity)), '[0,1,2,3,4]');

  const heatmap = api.rollingYearHeatmap(intensities, { endDate: '2026-07-25' });
  assert.equal(heatmap.cells[0].date, '2025-07-27');
  assert.equal(heatmap.cells.at(-1).date, '2026-07-25');
  assert.ok(heatmap.monthLabels.some((month) => month.label === '2025-08'));

  const sparkline = api.sparklinePreview([{ tokens: 10 }, { tokens: 20 }], {
    width: 120,
    height: 28
  });
  assert.equal(sparkline.maxVal, 20);
  assert.equal(sparkline.bars[0].height, 14);
  assert.equal(sparkline.bars[1].height, 28);
  assert.equal(sparkline.bars[1].last, true);
});

test('full window opens at the readable default size with the current product heading', () => {
  assert.match(main, /const DEFAULT_BOUNDS = \{ width: 450, height: 1100 \}/);
  assert.match(main, /const NORMAL_MINIMUM_SIZE = \{ \.\.\.DEFAULT_BOUNDS \}/);
  assert.match(html, /<h1>Codex Token Monitor<\/h1>/);
  assert.doesNotMatch(html, /仅本机日志/);
});

test('floating mode keeps a drag region and resets to the full window size', () => {
  assert.match(main, /const COMPACT_SIZE = \{ width: 208, height: 64 \}/);
  assert.match(styles, /\.compact-drag-region[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(styles, /\.compact-expand[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(main, /expandedPosition\s*=\s*\{ x, y \}/);
  assert.match(main, /mainWindow\.setBounds\(\{ \.\.\.DEFAULT_BOUNDS, \.\.\.expandedPosition \},\s*true\)/);
  assert.match(main, /mainWindow\.setMinimumSize\(COMPACT_SIZE\.width,\s*COMPACT_SIZE\.height\)/);
  assert.match(main, /mainWindow\.setMinimumSize\(NORMAL_MINIMUM_SIZE\.width,\s*NORMAL_MINIMUM_SIZE\.height\)/);
});

test('model rows show six models directly and aggregate overflow into the sixth row', () => {
  const modelRows = modelRowsContext.window.codexModelRows;
  const six = modelRows.from({ a: 60, b: 50, c: 40, d: 30, e: 20, f: 10 });
  assert.equal(JSON.stringify(six), JSON.stringify([
    ['a', 60], ['b', 50], ['c', 40], ['d', 30], ['e', 20], ['f', 10]
  ]));
  const seven = modelRows.from({ a: 70, b: 60, c: 50, d: 40, e: 30, f: 20, g: 10 });
  assert.equal(JSON.stringify(seven), JSON.stringify([
    ['a', 70], ['b', 60], ['c', 50], ['d', 40], ['e', 30], ['其他', 30]
  ]));
});

test('total token transitions expose only positive increments', () => {
  const transition = tokenTransitionContext.window.codexTokenTransition;
  assert.equal(JSON.stringify(transition.positiveDelta(12000, 12860)), JSON.stringify({
    from: 12000,
    to: 12860,
    delta: 860
  }));
  assert.equal(transition.positiveDelta(12860, 12860), null);
  assert.equal(transition.positiveDelta(12860, 100), null);
  assert.equal(transition.positiveDelta(undefined, 100), null);
  assert.equal(JSON.stringify(transition.merge(
    transition.positiveDelta(12000, 12400),
    transition.positiveDelta(12400, 12860)
  )), JSON.stringify({
    from: 12000,
    to: 12860,
    delta: 860
  }));
});

test('total token increments coalesce before animating in full and compact modes', () => {
  assert.match(html, /id="total-delta"/);
  assert.match(html, /src="\.\/tokenTransition\.js"/);
  assert.match(script, /tokenTransition\.positiveDelta/);
  assert.match(script, /const TOTAL_COALESCE_MS = 1200/);
  assert.match(script, /tokenTransition\.merge/);
  assert.match(script, /prefers-reduced-motion:\s*reduce/);
  assert.match(script, /compact-total/);
  assert.match(styles, /\.total-delta\.is-visible/);
});

test('settings use a bottom sheet with modal dismissal controls', () => {
  assert.match(html, /id="settings-trigger"[\s\S]*aria-expanded="false"/);
  assert.match(html, /id="settings-sheet"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(styles, /\.settings-sheet[\s\S]*bottom:\s*8px/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /child\.inert = open/);
});

test('renderer does not contain network APIs or remote URLs', () => {
  const source = `${html}\n${script}\n${analysisScript}\n${modelRowsScript}`;
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\/|wss?:\/\//i);
});
