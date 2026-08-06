'use strict';

(function exposeSessionRows(root) {
  const MAX_SESSION_ROWS = 5;

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dominantModel(session) {
    return Object.entries(session?.models || {})
      .sort((a, b) => number(b[1]) - number(a[1]))[0]?.[0] || 'unknown';
  }

  function from(sessions) {
    const entries = Object.values(sessions || {})
      .sort((a, b) => String(b?.lastUsedAt || '').localeCompare(String(a?.lastUsedAt || '')));
    const direct = entries.length > MAX_SESSION_ROWS
      ? entries.slice(0, MAX_SESSION_ROWS - 1)
      : entries;
    const rows = direct.map((session) => ({
      label: session.projectLabel || 'Codex session',
      model: dominantModel(session),
      sessionCount: 1,
      tokens: number(session.totalTokens),
      isOther: false
    }));
    if (entries.length > MAX_SESSION_ROWS) {
      const other = entries.slice(MAX_SESSION_ROWS - 1);
      rows.push({
        label: 'Other',
        model: '',
        sessionCount: other.length,
        tokens: other.reduce((sum, session) => sum + number(session.totalTokens), 0),
        isOther: true
      });
    }
    return rows;
  }

  root.codexSessionRows = Object.freeze({ from });
})(window);
