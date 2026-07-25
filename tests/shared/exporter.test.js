'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EXPORT_FILENAMES,
  csvEscape,
  dailyRows,
  exportFileSet,
  modelRows,
  renderExportJson,
  toCsv
} = require('../../src/shared/exporter');

const periods = {
  today: {
    totalTokens: 130,
    models: { 'gpt-5': 130 },
    modelCacheReads: { 'gpt-5': 80 },
    modelCacheWrites: {},
    modelOutputs: { 'gpt-5': 20 },
    sessions: { 'codex:one': { totalTokens: 130, reasoningTokens: 5 } }
  },
  month: { models: {} },
  allTime: { models: {} }
};

const history = {
  daily: [
    { date: '2026-07-25', tokens: 130, perModel: { 'gpt-5': { tokens: 130 } } }
  ],
  monthly: [{ month: '2026-07', tokens: 130 }],
  summary: { totalTokens: 130 }
};

test('CSV serialization quotes unsafe cells and uses BOM plus CRLF', () => {
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  const csv = toCsv([{ name: 'gpt-5', total: 130 }], ['name', 'total']);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('name,total\r\ngpt-5,130\r\n'));
});

test('model CSV rows keep disjoint token components', () => {
  assert.deepEqual(modelRows(periods), [{
    period: 'today',
    model: 'gpt-5',
    total: 130,
    input: 30,
    cached_input: 80,
    cache_write: 0,
    output: 20
  }]);
});

test('daily CSV rows preserve model trends', () => {
  assert.deepEqual(dailyRows(history), [
    { date: '2026-07-25', model: 'gpt-5', total: 130 }
  ]);
});

test('JSON export is lossless for local periods and history', () => {
  const json = JSON.parse(renderExportJson({
    periods,
    history,
    generatedAt: '2026-07-25T00:00:00.000Z'
  }));
  assert.equal(json.format, 'codex-offline-usage-v1');
  assert.equal(json.generatedAt, '2026-07-25T00:00:00.000Z');
  assert.deepEqual(json.periods.today.sessions, periods.today.sessions);
  assert.deepEqual(json.history, history);
  assert.ok(!/deviceId|hostname|account|credential|token.*key/i.test(JSON.stringify(json)));
});

test('local export always produces one JSON file and two CSV files', () => {
  const files = exportFileSet({ periods, history });
  assert.deepEqual(files.map((file) => file.name), EXPORT_FILENAMES);
  assert.ok(files.every((file) => file.contents.length > 0));
});
