'use strict';

(function exposeModelRows(root) {
  const MAX_MODEL_ROWS = 5;

  function topWithOther(entries, topCount, otherLabel = 'Other') {
    const rows = Array.isArray(entries) ? entries : [];
    if (rows.length <= topCount) return rows;
    const otherTokens = rows.slice(topCount)
      .reduce((sum, [, tokens]) => sum + (Number(tokens) || 0), 0);
    return [...rows.slice(0, topCount), [otherLabel, otherTokens]];
  }

  function from(models) {
    const entries = Object.entries(models || {})
      .map(([model, tokens]) => [model, Number(tokens) || 0])
      .sort((a, b) => b[1] - a[1]);
    if (entries.length <= MAX_MODEL_ROWS) return entries;
    return topWithOther(entries, MAX_MODEL_ROWS - 1);
  }

  root.codexModelRows = Object.freeze({ from, topWithOther });
})(window);
