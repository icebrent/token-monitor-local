'use strict';

(function exposeTokenTransition() {
  function positiveDelta(previous, next) {
    const from = Number(previous);
    const to = Number(next);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    return { from, to, delta: to - from };
  }

  function merge(current, next) {
    if (!current) return next;
    return positiveDelta(current.from, next?.to);
  }

  window.codexTokenTransition = Object.freeze({ merge, positiveDelta });
}());
