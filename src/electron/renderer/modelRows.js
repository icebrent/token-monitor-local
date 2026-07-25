'use strict';

(function exposeModelRows(root) {
  const MAX_MODEL_ROWS = 6;

  function from(models) {
    const entries = Object.entries(models || {})
      .map(([model, tokens]) => [model, Number(tokens) || 0])
      .sort((a, b) => b[1] - a[1]);
    if (entries.length <= MAX_MODEL_ROWS) return entries;
    const otherTokens = entries.slice(MAX_MODEL_ROWS - 1)
      .reduce((sum, [, tokens]) => sum + tokens, 0);
    return [...entries.slice(0, MAX_MODEL_ROWS - 1), ['其他', otherTokens]];
  }

  root.codexModelRows = Object.freeze({ from });
})(window);
