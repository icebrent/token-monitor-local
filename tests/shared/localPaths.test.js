'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertCanonicalPathWithin,
  assertLocalPath,
  comparablePath,
  fixedCodexRoots,
  isWindowsNetworkPath,
  isWithinRoot
} = require('../../src/shared/localPaths');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-offline-paths-'));
}

test('fixedCodexRoots canonicalizes CODEX_HOME once and fixes the sessions root', () => {
  const root = tempRoot();
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const resolved = fixedCodexRoots({ env: { CODEX_HOME: codexHome }, homeDir: root });
  assert.equal(resolved.codexHome, fs.realpathSync.native(codexHome));
  assert.equal(resolved.sessionsRoot, fs.realpathSync.native(sessions));
  assert.ok(Object.isFrozen(resolved));
});

test('renderer-style traversal cannot escape the canonical sessions root', () => {
  const root = tempRoot();
  const sessions = path.join(root, 'sessions');
  const outside = path.join(root, 'outside.jsonl');
  fs.mkdirSync(sessions);
  fs.writeFileSync(outside, '');
  assert.throws(
    () => assertCanonicalPathWithin(sessions, path.join(sessions, '..', 'outside.jsonl')),
    /escapes/
  );
});

test('symbolic links and Windows junctions cannot escape the sessions root', (t) => {
  const root = tempRoot();
  const sessions = path.join(root, 'sessions');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(sessions);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'session.jsonl'), '');

  const kinds = process.platform === 'win32' ? ['file', 'junction'] : ['file', 'dir'];
  for (const kind of kinds) {
    const link = path.join(sessions, `escape-${kind}`);
    const target = kind === 'file' ? path.join(outside, 'session.jsonl') : outside;
    try {
      fs.symlinkSync(target, link, kind);
    } catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
        t.diagnostic(`symlink kind ${kind} unavailable: ${error.code}`);
        continue;
      }
      throw error;
    }
    assert.throws(() => assertCanonicalPathWithin(sessions, link), /escapes/);
  }
});

test('Windows UNC and network paths are rejected including extended UNC', () => {
  for (const value of ['\\\\server\\share\\codex', '//server/share/codex', '\\\\?\\UNC\\server\\share\\codex']) {
    assert.equal(isWindowsNetworkPath(value), true);
    assert.throws(() => assertLocalPath(value, 'win32', 'CODEX_HOME'), /UNC or network/);
  }
});

test('Windows local extended paths and case differences compare within the same root', () => {
  assert.equal(comparablePath('C:\\Users\\ICE\\.codex\\sessions', 'win32'), 'c:\\users\\ice\\.codex\\sessions');
  assert.equal(comparablePath('\\\\?\\C:\\Users\\ice\\.codex\\sessions', 'win32'), 'c:\\users\\ice\\.codex\\sessions');
  assert.equal(
    isWithinRoot('C:\\Users\\ICE\\.codex\\sessions', 'c:\\users\\ice\\.codex\\sessions\\2026\\a.jsonl', 'win32'),
    true
  );
  assert.equal(
    isWithinRoot('C:\\Users\\ice\\.codex\\sessions', 'C:\\Users\\ice\\.codex\\sessions-escape\\a.jsonl', 'win32'),
    false
  );
});
