'use strict';

const path = require('node:path');

function quotaPresentation(snapshot) {
  const buckets = snapshot?.limits || [];
  const bucket = buckets.find((entry) => entry.id === 'codex') || (buckets.length === 1 ? buckets[0] : null);
  const windows = bucket?.windows || [];
  const selected = windows.find((entry) => entry.windowDurationMins === 300);
  const remaining = selected?.remainingPercent;
  const value = typeof remaining === 'number' && Number.isFinite(remaining)
    ? Math.floor(Math.min(100, Math.max(0, remaining))) : null;
  const stale = Boolean(snapshot?.errors?.limits);
  const details = [300, 10080].flatMap((duration) => {
    const window = windows.find((entry) => entry.windowDurationMins === duration);
    if (!Number.isFinite(window?.remainingPercent)) return [];
    const label = duration === 300 ? '5h' : 'Weekly';
    const reset = Number.isFinite(window.resetsAt) ? ` (resets ${new Date(window.resetsAt * 1000).toLocaleString()})` : '';
    return [`${label} ${Math.floor(Math.min(100, Math.max(0, window.remainingPercent)))}% left${reset}`];
  });
  const updated = snapshot?.limitsUpdatedAt ? new Date(snapshot.limitsUpdatedAt).toLocaleString() : '';
  return {
    value, stale,
    tooltip: [value === null ? '5h limits unavailable' : '', ...details,
      stale ? 'Limits update failed; showing last known data' : '', updated ? `Limits updated ${updated}` : ''].filter(Boolean).join('\n')
  };
}

function createTrayQuota({ portrait, platform = process.platform }) {
  let lastKey;
  return {
    update(tray, snapshot, hidden) {
      if (platform !== 'win32' || tray.isDestroyed()) return;
      const presentation = quotaPresentation(snapshot);
      const key = hidden ? `${presentation.value}:${presentation.stale}` : 'portrait';
      if (key !== lastKey) {
        if (hidden) {
          const name = `${presentation.value ?? 'unknown'}${presentation.stale ? '-stale' : ''}.ico`;
          tray.setImage(path.join(__dirname, '../../assets/tray-quotas', name));
        } else tray.setImage(portrait);
        lastKey = key;
      }
      tray.setToolTip(`Codex Usage HUD\n${presentation.tooltip}`);
    }
  };
}

module.exports = { quotaPresentation, createTrayQuota };
