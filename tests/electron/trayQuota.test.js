'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { quotaPresentation, createTrayQuota } = require('../../src/electron/trayQuota');

function snapshot(remaining = 71) {
  return { limits: [{ id: 'codex', windows: [
    { windowDurationMins: 300, remainingPercent: remaining, resetsAt: 1792886400 },
    { windowDurationMins: 10080, remainingPercent: 23, resetsAt: null }
  ] }], errors: {}, limitsUpdatedAt: '2026-10-25T00:00:00Z' };
}

test('quota uses official 5h remaining, preserves zero and distinguishes missing/ambiguous windows', () => {
  assert.equal(quotaPresentation(snapshot(71.9)).value, 71);
  assert.equal(quotaPresentation(snapshot(0)).value, 0);
  assert.equal(quotaPresentation(snapshot(100)).value, 100);
  assert.equal(quotaPresentation(snapshot(null)).value, null);
  assert.equal(quotaPresentation(snapshot(NaN)).value, null);
  assert.equal(quotaPresentation(null).value, null);
  const data = snapshot();
  data.limits[0].windows.shift();
  assert.equal(quotaPresentation(data).value, null);
  data.limits = [{ id: 'a', windows: snapshot(12).limits[0].windows }, { id: 'b', windows: snapshot(99).limits[0].windows }];
  assert.equal(quotaPresentation(data).value, null);
  data.limits.push(snapshot(71).limits[0]);
  assert.equal(quotaPresentation(data).value, 71);
});

test('staleness follows the limits endpoint independently and tooltip includes both windows', () => {
  const data = snapshot();
  data.errors.usage = { code: 'timeout' };
  assert.equal(quotaPresentation(data).stale, false);
  data.errors.limits = { code: 'timeout' };
  const result = quotaPresentation(data);
  assert.equal(result.value, 71);
  assert.equal(result.stale, true);
  assert.match(result.tooltip, /5h 71% left.*resets/);
  assert.match(result.tooltip, /Weekly 23% left/);
  assert.match(result.tooltip, /showing last known data/);
  assert.match(result.tooltip, /Limits updated/);
});

test('hidden refreshes update tray image; show restores portrait; taskbar is never changed', () => {
  const icons = []; const tips = []; let hidden = true; let destroyed = false;
  const tray = { isDestroyed: () => destroyed,
    setImage: (icon) => icons.push(icon), setToolTip: (tip) => tips.push(tip) };
  const controller = createTrayQuota({ portrait: 'portrait.ico', platform: 'win32' });
  const update = (data) => controller.update(tray, data, hidden);
  update(snapshot());
  assert.equal(path.basename(icons.at(-1)), '71.ico');
  update(snapshot());
  assert.equal(icons.length, 1);
  update(snapshot(0));
  assert.equal(path.basename(icons.at(-1)), '0.ico');
  const stale = snapshot(0); stale.errors.limits = {};
  update(stale);
  assert.equal(path.basename(icons.at(-1)), '0-stale.ico');
  update(null);
  assert.equal(path.basename(icons.at(-1)), 'unknown.ico');
  hidden = false;
  update(snapshot());
  assert.equal(icons.at(-1), 'portrait.ico');
  assert.match(tips.at(-1), /Codex Usage HUD\n5h 71% left/);
  const count = icons.length;
  destroyed = true; update(snapshot());
  destroyed = false;
  createTrayQuota({ portrait: 'portrait.ico', platform: 'darwin' }).update(tray, snapshot(), true);
  assert.equal(icons.length, count);
});

test('all normal/stale quota ICOs include valid PNG frames for Windows DPI sizes', () => {
  for (const value of [...Array.from({ length: 101 }, (_, index) => index), 'unknown']) {
    for (const suffix of ['', '-stale']) {
      const ico = fs.readFileSync(path.join(__dirname, `../../assets/tray-quotas/${value}${suffix}.ico`));
      assert.equal(ico.readUInt16LE(0), 0);
      assert.equal(ico.readUInt16LE(2), 1);
      assert.equal(ico.readUInt16LE(4), 7);
      for (const [index, size] of [16, 20, 24, 32, 40, 48, 64].entries()) {
        const entry = 6 + index * 16;
        assert.equal(ico[entry], size); assert.equal(ico[entry + 1], size);
        const offset = ico.readUInt32LE(entry + 12);
        const length = ico.readUInt32LE(entry + 8);
        assert.ok(offset + length <= ico.length);
        assert.equal(ico.readUInt32BE(offset), 0x89504e47);
        assert.equal(ico.readUInt32BE(offset + 16), size);
        assert.equal(ico.readUInt32BE(offset + 20), size);
      }
    }
  }
  const manifest = require('../../package.json');
  assert.ok(manifest.build.files.includes('assets/tray-quotas/*.ico'));
});
