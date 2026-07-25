'use strict';

const api = window.codexOffline;
const state = { stats: null, period: 'today', settings: null };
const byId = (id) => document.getElementById(id);
const format = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('zh-CN');

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

function renderModels(period) {
  const container = byId('models');
  container.replaceChildren();
  const entries = Object.entries(period?.models || {}).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
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

function render() {
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
  setText('total', exact.format(values.total));
  setText('compact-total', format.format(values.total));
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

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'system';
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
    state.stats = await api.stats.refresh();
    render();
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
byId('minimize').addEventListener('click', () => api.window.minimize());
byId('hide').addEventListener('click', () => api.window.hide());
byId('collapse').addEventListener('click', async () => {
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
  state.stats = stats;
  render();
});

Promise.all([api.stats.get(), loadSettings()]).then(([stats]) => {
  state.stats = stats;
  render();
});
