'use strict';

const { activity } = require('./usageMetrics');

function failure(code, message) { return Object.assign(new Error(message), { code }); }

function count(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw failure('malformed_rpc', 'Invalid official usage count');
  return value;
}

function mapUsage(response, now = new Date()) {
  if (!response?.summary || !(response.dailyUsageBuckets === null || Array.isArray(response.dailyUsageBuckets))) {
    throw failure('malformed_rpc', 'Invalid account usage response');
  }
  const summary = response.summary;
  const totalTokens = count(summary.lifetimeTokens);
  const daily = response.dailyUsageBuckets?.map((bucket) => {
    if (!bucket || !/^\d{4}-\d{2}-\d{2}$/.test(bucket.startDate) || !Number.isFinite(Date.parse(bucket.startDate))
      || new Date(bucket.startDate).toISOString().slice(0, 10) !== bucket.startDate) throw failure('malformed_rpc', 'Invalid daily usage date');
    const tokens = count(bucket.tokens);
    if (tokens === null) throw failure('malformed_rpc', 'Invalid daily usage tokens');
    return { date: bucket.startDate, tokens };
  }) || [];
  daily.sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(daily.map((day) => day.date)).size !== daily.length) throw failure('malformed_rpc', 'Duplicate daily usage date');
  const metrics = activity(daily, now);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    summary: { ...summary },
    periods: { allTime: { totalTokens }, today: daily.some((day) => day.date === today) ? { totalTokens: daily.find((day) => day.date === today).tokens } : {},
      month: metrics.month ? { totalTokens: metrics.month.tokens, partial: metrics.month.partial } : {} },
    history: { daily, dailyAvailable: response.dailyUsageBuckets !== null, summary: {
      totalTokens, peakDayTokens: count(summary.peakDailyTokens ?? null),
      currentStreak: count(summary.currentStreakDays ?? null), longestStreak: count(summary.longestStreakDays ?? null),
      longestRunningTurnSec: count(summary.longestRunningTurnSec ?? null)
    } }
  };
}

function mapRateLimits(response) {
  if (!response || typeof response.rateLimits !== 'object' || !response.rateLimits) throw failure('malformed_rpc', 'Invalid rate limits response');
  const buckets = response.rateLimitsByLimitId;
  if (buckets !== null && buckets !== undefined && (typeof buckets !== 'object' || Array.isArray(buckets))) throw failure('malformed_rpc', 'Invalid rate limit buckets');
  const entries = buckets && Object.keys(buckets).length ? Object.entries(buckets) : [[response.rateLimits.limitId || 'codex', response.rateLimits]];
  return entries.map(([id, bucket]) => {
    if (!bucket || typeof bucket !== 'object') throw failure('malformed_rpc', 'Invalid rate limit bucket');
    const windows = ['primary', 'secondary'].flatMap((key) => {
      const window = bucket[key];
      if (window === null || window === undefined) return [];
      if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)
        || !(window.windowDurationMins === null || Number.isFinite(window.windowDurationMins))
        || !(window.resetsAt === null || Number.isFinite(window.resetsAt))) throw failure('malformed_rpc', 'Invalid rate limit window');
      return [{ key, ...window, remainingPercent: Math.min(100, Math.max(0, 100 - window.usedPercent)) }];
    });
    return { id, name: bucket.limitName || id, windows, credits: bucket.credits ?? null, individualLimit: bucket.individualLimit ?? null,
      planType: bucket.planType ?? null, normalModelSlug: bucket.normalModelSlug ?? null,
      spendControlReached: bucket.spendControlReached ?? null, rateLimitReachedType: bucket.rateLimitReachedType ?? null };
  });
}

function emptyOfficial() {
  return { source: 'Official', collectedAt: '', periods: {}, history: { daily: [], summary: {} }, limits: [], planType: null,
    ordinaryUsageAllowed: null, rateLimitResetCredits: null, cliStatus: 'disconnected', refreshIntervalSec: 300,
    status: 'loading', error: '', errors: {} };
}

class OfficialUsageStore {
  constructor(client, { now = () => new Date() } = {}) {
    this.client = client; this.now = now; this.snapshot = emptyOfficial(); this.inFlight = null;
  }
  refresh() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetch().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async fetch() {
    const errors = {};
    const results = await Promise.allSettled([this.client.getAccountUsage(), this.client.getRateLimits()]);
    const next = { ...this.snapshot };
    let successes = 0;
    for (const [index, result] of results.entries()) {
      const key = index === 0 ? 'usage' : 'limits';
      try {
        if (result.status === 'rejected') throw result.reason;
        if (index === 0) { Object.assign(next, mapUsage(result.value, this.now())); next.usageUpdatedAt = this.now().toISOString(); }
        else {
          const limits = mapRateLimits(result.value);
          const resetCredits = result.value.rateLimitResetCredits ?? null;
          if (resetCredits && count(resetCredits.availableCount) === null) throw failure('malformed_rpc', 'Invalid reset credit count');
          next.limits = limits;
          next.planType = result.value.rateLimits.planType ?? limits.find((bucket) => bucket.planType)?.planType ?? null;
          next.ordinaryUsageAllowed = result.value.ordinaryUsageAllowed ?? null;
          next.rateLimitResetCredits = resetCredits;
          next.limitsUpdatedAt = this.now().toISOString();
        }
        successes++;
      } catch (error) { errors[key] = { code: error.code || 'endpoint_failed', message: error.message }; }
    }
    if (successes) next.collectedAt = this.now().toISOString();
    next.errors = errors;
    next.cliStatus = this.client.connectionStatus || 'unavailable';
    next.status = Object.keys(errors).length ? (next.collectedAt ? 'stale' : 'error') : 'ready';
    next.error = Object.entries(errors).map(([key, error]) => `${key === 'usage' ? 'Official usage unavailable' : 'Official limits unavailable'} (${error.code}): ${error.message}. Retry with Refresh.`).join(' ');
    this.snapshot = next;
    return next;
  }
  refreshOnShow() {
    if (!this.snapshot.collectedAt || this.now().getTime() - Date.parse(this.snapshot.collectedAt) > 120000) return this.refresh();
    return Promise.resolve(this.snapshot);
  }
}

module.exports = { mapUsage, mapRateLimits, emptyOfficial, OfficialUsageStore };
