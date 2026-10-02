 'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('src/electron/renderer/index.html');
const script = read('src/electron/renderer/app.js');
const main = read('src/electron/main.js');
const preload = read('src/electron/preload.js');
const analysisContext = { window: {} };
vm.runInNewContext(read('src/electron/renderer/analysis.js'), analysisContext);
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


test('single page HUD removes tabs, daily list, export and lifetime hero wiring', () => {
  assert.doesNotMatch(html + script, /view-select|summary-view|activity-view|daily-activity|daily-panel|settings-sheet|choose-export|export-now|open-export|open-user-data|total-delta|tokenTransition/);
  assert.doesNotMatch(main + preload, /export:|exportDir|exporter|openUserData|openPath|dialog|localPaths|codexJsonlParser/);
  assert.equal(fs.existsSync(path.join(root, 'src/shared/exporter.js')), false);
  for (const id of ['theme-toggle', 'pin-toggle', 'refresh-interval', 'settings-popover', 'compact-quota']) assert.ok(html.includes(`id="${id}"`));
});
test('window is compact and screen aware; production renderer stays network free', () => {
  assert.match(main, /width: 450, height: 660/);
  assert.match(main, /width: 248, height: 64/);
  assert.match(main, /normalBoundsForDisplay\(display, expandedPosition\)/);
  assert.match(main, /\[0, 60, 300, 900\]/);
  assert.match(main, /settings.refreshIntervalSec \* 1000/);
  assert.doesNotMatch(script + html, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//);
  assert.doesNotMatch(html + script + main, /\p{Script=Han}/u);
});
