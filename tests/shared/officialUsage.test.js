'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapUsage, mapRateLimits, OfficialUsageStore } = require('../../src/shared/officialUsage');
const usage = {
  summary: { lifetimeTokens: 123456, peakDailyTokens: 9000, currentStreakDays: 2, longestStreakDays: 10, longestRunningTurnSec: 123 },
  dailyUsageBuckets: [{ startDate: '2026-10-01', tokens: 9000 }, { startDate: '2026-10-02', tokens: 400 }]
};
const window = { usedPercent: 23, windowDurationMins: 300, resetsAt: 1791000000 };
const limits = { rateLimits: { primary: window, secondary: null }, rateLimitsByLimitId: { codex: { limitName: 'Codex', primary: window, secondary: { ...window, windowDurationMins: 10080 } } } };

test('official summary maps directly without recalculating totals or streaks', () => {
  const model = mapUsage(usage, new Date(2026, 9, 2));
  assert.equal(model.periods.allTime.totalTokens, 123456);
  assert.equal(model.periods.today.totalTokens, 400);
  assert.equal(model.history.summary.peakDayTokens, 9000);
  assert.equal(model.history.summary.currentStreak, 2);
  assert.equal(model.history.summary.longestStreak, 10);
  assert.equal(model.history.daily[0].tokens, 9000);
  assert.equal(model.periods.allTime.models, undefined);
  assert.deepEqual(model.periods.month, { totalTokens: 9400, partial: false });
});

test('missing daily buckets or today never become zero or local estimates; null remains null', () => {
  const model = mapUsage({ ...usage, dailyUsageBuckets: null, summary: { ...usage.summary, lifetimeTokens: null } });
  assert.equal(model.periods.today.totalTokens, undefined);
  assert.equal(model.periods.allTime.totalTokens, null);
  assert.equal(model.history.dailyAvailable, false);
  assert.equal(mapUsage(usage, new Date(2026, 9, 3)).periods.today.totalTokens, undefined);
});

test('multi-bucket and legacy rate limits retain windows and official reset seconds', () => {
  const mapped = mapRateLimits(limits);
  assert.equal(mapped[0].windows.length, 2);
  assert.equal(mapped[0].windows[0].usedPercent, 23);
  assert.equal(mapped[0].windows[0].remainingPercent, 77);
  assert.equal(mapped[0].windows[0].resetsAt, window.resetsAt);
  assert.equal(mapRateLimits({ rateLimits: limits.rateLimits, rateLimitsByLimitId: null })[0].windows.length, 1);
});

test('malformed or unsafe counts do not silently round or display zero', () => {
  for (const value of [-1, '12', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => mapUsage({ ...usage, summary: { ...usage.summary, lifetimeTokens: value } }), { code: 'malformed_rpc' });
  }
  assert.throws(() => mapUsage({}), { code: 'malformed_rpc' });
  assert.throws(() => mapRateLimits({ rateLimits: { primary: { ...window, usedPercent: '23' } } }), { code: 'malformed_rpc' });
});

test('refresh deduplicates, preserves success on failure, and never falls back', async () => {
  let calls = 0; let fail = false;
  let now = new Date(2026, 9, 2, 10);
  const client = { getAccountUsage: async () => { calls++; if (fail) throw Object.assign(new Error('Unavailable'), { code: 'timeout' }); return usage; }, getRateLimits: async () => { if (fail) throw new Error('Unavailable'); return limits; } };
  const store = new OfficialUsageStore(client, { now: () => now });
  const one = store.refresh(); assert.equal(store.refresh(), one); await one;
  assert.equal(calls, 1); assert.equal(store.snapshot.source, 'Official');
  const success = store.snapshot;
  await store.refreshOnShow(); assert.equal(calls, 1);
  now = new Date(now.getTime() + 120001); fail = true; await store.refreshOnShow();
  assert.equal(calls, 2); assert.equal(store.snapshot.periods, success.periods);
  assert.equal(store.snapshot.collectedAt, success.collectedAt); assert.equal(store.snapshot.status, 'stale');
  assert.equal(store.snapshot.errors.usage.code, 'timeout');
  const empty = new OfficialUsageStore(client); await empty.refresh();
  assert.equal(empty.snapshot.status, 'error'); assert.deepEqual(empty.snapshot.periods, {});
});

test('usage and limits succeed independently and retain separate fetch times', async () => {
  const store = new OfficialUsageStore({ getAccountUsage: async () => { throw new Error('failed'); }, getRateLimits: async () => limits });
  await store.refresh(); assert.equal(store.snapshot.limits.length, 1);
  assert.deepEqual(store.snapshot.periods, {}); assert.ok(store.snapshot.limitsUpdatedAt);
  assert.equal(store.snapshot.usageUpdatedAt, undefined);
});

test('schema plan, permission, reset credits and limit statuses map and survive endpoint failures', async () => {
  let fail = false;
  const response = { rateLimits: { planType: 'pro', primary: window, normalModelSlug: 'gpt-5', rateLimitReachedType: 'rate_limit_reached', spendControlReached: true,
    credits: { hasCredits: true, unlimited: false, balance: '12.40' }, individualLimit: { limit: '20', used: '5', remainingPercent: 75, resetsAt: window.resetsAt } },
    rateLimitsByLimitId: null, ordinaryUsageAllowed: false, rateLimitResetCredits: { availableCount: 2, credits: null } };
  const store = new OfficialUsageStore({ connectionStatus: 'connected', getAccountUsage: async () => usage, getRateLimits: async () => { if (fail) throw new Error('failed'); return response; } });
  await store.refresh();
  assert.equal(store.snapshot.planType, 'pro'); assert.equal(store.snapshot.ordinaryUsageAllowed, false);
  assert.equal(store.snapshot.rateLimitResetCredits.availableCount, 2);
  assert.equal(store.snapshot.limits[0].normalModelSlug, 'gpt-5');
  assert.equal(store.snapshot.limits[0].spendControlReached, true);
  assert.equal(store.snapshot.limits[0].rateLimitReachedType, 'rate_limit_reached');
  assert.deepEqual(store.snapshot.limits[0].credits, response.rateLimits.credits);
  const previous = store.snapshot; fail = true; await store.refresh();
  assert.equal(store.snapshot.limits, previous.limits); assert.equal(store.snapshot.planType, previous.planType);
  assert.equal(store.snapshot.rateLimitResetCredits, previous.rateLimitResetCredits);
  assert.equal(store.snapshot.limitsUpdatedAt, previous.limitsUpdatedAt);
});
