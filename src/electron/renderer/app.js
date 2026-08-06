'use strict';

const api = window.codexOffline;
const analysis = window.codexAnalysis;
const modelRows = window.codexModelRows;
const sessionRows = window.codexSessionRows;
const tokenTransition = window.codexTokenTransition;
const state = {
  stats: null,
  view: 'overview',
  period: 'today',
  analysisTab: 'overview',
  settings: null
};
const byId = (id) => document.getElementById(id);
const format = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('en-US');
const TOTAL_COALESCE_MS = 1200;
const totalTransitionTimers = new Set();
let totalTransitionFrame = null;
let totalCoalesceTimer = null;
let queuedTotalTransition = null;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function components(period) {
  const total = number(period?.totalTokens);
  const cached = number(period?.cacheReadTokens);
  const cacheWrite = number(period?.cacheWriteTokens);
  const output = number(period?.outputTokens);
  return {
    total,
    input: Math.max(0, total - cached - cacheWrite - output),
    cached,
    output
  };
}

function reasoning(period) {
  return Object.values(period?.sessions || {})
    .reduce((sum, session) => sum + number(session.reasoningTokens), 0);
}

function setText(id, value) {
  byId(id).textContent = value;
}

function clearTotalTransition() {
  for (const timer of totalTransitionTimers) clearTimeout(timer);
  totalTransitionTimers.clear();
  if (totalTransitionFrame !== null) cancelAnimationFrame(totalTransitionFrame);
  totalTransitionFrame = null;
  const delta = byId('total-delta');
  delta.hidden = true;
  delta.classList.remove('is-visible');
  byId('total').classList.remove('token-total-settling');
  byId('compact-total').classList.remove('token-total-settling');
}

function clearTotalQueue() {
  if (totalCoalesceTimer !== null) clearTimeout(totalCoalesceTimer);
  totalCoalesceTimer = null;
  queuedTotalTransition = null;
}

function clearTotalUpdates() {
  clearTotalQueue();
  clearTotalTransition();
}

function hasTotalUpdateInProgress() {
  return totalCoalesceTimer !== null
    || queuedTotalTransition !== null
    || totalTransitionFrame !== null
    || totalTransitionTimers.size > 0;
}

function setTotalValues(total) {
  setText('total', exact.format(total));
  setText('compact-total', format.format(total));
}

function animateTotal(transition) {
  clearTotalTransition();
  setTotalValues(transition.from);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setTotalValues(transition.to);
    return;
  }

  const delta = byId('total-delta');
  delta.textContent = `+${exact.format(transition.delta)}`;
  delta.hidden = false;
  totalTransitionFrame = requestAnimationFrame(() => {
    totalTransitionFrame = null;
    delta.classList.add('is-visible');
    setText('compact-total', `${format.format(transition.from)} +${format.format(transition.delta)}`);
  });

  const settleTimer = setTimeout(() => {
    totalTransitionTimers.delete(settleTimer);
    delta.classList.remove('is-visible');
    setTotalValues(transition.to);
    byId('total').classList.add('token-total-settling');
    byId('compact-total').classList.add('token-total-settling');
  }, 850);
  totalTransitionTimers.add(settleTimer);

  const cleanupTimer = setTimeout(() => {
    totalTransitionTimers.delete(cleanupTimer);
    clearTotalTransition();
    setTotalValues(transition.to);
  }, 1100);
  totalTransitionTimers.add(cleanupTimer);
}

function queueTotalTransition(transition) {
  queuedTotalTransition = tokenTransition.merge(queuedTotalTransition, transition);
  if (totalCoalesceTimer !== null) return;
  totalCoalesceTimer = setTimeout(() => {
    totalCoalesceTimer = null;
    const nextTransition = queuedTotalTransition;
    queuedTotalTransition = null;
    if (nextTransition) animateTotal(nextTransition);
  }, TOTAL_COALESCE_MS);
}

function renderModels(period) {
  const container = byId('models');
  container.replaceChildren();
  const entries = modelRows.from(period?.models);
  const max = Math.max(1, ...entries.map(([, tokens]) => tokens));
  for (const [model, tokens] of entries) {
    const row = document.createElement('div');
    row.className = 'model-row';
    const label = document.createElement('span');
    label.textContent = model;
    const value = document.createElement('strong');
    value.textContent = exact.format(tokens);
    const track = document.createElement('i');
    const fill = document.createElement('b');
    fill.style.width = `${Math.max(2, tokens / max * 100)}%`;
    track.append(fill);
    row.append(label, value, track);
    container.append(row);
  }
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No model usage in this period';
    container.append(empty);
  }
}

function renderSessions(period) {
  const container = byId('recent-sessions');
  container.replaceChildren();
  const rows = sessionRows.from(period?.sessions);
  for (const session of rows) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const title = document.createElement('span');
    title.textContent = session.label;
    const meta = document.createElement('small');
    meta.textContent = session.isOther
      ? `${exact.format(session.sessionCount)} sessions · ${format.format(session.tokens)} tokens`
      : `${session.model} · ${format.format(session.tokens)} tokens`;
    row.append(title, meta);
    container.append(row);
  }
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No sessions in this period';
    container.append(empty);
  }
}

function trendPoints() {
  const history = state.stats?.history || {};
  return (history.daily || []).filter((day) => number(day.tokens) > 0).slice(-28);
}

function renderTrendChart(id, points = trendPoints()) {
  const chart = byId(id);
  chart.replaceChildren();
  const model = analysis.sparklinePreview(points, { width: 300, height: 220, gap: 0.25 });
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const value = number(point.tokens);
    const bar = document.createElement('div');
    bar.className = 'trend-bar';
    bar.style.height = `${Math.max(3, model.bars[index].height / model.height * 100)}%`;
    bar.title = `${point.date}: ${exact.format(value)} token`;
    chart.append(bar);
  }
}

function renderHeatmap() {
  const daily = state.stats?.history?.daily || [];
  const model = analysis.rollingSixMonthHeatmap(daily);
  const chart = byId('heatmap-chart');
  chart.replaceChildren();
  chart.style.width = `${model.width}px`;
  chart.style.height = `${model.height + 16}px`;
  for (const cell of model.cells) {
    const element = document.createElement('i');
    element.className = `heatmap-cell level-${cell.intensity}`;
    element.style.left = `${cell.x}px`;
    element.style.top = `${cell.y}px`;
    element.style.width = `${cell.size}px`;
    element.style.height = `${cell.size}px`;
    element.title = `${cell.date}: ${exact.format(cell.tokens)} tokens`;
    chart.append(element);
  }
  for (const month of model.monthLabels) {
    const label = document.createElement('span');
    label.className = 'heatmap-month';
    label.style.left = `${month.column * (model.cell + model.gap)}px`;
    label.style.top = `${model.height + 3}px`;
    label.textContent = month.label.slice(5);
    chart.append(label);
  }
}

function renderAnalysisRows(id, entries, { topCount = null } = {}) {
  const container = byId(id);
  container.replaceChildren();
  const rows = entries
    .map(([label, value]) => [String(label || ''), number(value)])
    .filter(([label, value]) => label && value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const visibleRows = Number.isInteger(topCount)
    ? modelRows.topWithOther(rows, topCount)
    : rows;
  const max = Math.max(1, ...visibleRows.map(([, value]) => value));
  for (const [label, value] of visibleRows) {
    const row = document.createElement('div');
    row.className = 'analysis-row';
    const name = document.createElement('span');
    name.textContent = label;
    const total = document.createElement('strong');
    total.textContent = exact.format(value);
    const track = document.createElement('i');
    track.className = 'analysis-track';
    const fill = document.createElement('b');
    fill.className = 'analysis-fill';
    fill.style.width = `${value / max * 100}%`;
    track.append(fill);
    row.append(name, total, track);
    container.append(row);
  }
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No local usage data';
    container.append(empty);
  }
}

function renderAnalysisOverview() {
  const history = state.stats?.history || {};
  const summary = history.summary || {};
  renderHeatmap();
  setText('active-days', exact.format(number(summary.activeDays)));
  setText('current-streak', exact.format(number(summary.currentStreak)));
  setText('longest-streak', exact.format(number(summary.longestStreak)));
  setText('peak-day', format.format(number(summary.peakDayTokens)));
  setText('history-messages', exact.format(number(summary.messages)));
  setText('favorite-model', summary.favoriteModel || '—');
}

function renderAnalysisModels() {
  const models = state.stats?.periods?.allTime?.models || {};
  renderAnalysisRows('analysis-model-list', Object.entries(models), { topCount: 10 });
}

function renderAnalysisProjects() {
  const projects = state.stats?.periods?.allTime?.projects || {};
  const entries = Object.entries(projects).map(([key, project]) => [
    project?.label || key,
    project?.tokens
  ]);
  renderAnalysisRows('analysis-project-list', entries, { topCount: 10 });
}

function renderAnalysisDates() {
  renderTrendChart('daily-trend-chart');
  const monthly = state.stats?.history?.monthly || [];
  renderAnalysisRows('monthly-list', monthly.map((month) => [month.month, month.tokens]));
}

function renderAnalysis() {
  const sections = {
    overview: 'analysis-overview',
    models: 'analysis-models',
    projects: 'analysis-projects',
    dates: 'analysis-dates'
  };
  for (const [key, id] of Object.entries(sections)) {
    byId(id).hidden = key !== state.analysisTab;
  }
  document.querySelectorAll('.analysis-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.analysis === state.analysisTab);
  });
  if (state.analysisTab === 'overview') renderAnalysisOverview();
  else if (state.analysisTab === 'models') renderAnalysisModels();
  else if (state.analysisTab === 'projects') renderAnalysisProjects();
  else renderAnalysisDates();
}

function render({ preserveTotal = false } = {}) {
  if (!preserveTotal) clearTotalUpdates();
  const stats = state.stats || {};
  const isAnalysis = state.view === 'analysis';
  byId('view-select').value = state.view;
  byId('overview-tabs').hidden = isAnalysis;
  byId('analysis-tabs').hidden = !isAnalysis;
  byId('summary-view').hidden = isAnalysis;
  byId('analysis-view').hidden = !isAnalysis;
  document.querySelectorAll('.period').forEach((button) => {
    button.classList.toggle('active', button.dataset.period === state.period);
  });
  byId('error').hidden = !stats.error;
  byId('error').textContent = stats.error || '';
  if (isAnalysis) {
    renderAnalysis();
    return;
  }
  const period = stats.periods?.[state.period] || {};
  const values = components(period);
  if (!preserveTotal) setTotalValues(values.total);
  setText('input', format.format(values.input));
  setText('cached', format.format(values.cached));
  setText('output', format.format(values.output));
  setText('reasoning', format.format(reasoning(period)));
  setText('sessions', exact.format(Object.keys(period.sessions || {}).length));
  setText('models-count', exact.format(Object.keys(period.models || {}).length));
  setText('model-period', { today: 'Today', month: 'This Month', allTime: 'All Time' }[state.period]);
  setText('updated', stats.collectedAt ? new Date(stats.collectedAt).toLocaleTimeString('en-US') : 'Waiting for local logs');
  renderModels(period);
  renderSessions(period);
}

function applyStats(stats, { animate = false } = {}) {
  const previous = components(state.stats?.periods?.[state.period]).total;
  const next = components(stats?.periods?.[state.period]).total;
  const canAnimate = animate && state.stats && state.view === 'overview';
  const totalTransition = canAnimate
    ? tokenTransition.positiveDelta(previous, next)
    : null;
  const preserveTotal = Boolean(totalTransition)
    || (canAnimate && next === previous && hasTotalUpdateInProgress());
  state.stats = stats;
  render({ preserveTotal });
  if (totalTransition) queueTotalTransition(totalTransition);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'system';
}

function setSettingsOpen(open, { restoreFocus = true } = {}) {
  const sheet = byId('settings-sheet');
  const backdrop = byId('settings-backdrop');
  const trigger = byId('settings-trigger');
  const triggerLabel = open ? 'Close Local Settings & Export' : 'Open Local Settings & Export';
  trigger.setAttribute('aria-expanded', String(open));
  trigger.setAttribute('aria-label', triggerLabel);
  trigger.title = triggerLabel;
  sheet.hidden = !open;
  backdrop.hidden = !open;
  for (const child of byId('app').children) {
    if (child !== sheet && child !== backdrop && !child.classList.contains('titlebar')) child.inert = open;
  }
  for (const child of document.querySelectorAll('.titlebar > :not(.window-actions), .window-actions > :not(#settings-trigger)')) {
    child.inert = open;
  }
  if (open) byId('settings-close').focus();
  else if (restoreFocus) trigger.focus();
}

async function loadSettings() {
  state.settings = await api.settings.get();
  byId('always-on-top').checked = state.settings.alwaysOnTop;
  byId('opacity').value = Math.round(state.settings.opacity * 100);
  setText('opacity-value', `${byId('opacity').value}%`);
  byId('theme').value = state.settings.theme;
  applyTheme(state.settings.theme);
  if (state.settings.exportDir) setText('export-status', `Export directory: ${state.settings.exportDir}`);
}

async function updateSettings(patch) {
  state.settings = await api.settings.update(patch);
  applyTheme(state.settings.theme);
}

document.querySelectorAll('.period').forEach((button) => {
  button.addEventListener('click', () => {
    state.period = button.dataset.period;
    render();
  });
});
byId('view-select').addEventListener('change', (event) => {
  state.view = event.target.value === 'analysis' ? 'analysis' : 'overview';
  render();
});
document.querySelectorAll('.analysis-tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.analysisTab = button.dataset.analysis;
    render();
  });
});
byId('refresh').addEventListener('click', async () => {
  byId('refresh').disabled = true;
  try {
    const stats = await api.stats.refresh();
    if (stats.collectedAt !== state.stats?.collectedAt) applyStats(stats, { animate: true });
  } finally {
    byId('refresh').disabled = false;
  }
});
byId('always-on-top').addEventListener('change', (event) => updateSettings({ alwaysOnTop: event.target.checked }));
byId('opacity').addEventListener('input', (event) => {
  setText('opacity-value', `${event.target.value}%`);
});
byId('opacity').addEventListener('change', (event) => updateSettings({ opacity: number(event.target.value) / 100 }));
byId('theme').addEventListener('change', (event) => updateSettings({ theme: event.target.value }));
byId('choose-export').addEventListener('click', async () => {
  const selected = await api.exports.chooseDirectory();
  if (selected) setText('export-status', `Export directory: ${selected}`);
});
byId('export-now').addEventListener('click', async () => {
  try {
    const result = await api.exports.write();
    setText('export-status', `Generated: ${result.files.join(', ')}`);
  } catch (error) {
    setText('export-status', error.message);
  }
});
byId('open-export').addEventListener('click', () => api.exports.openDirectory());
byId('open-user-data').addEventListener('click', () => api.app.openUserData());
byId('settings-trigger').addEventListener('click', () => setSettingsOpen(byId('settings-sheet').hidden));
byId('settings-close').addEventListener('click', () => setSettingsOpen(false));
byId('settings-backdrop').addEventListener('click', () => setSettingsOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !byId('settings-sheet').hidden) setSettingsOpen(false);
});
byId('minimize').addEventListener('click', () => api.window.minimize());
byId('hide').addEventListener('click', () => api.window.hide());
byId('collapse').addEventListener('click', async () => {
  if (!byId('settings-sheet').hidden) setSettingsOpen(false, { restoreFocus: false });
  await api.window.collapse();
  byId('app').hidden = true;
  byId('compact').hidden = false;
});
byId('expand').addEventListener('click', async () => {
  await api.window.expand();
  byId('compact').hidden = true;
  byId('app').hidden = false;
});

api.stats.onChanged((stats) => {
  applyStats(stats, { animate: true });
});

Promise.all([api.stats.get(), loadSettings()]).then(([stats]) => {
  applyStats(stats);
});
