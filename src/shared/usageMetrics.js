'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.codexUsageMetrics = api;
}(typeof window !== 'undefined' ? window : null, function createMetrics() {
  function localDate(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  function activity(daily, now = new Date()) {
    const today = localDate(now);
    const monthStart = `${today.slice(0, 7)}-01`;
    const sixMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 5, 1)).toISOString().slice(0, 10);
    const rows = daily.filter((day) => day.date <= today);
    const month = rows.filter((day) => day.date >= monthStart);
    const dates = new Set(month.map((day) => day.date));
    const monthTokens = month.reduce((sum, day) => sum + day.tokens, 0);
    return {
      today: rows.find((day) => day.date === today)?.tokens,
      month: month.length && Number.isSafeInteger(monthTokens) ? {
        tokens: monthTokens, partial: dates.size !== now.getDate(), startDate: monthStart, endDate: today
      } : null,
      activeDays: rows.filter((day) => day.date >= sixMonthStart && day.tokens > 0).length,
      sixMonthStart, endDate: today, trend: rows.slice(-28)
    };
  }
  function duration(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    if (minutes) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
    return `${seconds}s`;
  }
  function resetTime(seconds, now = new Date()) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
    const reset = new Date(seconds * 1000);
    if (!Number.isFinite(reset.getTime())) return null;
    const minutes = Math.ceil((reset.getTime() - now.getTime()) / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    const text = minutes <= 0 ? 'Reset time passed' : days ? `Resets in ${days}d ${hours}h`
      : hours ? `Resets in ${hours}h ${minutes % 60}m` : `Resets in ${minutes}m`;
    return { text, title: reset.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) };
  }
  function planLabel(plan) {
    return typeof plan === 'string' && plan ? plan.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') : null;
  }
  return { activity, localDate, duration, resetTime, planLabel };
}));
