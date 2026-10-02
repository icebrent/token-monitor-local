'use strict';

const api = window.codexOffline;
const analysis = window.codexAnalysis;
const metrics = window.codexUsageMetrics;

const state = { stats: null, settings: null };
const byId = (id) => document.getElementById(id);
const format = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat('en-US');
const setText = (id, value) => { byId(id).textContent = value; };
function usageTooltip(node, text) {
  node.title = text;
  node.setAttribute('aria-label', text);
  node.addEventListener('pointermove', (event) => {
    node.removeAttribute('title');
    const tooltip = byId('usage-tooltip'); tooltip.textContent = text; tooltip.hidden = false;
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(4, Math.min(event.clientX + 14, window.innerWidth - bounds.width - 8))}px`;
    tooltip.style.top = `${Math.max(4, event.clientY + 18 + bounds.height < window.innerHeight ? event.clientY + 18 : event.clientY - bounds.height - 14)}px`;
  });
  node.addEventListener('pointerleave', () => { byId('usage-tooltip').hidden = true; });
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function detail(container, label, value, title) {
  if (value === null || value === undefined || value === '') return;
  const row = element('div', undefined, 'diagnostic-row');
  const text = element('small', String(value));
  if (title) text.title = title;
  row.append(element('span', label), text);
  container.append(row);
}
function optionalStat(id, value, label = null) {
  byId(id + '-card').hidden = value === null || value === undefined;
  if (value !== null && value !== undefined) setText(id, label || format.format(value));
}
function renderLimits() {
  const container = byId('limits'); container.replaceChildren();
  const warnings = []; const credits = []; const mini = []; const miniDetails = [];
  if (state.stats?.ordinaryUsageAllowed === false) warnings.push('Ordinary included usage is currently unavailable');
  const windows = (state.stats?.limits || []).flatMap((bucket) => bucket.windows.map((limit) => ({ bucket, limit })));
  windows.sort((a, b) => (a.limit.windowDurationMins ?? Infinity) - (b.limit.windowDurationMins ?? Infinity));
  for (const { bucket, limit } of windows) {
    const duration = limit.windowDurationMins === 300 ? '5-hour' : limit.windowDurationMins === 10080 ? 'Weekly' : limit.windowDurationMins === null ? limit.key : limit.windowDurationMins + ' min';
    const remaining = Math.min(100, Math.max(0, 100 - limit.usedPercent));
    const card = element('article', undefined, 'limit-card'); card.append(element('h2', duration), element('strong', `${remaining}% LEFT`));
    const track = element('i', undefined, 'limit-track'); const fill = element('b', undefined, 'limit-fill'); fill.style.width = `${remaining}%`; track.append(fill);
    card.append(track, element('small', `${limit.usedPercent}% used`, 'muted'));
    const reset = metrics.resetTime(limit.resetsAt);
    if (reset) { const text = element('p', reset.text, 'reset'); text.title = reset.title; card.append(text); }
    if ((state.stats?.limits.length || 0) > 1) card.append(element('small', bucket.name, 'muted'));
    if (remaining <= 10) card.classList.add('quota-low'); container.append(card);
    if ([300, 10080].includes(limit.windowDurationMins)) { mini.push(`${limit.windowDurationMins === 300 ? '5h' : 'W'} ${remaining}%`); miniDetails.push(`${duration}\n${remaining}% remaining` + (reset ? `\n${reset.text}\n${reset.title}` : '')); }
  }
  for (const bucket of state.stats?.limits || []) {
    if (bucket.rateLimitReachedType) warnings.push(bucket.name + ': ' + bucket.rateLimitReachedType.replaceAll('_', ' '));
    if (bucket.spendControlReached === true) warnings.push(bucket.name + ': spending limit reached');
    if (bucket.credits?.unlimited === true) credits.push('Unlimited credits');
    else if (bucket.credits?.balance && Number(bucket.credits.balance) !== 0) credits.push(`Credits: ${bucket.credits.balance}`);
    const individual = bucket.individualLimit;
    if (individual) {
      for (const key of ['limit', 'used']) if (individual[key] !== null && individual[key] !== undefined) credits.push(`Individual ${key}: ${individual[key]}`);
      if (individual.remainingPercent !== null && individual.remainingPercent !== undefined) credits.push(`Individual remaining: ${individual.remainingPercent}%`);
      const reset = metrics.resetTime(individual.resetsAt); if (reset) credits.push(reset.text);
    }
  }
  const count = state.stats?.rateLimitResetCredits?.availableCount; if (count > 0) credits.unshift(`${count} reset credits available`);
  setText('credit-info', credits.join(' · ')); byId('credit-info').hidden = !credits.length;
  setText('compact-quota', mini.join(' · ') || 'Limits unavailable'); byId('expand').title = miniDetails.join('\n\n') || 'Official limits unavailable · Click to expand';
  byId('limit-warning').hidden = !warnings.length; setText('limit-warning', warnings.join(' · ')); byId('limits-unavailable').hidden = container.children.length > 0;
}
function trendPoints() { return metrics.activity(state.stats?.history?.daily || []).trend; }
function renderTrendChart() {
  const chart = byId('daily-trend-chart');
  chart.replaceChildren();
  const points = trendPoints();
  byId('trend-panel').hidden = !points.length;
  const model = analysis.sparklinePreview(points, { width: 300, height: 28, gap: 0.25 });
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const bar = element('div', undefined, 'trend-bar');
    bar.style.height = `${Math.max(2, model.bars[index].height / model.height * 100)}%`;
    usageTooltip(bar, `${point.date}\n${point.tokens ? exact.format(point.tokens) + ' tokens' : 'No usage'}`);
    chart.append(bar);
  }
}
function renderHeatmap() {
  const daily = state.stats?.history?.daily || [];
  byId('heatmap-panel').hidden = !daily.length;
  const available = Math.max(1, (byId('heatmap-panel').clientWidth || 394) - 24);
  const base = analysis.rollingSixMonthHeatmap(daily);
  const gap = available < 330 ? 2 : 4;
  const cell = Math.max(2, Math.min(10, (available - (base.weeks - 1) * gap) / base.weeks));
  const model = analysis.rollingSixMonthHeatmap(daily, { cell, gap });
  const chart = byId('heatmap-chart');
  chart.replaceChildren();
  const suppliedDates = new Set(daily.map((day) => day.date));
  chart.style.width = `${model.width}px`;
  chart.style.height = `${model.height + 16}px`;
  for (const cell of model.cells) {
    const node = element('i', undefined, `heatmap-cell level-${cell.intensity}`);
    Object.assign(node.style, { left: `${cell.x}px`, top: `${cell.y}px`, width: `${cell.size}px`, height: `${cell.size}px` });
    const date = new Date(cell.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    usageTooltip(node, `${date}\n` + (suppliedDates.has(cell.date) ? cell.tokens ? exact.format(cell.tokens) + ' tokens' : 'No usage' : 'Not provided by official API'));
    chart.append(node);
  }
  for (const month of model.monthLabels) {
    const label = element('span', new Date(month.label + '-01T12:00:00').toLocaleDateString('en-US', { month: 'short' }), 'heatmap-month');
    label.style.left = `${month.column * (model.cell + model.gap)}px`;
    label.style.top = `${model.height + 3}px`;
    chart.append(label);
  }
}
function renderStatus() {
  const stats = state.stats || {};
  const container = byId('status-details'); container.replaceChildren();
  detail(container, 'Plan', metrics.planLabel(stats.planType));
  detail(container, 'Codex CLI', stats.cliStatus || 'Waiting');
  detail(container, 'Official data source', stats.status || 'loading');
  detail(container, 'Last successful refresh', stats.collectedAt ? new Date(stats.collectedAt).toLocaleString('en-US') : 'No successful request yet');
  setText('diagnostics-toggle', `Status: ${stats.cliStatus === 'connected' && !stats.error ? 'Connected' : stats.status === 'loading' ? 'Waiting' : 'Needs attention'}`);
  for (const [key, method] of [['usage', 'account/usage/read'], ['limits', 'account/rateLimits/read']]) {
    const timestamp = stats[key + 'UpdatedAt'];
    detail(container, method, stats.errors?.[key] ? `${stats.errors[key].code}: ${stats.errors[key].message}` : timestamp ? 'Ready' : 'Waiting', timestamp ? 'Last successful client request: ' + new Date(timestamp).toLocaleString('en-US') : null);
  }
}
function render() {
  byId('usage-tooltip').hidden = true;
  const stats = state.stats || {};
  const daily = stats.history?.daily || [];
  const derived = metrics.activity(daily);
  const summary = stats.history?.summary || {};
  const plan = metrics.planLabel(stats.planType);
  byId('plan-badge').hidden = !plan;
  setText('plan-badge', plan || '');
  byId('plan-badge').title = plan || '';
  const failure = Boolean(stats.error) || stats.cliStatus === 'disconnected' && stats.status !== 'loading';
  document.documentElement.dataset.connection = failure ? 'attention' : 'ready';
  byId('error').hidden = !failure;
  setText('error', failure ? 'Official data temporarily unavailable' + (stats.collectedAt ? ' · Last updated ' + new Date(stats.collectedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '') : '');
  byId('error').title = stats.error || 'CLI disconnected';
  setText('source-status', 'Official');
  setText('updated', stats.collectedAt ? '· Updated ' + new Date(stats.collectedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '· Waiting for official usage');
  byId('updated').title = `Client fetch times · Activity: ${stats.usageUpdatedAt || 'unavailable'} · Limits: ${stats.limitsUpdatedAt || 'unavailable'}`;
  optionalStat('total', stats.periods?.allTime?.totalTokens);
  byId('total').title = Number.isSafeInteger(stats.periods?.allTime?.totalTokens) ? exact.format(stats.periods.allTime.totalTokens) + ' tokens' : '';
  optionalStat('today', derived.today);
  optionalStat('month', derived.month?.tokens);
  byId('month-card').title = 'Calculated from official daily activity' + (derived.month?.partial ? ' · partial' : '');
  optionalStat('peak-day', summary.peakDayTokens);
  optionalStat('current-streak', summary.currentStreak, summary.currentStreak === null || summary.currentStreak === undefined ? null : `${summary.currentStreak} days`);
  optionalStat('longest-streak', summary.longestStreak, summary.longestStreak === null || summary.longestStreak === undefined ? null : `${summary.longestStreak} days`);
  optionalStat('longest-turn', summary.longestRunningTurnSec, metrics.duration(summary.longestRunningTurnSec));
  optionalStat('active-days', daily.length ? derived.activeDays : null);
  byId('active-days-card').title = `${derived.sixMonthStart} – ${derived.endDate}; counts only supplied buckets with tokens > 0`;
  renderLimits(); renderTrendChart(); renderHeatmap(); renderStatus();
}
function applyStats(stats) { state.stats = stats; render(); }
function applyTheme(theme = 'system') {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.appearance = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  setText('theme-toggle', { system: '◐', dark: '☾', light: '☀' }[theme]);
  byId('theme-toggle').title = `Theme: ${metrics.planLabel(theme)}`; byId('theme-toggle').setAttribute('aria-label', byId('theme-toggle').title);
}
function applySettings(settings) {
  state.settings = settings; applyTheme(settings.theme);
  byId('pin-toggle').setAttribute('aria-pressed', String(settings.alwaysOnTop)); byId('pin-toggle').classList.toggle('active', settings.alwaysOnTop);
  byId('opacity').value = Math.round(settings.opacity * 100); setText('opacity-value', `${byId('opacity').value}%`);
  byId('refresh-interval').value = settings.refreshIntervalSec ?? 300;
}
async function updateSettings(patch) { applySettings(await api.settings.update(patch)); }
function setSettingsOpen(open) {
  byId('settings-popover').hidden = !open; byId('settings-trigger').setAttribute('aria-expanded', String(open));
  if (open) byId('opacity').focus(); else byId('settings-trigger').focus();
}
async function refreshOfficial() {
  byId('refresh').disabled = true;
  try { applyStats(await api.stats.refresh()); }
  catch (error) { byId('error').hidden = false; setText('error', 'Official data temporarily unavailable: ' + error.message); }
  finally { byId('refresh').disabled = false; }
}
byId('refresh').addEventListener('click', refreshOfficial);
byId('theme-toggle').addEventListener('click', () => { const themes = ['system', 'dark', 'light']; updateSettings({ theme: themes[(themes.indexOf(state.settings?.theme || 'system') + 1) % themes.length] }); });
byId('pin-toggle').addEventListener('click', () => updateSettings({ alwaysOnTop: !state.settings?.alwaysOnTop }));
byId('opacity').addEventListener('input', (event) => setText('opacity-value', `${event.target.value}%`));
byId('opacity').addEventListener('change', (event) => updateSettings({ opacity: Number(event.target.value) / 100 }));
byId('refresh-interval').addEventListener('change', (event) => updateSettings({ refreshIntervalSec: Number(event.target.value) }));
byId('settings-trigger').addEventListener('click', () => setSettingsOpen(byId('settings-popover').hidden));
byId('settings-close').addEventListener('click', () => setSettingsOpen(false));
byId('diagnostics-toggle').addEventListener('click', () => { const details = byId('status-details'); details.hidden = !details.hidden; byId('diagnostics-toggle').setAttribute('aria-expanded', String(!details.hidden)); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !byId('settings-popover').hidden) setSettingsOpen(false); });
document.addEventListener('pointerdown', (event) => { if (!byId('settings-popover').hidden && !byId('settings-popover').contains(event.target) && !byId('settings-trigger').contains(event.target)) setSettingsOpen(false); });
byId('minimize').addEventListener('click', () => api.window.minimize()); byId('hide').addEventListener('click', () => api.window.hide());
byId('collapse').addEventListener('click', async () => { setSettingsOpen(false); await api.window.collapse(); byId('app').hidden = true; byId('compact').hidden = false; });
byId('expand').addEventListener('click', async () => { await api.window.expand(); byId('compact').hidden = true; byId('app').hidden = false; });
api.stats.onChanged(applyStats);
Promise.all([api.stats.get(), api.settings.get()]).then(([stats, settings]) => { applySettings(settings); applyStats(stats); });
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(state.settings?.theme)); window.addEventListener('resize', renderHeatmap);
// Relative labels and calendar aggregates update without an RPC request.
setInterval(render, 60000);
