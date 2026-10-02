'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mapUsage, mapRateLimits, emptyOfficial } = require('../../src/shared/officialUsage');

const directory = path.join(__dirname, '../../src/electron');
function renderer() {
  const elements = new Map();
  const html = fs.readFileSync(path.join(directory, 'renderer/index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const make = () => ({ textContent: '', hidden: false, style: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; }, listeners: {}, attributes: {}, addEventListener(event, handler) { this.listeners[event] = handler; }, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, getBoundingClientRect() { return { width: 150, height: 50 }; }, focus() {} });
  const get = (id) => { assert.ok(ids.has(id), 'Missing real DOM id: ' + id); if (!elements.has(id)) elements.set(id, make()); return elements.get(id); };
  let changed;
  let exposed; let settings = { opacity: 0.94, theme: 'system', alwaysOnTop: true, refreshIntervalSec: 300 };
  const ipcRenderer = { invoke: async (channel, patch) => {
    if (channel === 'usage:getOfficial') return emptyOfficial();
    if (channel === 'settings:get') return settings;
    if (channel === 'settings:update') return settings = { ...settings, ...patch };
  }, on: (channel, listener) => { if (channel === 'stats:changed') changed = listener; }, removeListener() {}, send() {} };
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'preload.js'), 'utf8'), {
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_, api) => { exposed = api; } } })
  });
  const window = { codexOffline: exposed, innerWidth: 450, innerHeight: 620, addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }) };
  const context = vm.createContext({ window, document: { getElementById: get, createElement: make, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} } },
    Intl, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} });
  for (const file of ['../../shared/usageMetrics.js', 'analysis.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(directory, 'renderer', file), 'utf8'), context);
  return { context, get, changed: (snapshot) => changed({}, snapshot) };
}

test('official IPC payload renders compact lifetime, remaining limits, streaks and client fetch time', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  const snapshot = { ...emptyOfficial(), ...mapUsage({ summary: { lifetimeTokens: 987654, peakDailyTokens: 500, currentStreakDays: 3, longestStreakDays: 7, longestRunningTurnSec: null }, dailyUsageBuckets: [{ startDate: '2026-10-02', tokens: 123 }] }),
    status: 'ready', collectedAt: '2026-10-02T01:00:00Z',
    limits: mapRateLimits({ rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null }, secondary: null }, rateLimitsByLimitId: null }) };
  ui.changed(snapshot);
  assert.equal(ui.get('total').textContent, '987.65K');
  assert.equal(ui.get('compact-quota').textContent, '5h 80%');
  assert.equal(ui.get('today-card').hidden, require('../../src/shared/usageMetrics').localDate() !== '2026-10-02');
  assert.match(ui.get('updated').textContent, /^· Updated \d\d:\d\d$/);
  assert.equal(ui.get('limits').children[0].children[1].textContent, '80% LEFT');
  assert.equal(ui.get('limits').children[0].children[3].textContent, '20% used');
  assert.equal(ui.get('current-streak').textContent, '3 days');
  assert.equal(ui.get('longest-streak').textContent, '7 days');
  assert.equal(ui.get('peak-day').textContent, '500');
});

test('unavailable official usage displays no calculated total, stale keeps official values', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  ui.changed({ ...emptyOfficial(), status: 'error', error: 'Official usage unavailable' });
  assert.equal(ui.get('total-card').hidden, true); assert.equal(ui.get('compact-quota').textContent, 'Limits unavailable');
  assert.equal(ui.get('error').hidden, false);
  assert.equal(ui.get('source-status').textContent, 'Official');
  ui.changed({ ...emptyOfficial(), periods: { allTime: { totalTokens: 999 } }, status: 'stale', error: 'Official usage unavailable' });
  assert.equal(ui.get('total').textContent, '999');
  assert.equal(ui.get('source-status').textContent, 'Official');
  ui.changed({ ...emptyOfficial(), status: 'error', error: 'Official usage unavailable' });
  assert.equal(ui.get('compact-quota').textContent, 'Limits unavailable');
});

test('production main and preload use official IPC, periodic refresh and clean shutdown, never parser/watcher', () => {
  const main = fs.readFileSync(path.join(directory, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(directory, 'preload.js'), 'utf8');
  assert.match(main, /usage:getOfficial/); assert.match(main, /usage:refreshOfficial/);
  assert.match(preload, /usage:getOfficial/); assert.match(preload, /usage:refreshOfficial/);
  assert.match(main, /scheduleRefresh\(readSettings\(\)\)/);
  assert.match(main, /mainWindow\.on\('show'/); assert.match(main, /officialClient\.close\(\)/);
  assert.doesNotMatch(main, /codexJsonlParser|collectCodexUsage|chokidar|fixedCodexRoots|parseCache|startWatcher/);
});

test('optional fields hide cards; available plan, turn, credits and spending details render without guessed units', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  for (const id of ['plan-badge', 'today-card', 'month-card', 'longest-turn-card', 'credit-info', 'peak-day-card']) assert.equal(ui.get(id).hidden, true, id);
  const response = { rateLimits: { planType: 'pro', primary: { usedPercent: 63, windowDurationMins: 300, resetsAt: null }, credits: { balance: '12.40', hasCredits: true, unlimited: false },
    individualLimit: { limit: '20.00', used: '7.60', remainingPercent: 62, resetsAt: null }, normalModelSlug: 'gpt-5' },
    rateLimitsByLimitId: null };
  const snapshot = { ...emptyOfficial(), planType: 'pro', cliStatus: 'connected', status: 'ready', limits: mapRateLimits(response),
    rateLimitResetCredits: { availableCount: 2, credits: null }, history: { daily: [], summary: { longestRunningTurnSec: 1122 } } };
  ui.changed(snapshot);
  assert.equal(ui.get('plan-badge').textContent, 'Pro'); assert.equal(ui.get('plan-badge').hidden, false);
  assert.equal(ui.get('longest-turn').textContent, '18m 42s'); assert.equal(ui.get('longest-turn-card').hidden, false);
  assert.equal(ui.get('credit-info').hidden, false);
  const values = ui.get('credit-info').textContent;
  for (const value of ['12.40', '20.00', '7.60', '62%', '2 reset credits available']) assert.ok(values.includes(value), value);
  assert.ok(!values.includes('$'));
  assert.equal(ui.get('error').hidden, true); assert.equal(ui.get('limit-warning').hidden, true);
  ui.changed({ ...snapshot, limits: mapRateLimits({ rateLimits: { primary: null, credits: null, individualLimit: null } }), rateLimitResetCredits: null, planType: null,
    history: { daily: [], summary: { longestRunningTurnSec: null } } });
  for (const id of ['plan-badge', 'longest-turn-card', 'credit-info']) assert.equal(ui.get(id).hidden, true);
});

test('abnormal permissions and backend limit states show banners only when present', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  ui.changed({ ...emptyOfficial(), ordinaryUsageAllowed: false, limits: [{ name: 'Codex', windows: [], rateLimitReachedType: 'workspace_owner_credits_depleted', spendControlReached: true }] });
  assert.equal(ui.get('limit-warning').hidden, false);
  assert.match(ui.get('limit-warning').textContent, /Ordinary included usage/);
  assert.match(ui.get('limit-warning').textContent, /workspace owner credits depleted/);
  assert.match(ui.get('limit-warning').textContent, /spending limit reached/);
  ui.changed({ ...emptyOfficial(), ordinaryUsageAllowed: true });
  assert.equal(ui.get('limit-warning').hidden, true);
  ui.changed({ ...emptyOfficial(), ordinaryUsageAllowed: true, limits: [{ name: 'Codex', windows: [], credits: { hasCredits: false, unlimited: false, balance: null } }] });
  assert.equal(ui.get('limit-warning').hidden, true);
  assert.equal(ui.get('credit-info').hidden, true);
});

test('renderer derives Today and partial MTD from official buckets and preserves zero days in charts', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const first = key.slice(0, 8) + '01';
  const daily = first === key ? [{ date: key, tokens: 0 }] : [{ date: first, tokens: 10 }, { date: key, tokens: 0 }];
  ui.changed({ ...emptyOfficial(), periods: { today: { totalTokens: 99999 } }, history: { daily, dailyAvailable: true, summary: {} } });
  assert.equal(ui.get('today').textContent, '0'); assert.equal(ui.get('today-card').hidden, false);
  assert.equal(ui.get('month').textContent, first === key ? '0' : '10');
  assert.match(ui.get('month-card').title, /Calculated from official daily activity/);
  assert.equal(ui.get('daily-trend-chart').children.length, daily.length);
  assert.match(ui.get('daily-trend-chart').children.at(-1).title, /No usage/);
  assert.ok(ui.get('heatmap-chart').children.some((node) => node.title?.includes('No usage')));
  ui.changed({ ...emptyOfficial(), periods: { today: { totalTokens: 99999 } }, history: { daily: [], summary: {} } });
  assert.equal(ui.get('today-card').hidden, true); assert.equal(ui.get('month-card').hidden, true);
});

test('production renderer has no session, model, project or local composition wiring', () => {
  const html = fs.readFileSync(path.join(directory, 'renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(directory, 'renderer/app.js'), 'utf8');
  assert.doesNotMatch(html + app, /sessionRows|modelRows|renderSessions|renderModels|Input Tokens|Cached Input|Output Tokens|Reasoning Tokens|Monthly Usage|Last 28 Active Days|Top Model|Messages|data-period|data-analysis/);
  assert.match(html, /Last 28 Days/);
  for (const file of ['sessionRows.js', 'modelRows.js']) assert.equal(fs.existsSync(path.join(directory, 'renderer', file)), false);
});



test('toolbar cycles theme immediately, toggles pin, and updates refresh interval', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  for (const theme of ['Dark', 'Light', 'System']) {
    ui.get('theme-toggle').listeners.click(); await new Promise(setImmediate);
    assert.equal(ui.get('theme-toggle').title, `Theme: ${theme}`);
  }
  ui.get('pin-toggle').listeners.click(); await new Promise(setImmediate);
  assert.equal(ui.get('pin-toggle').attributes['aria-pressed'], 'false');
  ui.get('refresh-interval').listeners.change({ target: { value: '0' } }); await new Promise(setImmediate);
  assert.equal(ui.get('refresh-interval').value, 0);
  ui.get('refresh-interval').listeners.change({ target: { value: '900' } }); await new Promise(setImmediate);
  assert.equal(ui.get('refresh-interval').value, 900);
});
test('lifetime is compact with exact tooltip; mini shows both quota windows and reset details', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  ui.changed({ ...emptyOfficial(), periods: { allTime: { totalTokens: 3327514760 } }, limits: mapRateLimits({ rateLimits: {
    primary: { usedPercent: 29, windowDurationMins: 300, resetsAt: Date.now() / 1000 + 3600 },
    secondary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: Date.now() / 1000 + 86400 } } }) });
  assert.equal(ui.get('total').textContent, '3.33B'); assert.equal(ui.get('total').title, '3,327,514,760 tokens');
  assert.equal(ui.get('compact-quota').textContent, '5h 71% · W 23%');
  assert.match(ui.get('expand').title, /71% remaining/); assert.match(ui.get('expand').title, /Resets in/);
  ui.changed({ ...emptyOfficial(), periods: { allTime: { totalTokens: 168000000 } } });
  assert.equal(ui.get('total').textContent, '168M');
});
test('empty credits hide and exact heatmap tooltip follows pointer without covering cell', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  const date = require('../../src/shared/usageMetrics').localDate();
  ui.changed({ ...emptyOfficial(), history: { daily: [{ date, tokens: 16232095 }], summary: {} }, limits: [{ windows: [], credits: { balance: '0', hasCredits: false } }], rateLimitResetCredits: { availableCount: 0 } });
  assert.equal(ui.get('credit-info').hidden, true);
  const cell = ui.get('heatmap-chart').children.find((node) => node.title?.includes('16,232,095 tokens'));
  assert.ok(cell); cell.listeners.pointermove({ clientX: 100, clientY: 100 });
  assert.match(ui.get('usage-tooltip').textContent, /16,232,095 tokens/);
  assert.equal(ui.get('usage-tooltip').style.left, '114px');
  cell.listeners.pointerleave(); assert.equal(ui.get('usage-tooltip').hidden, true);
  ui.changed({ ...emptyOfficial(), rateLimitResetCredits: { availableCount: 2 } });
  assert.equal(ui.get('credit-info').hidden, false); assert.equal(ui.get('credit-info').textContent, '2 reset credits available');
});

test('mini displays only the available official quota window and sparkline hover preserves exact values', async () => {
  const ui = renderer(); await new Promise(setImmediate);
  const date = require('../../src/shared/usageMetrics').localDate();
  ui.changed({ ...emptyOfficial(), history: { daily: [{ date, tokens: 16232095 }], summary: {} }, limits: mapRateLimits({ rateLimits: { secondary: { windowDurationMins: 10080, usedPercent: 100, resetsAt: null } } }) });
  assert.equal(ui.get('compact-quota').textContent, 'W 0%');
  const point = ui.get('daily-trend-chart').children[0];
  point.listeners.pointermove({ clientX: 430, clientY: 600 });
  assert.equal(ui.get('usage-tooltip').textContent, `${date}\n16,232,095 tokens`);
  assert.equal(ui.get('usage-tooltip').style.left, '292px'); assert.equal(ui.get('usage-tooltip').style.top, '536px');
  assert.equal(ui.get('limits').children[0].children[3].textContent, '100% used');
});
