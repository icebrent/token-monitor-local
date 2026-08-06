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
const sessionRowsScript = fs.readFileSync(path.join(root, 'src/electron/renderer/sessionRows.js'), 'utf8');
const tokenTransitionScript = fs.readFileSync(path.join(root, 'src/electron/renderer/tokenTransition.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/electron/renderer/styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/electron/preload.js'), 'utf8');
const modelRowsContext = { window: {} };
vm.runInNewContext(modelRowsScript, modelRowsContext);
const sessionRowsContext = { window: {} };
vm.runInNewContext(sessionRowsScript, sessionRowsContext);
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
    '<option value="overview">Overview</option>',
    '<option value="analysis">Analytics</option>',
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
    'id="refresh"',
    'id="export-now"',
    'id="settings-trigger"',
    'id="settings-sheet"',
    'id="settings-backdrop"'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(script, /api\.exports\.write/);
  assert.match(script, /api\.window\.collapse/);
  assert.match(script, /api\.window\.expand/);
  assert.match(html, /id="view-select" aria-label="Primary view"/);
  assert.doesNotMatch(html, /id="trend-chart"/);
  assert.match(styles, /\.view-selector option\s*\{[\s\S]*background:\s*var\(--control-bg\)/);
  assert.doesNotMatch(html, /data-period="trends"|data-range=/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /<footer/);
  assert.match(html, /<header class="titlebar">[\s\S]*id="refresh"[\s\S]*<\/header>/);
});

test('analysis uses a six-calendar-month heatmap and preserves sparkline behavior', () => {
  const api = analysisContext.window.codexAnalysis;
  const intensities = api.computeHeatmapIntensities([
    { date: '2026-07-21', tokens: 0 },
    { date: '2026-07-22', tokens: 1 },
    { date: '2026-07-23', tokens: 25 },
    { date: '2026-07-24', tokens: 50 },
    { date: '2026-07-25', tokens: 100 }
  ]);
  assert.equal(JSON.stringify(intensities.map((day) => day.tokenIntensity)), '[0,1,2,3,4]');

  const heatmap = api.rollingSixMonthHeatmap([
    { date: '2026-01-31', tokens: 10000 },
    { date: '2026-02-01', tokens: 100 },
    ...intensities
  ], { endDate: '2026-07-25' });
  assert.equal(heatmap.cells[0].date, '2026-02-01');
  assert.equal(heatmap.cells.at(-1).date, '2026-07-25');
  assert.equal(heatmap.cells.find((cell) => cell.date === '2026-02-01').intensity, 4);
  assert.ok(heatmap.monthLabels.some((month) => month.label === '2026-02'));
  assert.ok(heatmap.width < 400);
  assert.equal(heatmap.cell, 10);
  assert.equal(heatmap.gap, 4);

  const sparkline = api.sparklinePreview([{ tokens: 10 }, { tokens: 20 }], {
    width: 120,
    height: 28
  });
  assert.equal(sparkline.maxVal, 20);
  assert.equal(sparkline.bars[0].height, 14);
  assert.equal(sparkline.bars[1].height, 28);
  assert.equal(sparkline.bars[1].last, true);
});

test('full window uses a screen-aware preferred height with one compact product heading', () => {
  assert.match(main, /const PREFERRED_BOUNDS = \{ width: 450, height: 900 \}/);
  assert.match(main, /const NORMAL_MINIMUM_SIZE = \{ \.\.\.PREFERRED_BOUNDS \}/);
  assert.match(main, /normalBoundsForDisplay\(screen\.getPrimaryDisplay\(\)\)/);
  assert.match(main, /Math\.min\(PREFERRED_BOUNDS\.height, availableHeight\)/);
  assert.equal((html.match(/Codex Token Monitor/g) || []).length, 1);
  assert.match(html, /<h1 class="titlebar-title">[\s\S]*Codex Token Monitor<\/h1>/);
  assert.match(styles, /\.view-controls\s*\{\s*margin:\s*12px 0 10px/);
  assert.match(styles, /\.hero\s*\{\s*padding:\s*9px 2px 11px/);
  assert.match(styles, /\.panel\s*\{\s*margin-top:\s*7px;\s*padding:\s*12px/);
  assert.match(styles, /\.panel-title\s*\{[^}]*margin-bottom:\s*9px/);
});

test('floating mode keeps a drag region and resets to the full window size', () => {
  assert.match(main, /const COMPACT_SIZE = \{ width: 208, height: 64 \}/);
  assert.match(styles, /\.compact-drag-region[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(styles, /\.compact-expand[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(main, /expandedPosition\s*=\s*\{ x, y \}/);
  assert.match(main, /screen\.getDisplayNearestPoint/);
  assert.match(main, /normalBoundsForDisplay\(display, expandedPosition\)/);
  assert.match(main, /mainWindow\.setMinimumSize\(COMPACT_SIZE\.width,\s*COMPACT_SIZE\.height\)/);
  assert.match(main, /mainWindow\.setMinimumSize\(minimum\.width, minimum\.height\)/);
});

test('model rows show at most five rows and preserve totals in Other', () => {
  const modelRows = modelRowsContext.window.codexModelRows;
  const five = modelRows.from({ a: 50, b: 40, c: 30, d: 20, e: 10 });
  assert.equal(JSON.stringify(five), JSON.stringify([
    ['a', 50], ['b', 40], ['c', 30], ['d', 20], ['e', 10]
  ]));
  const six = modelRows.from({ a: 60, b: 50, c: 40, d: 30, e: 20, f: 10 });
  assert.equal(JSON.stringify(six), JSON.stringify([
    ['a', 60], ['b', 50], ['c', 40], ['d', 30], ['Other', 30]
  ]));
  assert.equal(six.reduce((sum, [, tokens]) => sum + tokens, 0), 210);
});

test('analytics rows show a top ten plus an eleventh Other row', () => {
  const modelRows = modelRowsContext.window.codexModelRows;
  const entries = Array.from({ length: 12 }, (_, index) => [`item-${index}`, 12 - index]);
  const rows = modelRows.topWithOther(entries, 10);
  assert.equal(rows.length, 11);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.at(-1))), ['Other', 3]);
  assert.equal(rows.reduce((sum, [, tokens]) => sum + tokens, 0), 78);
});

test('recent sessions show four newest rows and aggregate overflow into the fifth row', () => {
  const sessionRows = sessionRowsContext.window.codexSessionRows;
  const sessions = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`s${index}`, {
    projectLabel: `Project ${index}`,
    lastUsedAt: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    totalTokens: (index + 1) * 10,
    models: { 'gpt-5': index + 1 }
  }]));
  const rows = sessionRows.from(sessions);
  assert.equal(rows.length, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.at(-1))), {
    label: 'Other', model: '', sessionCount: 2, tokens: 30, isOther: true
  });
  assert.equal(rows.reduce((sum, row) => sum + row.tokens, 0), 210);
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

test('settings use a titlebar trigger and top drawer with modal dismissal controls', () => {
  assert.match(html, /id="settings-trigger"[\s\S]*aria-expanded="false"/);
  assert.match(html, /id="settings-sheet"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(styles, /\.settings-sheet[\s\S]*top:\s*8px/);
  assert.match(styles, /@keyframes settings-sheet-in[\s\S]*translateY\(-32px\)/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /child\.inert = open/);
  assert.match(script, /setSettingsOpen\(byId\('settings-sheet'\)\.hidden\)/);
});

test('runtime UI source is fully English', () => {
  const uiSource = `${html}\n${script}\n${main}\n${modelRowsScript}\n${sessionRowsScript}`;
  assert.doesNotMatch(uiSource, /\p{Script=Han}/u);
  assert.match(script, /Intl\.NumberFormat\('en-US'/);
  assert.doesNotMatch(script, /Intl\.NumberFormat\('zh-CN'/);
  assert.match(styles, /\.heatmap-chart[^{]*\{[^}]*margin:\s*0 auto/);
});

test('renderer does not contain network APIs or remote URLs', () => {
  const source = `${html}\n${script}\n${analysisScript}\n${modelRowsScript}\n${sessionRowsScript}`;
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\/|wss?:\/\//i);
});
