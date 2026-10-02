'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activity, duration, resetTime, planLabel } = require('../../src/shared/usageMetrics');
const { mapUsage } = require('../../src/shared/officialUsage');
const now = new Date(2026, 9, 2, 18, 0);
const summary = { lifetimeTokens: 1000, peakDailyTokens: 900, currentStreakDays: 2, longestStreakDays: 3, longestRunningTurnSec: null };
test('Today is only the exact local official bucket and never falls back to local counts', () => {
  const daily = [{ date: '2026-10-01', tokens: 10 }, { date: '2026-10-02', tokens: 0 }];
  assert.equal(activity(daily, now).today, 0);
  assert.equal(activity(daily.slice(0, 1), now).today, undefined);
  const result = mapUsage({ summary, dailyUsageBuckets: null, today: 123, sessions: { tokens: 999 } }, now);
  assert.equal(result.periods.today.totalTokens, undefined);
});
test('MTD excludes other months and future days and marks incomplete calendar coverage partial', () => {
  const daily = [{ date: '2026-09-30', tokens: 900 }, { date: '2026-10-01', tokens: 10 }, { date: '2026-10-02', tokens: 0 }, { date: '2026-10-03', tokens: 100 }];
  assert.deepEqual(activity(daily, now).month, { tokens: 10, partial: false, startDate: '2026-10-01', endDate: '2026-10-02' });
  assert.equal(activity(daily.slice(2), now).month.partial, true);
  assert.equal(activity(daily.slice(0, 1), now).month, null);
  const later = new Date(2026, 9, 3);
  assert.equal(activity(daily.slice(1, 3), later).month.partial, true);
  assert.equal(activity([{ date: '2026-10-01', tokens: Number.MAX_SAFE_INTEGER }, { date: '2026-10-02', tokens: 1 }], now).month, null);
});
test('Active Days counts positive supplied buckets within the same six calendar months as heatmap', () => {
  assert.equal(activity([{ date: '2026-04-30', tokens: 10 }, { date: '2026-05-01', tokens: 1 }, { date: '2026-10-01', tokens: 0 }, { date: '2026-10-02', tokens: 12 }, { date: '2026-10-03', tokens: 20 }], now).activeDays, 2);
});
test('last 28 buckets preserve zero-token days in order', () => {
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, tokens: i % 2 }));
  const trend = activity(daily, now).trend;
  assert.equal(trend.length, 28); assert.equal(trend[0].date, '2026-09-03'); assert.equal(trend[0].tokens, 0);
});
test('turn duration, plan and relative resets retain null and use local full reset time', () => {
  assert.equal(duration(1122), '18m 42s'); assert.equal(duration(3840), '1h 04m'); assert.equal(duration(0), '0s'); assert.equal(duration(null), null);
  assert.equal(planLabel('pro'), 'Pro'); assert.equal(planLabel(null), null);
  assert.equal(resetTime(null, now), null);
  const seconds = now.getTime() / 1000 + (2 * 60 + 14) * 60;
  assert.equal(resetTime(seconds, now).text, 'Resets in 2h 14m');
  assert.match(resetTime(seconds, now).title, /Oct 2, 2026/); assert.match(resetTime(seconds, now).title, /20:14/);
  assert.equal(resetTime(now.getTime() / 1000 + (3 * 24 + 8) * 3600, now).text, 'Resets in 3d 8h');
  assert.equal(resetTime(now.getTime() / 1000, now).text, 'Reset time passed');
});
