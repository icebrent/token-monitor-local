'use strict';

const BOM = '\uFEFF';
const PERIODS = ['today', 'month', 'allTime'];
const EXPORT_FILENAMES = [
  'codex-offline-usage.json',
  'codex-offline-models.csv',
  'codex-offline-daily.csv'
];

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

function tokenComponents(period, model) {
  const total = num(period?.models?.[model]);
  const cachedInput = num(period?.modelCacheReads?.[model]);
  const cacheWrite = num(period?.modelCacheWrites?.[model]);
  const output = num(period?.modelOutputs?.[model]);
  return {
    total,
    input: Math.max(0, total - cachedInput - cacheWrite - output),
    cached_input: cachedInput,
    cache_write: cacheWrite,
    output
  };
}

function modelRows(periods) {
  const rows = [];
  for (const periodName of PERIODS) {
    const period = periods?.[periodName] || {};
    for (const model of Object.keys(period.models || {}).sort()) {
      rows.push({ period: periodName, model, ...tokenComponents(period, model) });
    }
  }
  return rows;
}

function dailyRows(history) {
  const rows = [];
  for (const day of history?.daily || []) {
    for (const [model, usage] of Object.entries(day.perModel || {}).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({ date: day.date, model, total: num(usage.tokens) });
    }
  }
  return rows;
}

function renderExportJson({ periods, history, generatedAt = new Date().toISOString() } = {}) {
  return `${JSON.stringify({
    format: 'codex-offline-usage-v1',
    generatedAt,
    periods: periods || {},
    history: history || { daily: [], monthly: [], summary: {} }
  }, null, 2)}\n`;
}

function exportFileSet({ periods, history, generatedAt } = {}) {
  const [jsonName, modelsName, dailyName] = EXPORT_FILENAMES;
  return [
    { name: jsonName, contents: renderExportJson({ periods, history, generatedAt }) },
    {
      name: modelsName,
      contents: toCsv(modelRows(periods), [
        'period', 'model', 'total', 'input', 'cached_input', 'cache_write', 'output'
      ])
    },
    {
      name: dailyName,
      contents: toCsv(dailyRows(history), ['date', 'model', 'total'])
    }
  ];
}

module.exports = {
  EXPORT_FILENAMES,
  csvEscape,
  dailyRows,
  exportFileSet,
  modelRows,
  renderExportJson,
  toCsv,
  tokenComponents
};
