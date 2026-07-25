'use strict';

(function exposeAnalysis(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.codexAnalysis = api;
}(typeof window !== 'undefined' ? window : null, function createAnalysisApi() {
  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function localDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDaysUTC(key, delta) {
    return new Date(Date.parse(`${key}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
  }

  function dayOfWeekSun(key) {
    return new Date(Date.parse(`${key}T00:00:00Z`)).getUTCDay();
  }

  function heatmapIntensity(value, max) {
    if (max <= 0) return 0;
    const ratio = number(value) / max;
    return ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : ratio > 0 ? 1 : 0;
  }

  function computeHeatmapIntensities(daily) {
    const rows = Array.isArray(daily) ? daily : [];
    const maxTokens = Math.max(0, ...rows.map((row) => number(row?.tokens)));
    return rows.map((row) => ({
      ...row,
      tokenIntensity: heatmapIntensity(row?.tokens, maxTokens)
    }));
  }

  function contributionHeatmap(daily, options) {
    const settings = Object.assign(
      { cell: 8, gap: 3, startDate: null, endDate: null, intensityKey: 'tokenIntensity' },
      options || {}
    );
    const intensities = new Map();
    const values = new Map();
    let minDate = settings.startDate ? String(settings.startDate).slice(0, 10) : null;
    let maxDate = settings.endDate ? String(settings.endDate).slice(0, 10) : null;
    for (const day of (Array.isArray(daily) ? daily : [])) {
      const key = String(day.date).slice(0, 10);
      intensities.set(key, number(day[settings.intensityKey]));
      values.set(key, number(day.tokens));
      if (!settings.startDate && (!minDate || key < minDate)) minDate = key;
      if (!settings.endDate && (!maxDate || key > maxDate)) maxDate = key;
    }
    if (!minDate || !maxDate) {
      return { cells: [], width: 0, height: 0, weeks: 0, monthLabels: [] };
    }

    const start = addDaysUTC(minDate, -dayOfWeekSun(minDate));
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const cells = [];
    const monthLabels = [];
    for (let key = start; key <= maxDate; key = addDaysUTC(key, 1)) {
      const days = Math.round((Date.parse(`${key}T00:00:00Z`) - startMs) / 86400000);
      const column = Math.floor(days / 7);
      const row = dayOfWeekSun(key);
      if (key.slice(8, 10) === '01') monthLabels.push({ column, label: key.slice(0, 7) });
      cells.push({
        date: key,
        intensity: intensities.get(key) || 0,
        tokens: values.get(key) || 0,
        column,
        row,
        x: column * (settings.cell + settings.gap),
        y: row * (settings.cell + settings.gap),
        size: settings.cell
      });
    }
    const weeks = cells.length ? cells[cells.length - 1].column + 1 : 0;
    return {
      cells,
      weeks,
      monthLabels,
      cell: settings.cell,
      gap: settings.gap,
      width: weeks ? weeks * (settings.cell + settings.gap) - settings.gap : 0,
      height: 7 * (settings.cell + settings.gap) - settings.gap
    };
  }

  function rollingYearHeatmap(daily, options) {
    const settings = Object.assign({ endDate: localDayKey(), cell: 8, gap: 3 }, options || {});
    const endDate = String(settings.endDate).slice(0, 10);
    const end = new Date(`${endDate}T00:00:00Z`);
    const startDate = new Date(Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth() - 11,
      1
    )).toISOString().slice(0, 10);
    const rows = computeHeatmapIntensities(daily);
    return contributionHeatmap(rows, {
      cell: settings.cell,
      gap: settings.gap,
      startDate,
      endDate
    });
  }

  function sparklinePreview(points, options) {
    const settings = Object.assign(
      { width: 120, height: 28, gap: 0.25, metric: 'tokens' },
      options || {}
    );
    const rows = Array.isArray(points) ? points : [];
    const valueOf = (point) => number(point && point[settings.metric]);
    const maxValue = Math.max(1, ...rows.map(valueOf));
    const slot = rows.length ? settings.width / rows.length : settings.width;
    const barWidth = slot * (1 - settings.gap);
    const bars = rows.map((point, index) => {
      const value = valueOf(point);
      const height = settings.height * value / maxValue;
      return {
        value,
        x: index * slot + (slot - barWidth) / 2,
        width: barWidth,
        y: settings.height - height,
        height,
        last: index === rows.length - 1
      };
    });
    return { width: settings.width, height: settings.height, maxVal: maxValue, bars };
  }

  return {
    computeHeatmapIntensities,
    contributionHeatmap,
    localDayKey,
    rollingYearHeatmap,
    sparklinePreview
  };
}));
