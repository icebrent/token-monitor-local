'use strict';

const api = window.codexOffline;
const modelRows = window.codexModelRows;
const tokenTransition = window.codexTokenTransition;
const state = { stats: null, period: 'today', settings: null };
const byId = (id) => document.getElementById(id);
const format = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('zh-CN');
const totalTransitionTimers = new Set();
let totalTransitionFrame = null;

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
    empty.textContent = '这个周期暂无模型数据';
    container.append(empty);
  }
}

function renderSessions(period) {
  const container = byId('recent-sessions');
  container.replaceChildren();
  const sessions = Object.values(period?.sessions || {})
    .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
    .slice(0, 5);
  for (const session of sessions) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const title = document.createElement('span');
    title.textContent = session.projectLabel || 'Codex session';
    const meta = document.createElement('small');
    const model = Object.entries(session.models || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
    meta.textContent = `${model} · ${format.format(number(session.totalTokens))}`;
    row.append(title, meta);
    container.append(row);
  }
  if (!sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '这个周期暂无会话';
    container.append(empty);
  }
}

function renderTrend() {
  const history = state.stats?.history || {};
  const days = (history.daily || []).filter((day) => number(day.tokens) > 0).slice(-28);
  const max = Math.max(1, ...days.map((day) => number(day.tokens)));
  const chart = byId('trend-chart');
  chart.replaceChildren();
  for (const day of days) {
    const bar = document.createElement('div');
    bar.className = 'trend-bar';
    bar.style.height = `${Math.max(3, number(day.tokens) / max * 100)}%`;
    bar.title = `${day.date}: ${exact.format(number(day.tokens))} token`;
    chart.append(bar);
  }
  const summary = history.summary || {};
  setText('active-days', exact.format(number(summary.activeDays)));
  setText('peak-day', format.format(number(summary.peakDayTokens)));
  setText('favorite-model', summary.favoriteModel || '—');
}

function render({ totalTransition = null } = {}) {
  const stats = state.stats || {};
  const isTrends = state.period === 'trends';
  byId('summary-view').hidden = isTrends;
  byId('trends-view').hidden = !isTrends;
  document.querySelectorAll('.period').forEach((button) => {
    button.classList.toggle('active', button.dataset.period === state.period);
  });
  byId('error').hidden = !stats.error;
  byId('error').textContent = stats.error || '';
  if (isTrends) {
    renderTrend();
    return;
  }
  const period = stats.periods?.[state.period] || {};
  const values = components(period);
  if (totalTransition) animateTotal(totalTransition);
  else {
    clearTotalTransition();
    setTotalValues(values.total);
  }
  setText('input', format.format(values.input));
  setText('cached', format.format(values.cached));
  setText('output', format.format(values.output));
  setText('reasoning', format.format(reasoning(period)));
  setText('sessions', exact.format(Object.keys(period.sessions || {}).length));
  setText('models-count', exact.format(Object.keys(period.models || {}).length));
  setText('model-period', { today: '今天', month: '本月', allTime: '全部' }[state.period]);
  setText('updated', stats.collectedAt ? `更新于 ${new Date(stats.collectedAt).toLocaleTimeString('zh-CN')}` : '等待本地日志');
  renderModels(period);
  renderSessions(period);
}

function applyStats(stats, { animate = false } = {}) {
  const previous = components(state.stats?.periods?.[state.period]).total;
  const next = components(stats?.periods?.[state.period]).total;
  const totalTransition = animate && state.stats && state.period !== 'trends'
    ? tokenTransition.positiveDelta(previous, next)
    : null;
  state.stats = stats;
  render({ totalTransition });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'system';
}

function setSettingsOpen(open, { restoreFocus = true } = {}) {
  const sheet = byId('settings-sheet');
  const backdrop = byId('settings-backdrop');
  const trigger = byId('settings-trigger');
  trigger.setAttribute('aria-expanded', String(open));
  sheet.hidden = !open;
  backdrop.hidden = !open;
  for (const child of byId('app').children) {
    if (child !== sheet && child !== backdrop) child.inert = open;
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
  if (state.settings.exportDir) setText('export-status', `导出目录：${state.settings.exportDir}`);
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
  if (selected) setText('export-status', `导出目录：${selected}`);
});
byId('export-now').addEventListener('click', async () => {
  try {
    const result = await api.exports.write();
    setText('export-status', `已生成：${result.files.join('、')}`);
  } catch (error) {
    setText('export-status', error.message);
  }
});
byId('open-export').addEventListener('click', () => api.exports.openDirectory());
byId('open-user-data').addEventListener('click', () => api.app.openUserData());
byId('settings-trigger').addEventListener('click', () => setSettingsOpen(true));
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
