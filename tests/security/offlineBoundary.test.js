'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const sourceRoot = path.join(root, 'src');

function sourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
  return files;
}

const sources = sourceFiles(sourceRoot)
  .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));

test('runtime source has no server, socket, child process, or native addon entry', () => {
  const forbidden = [
    /require\(['"](?:node:)?(?:http|https|http2|net|tls|dgram)['"]\)/,
    /\.\s*listen\s*\(/,
    /require\(['"](?:node:)?child_process['"]\)/,
    /\b(?:spawn|execFile|fork)\s*\(/,
    /require\(['"](?:koffi|ffi-napi|node-gyp-build)['"]\)/
  ];
  for (const { file, text } of sources) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${path.relative(root, file)} matches ${pattern}`);
    }
  }
});

test('removed remote and credential subsystems have no runtime files', () => {
  for (const target of [
    'src/shared/credentialStore.js',
    'src/shared/limitCollector.js',
    'src/shared/syncPayload.js',
    'src/shared/appUpdater.js',
    'src/electron/discordRpc.js'
  ]) assert.equal(fs.existsSync(path.join(root, target)), false, target);
  for (const directory of ['src/agent', 'src/hub', 'worker']) {
    const target = path.join(root, directory);
    assert.equal(fs.existsSync(target) ? sourceFiles(target).length : 0, 0, directory);
  }
});

test('renderer cannot provide a scan root or arbitrary openPath target', () => {
  const preload = fs.readFileSync(path.join(root, 'src/electron/preload.js'), 'utf8');
  assert.doesNotMatch(preload, /CODEX_HOME|sessionsRoot|openPath\s*:\s*\([^)]/);
  assert.match(preload, /openUserData:\s*\(\)/);
  assert.match(preload, /openDirectory:\s*\(\)/);
  assert.match(preload, /openLatest:\s*\(\)/);
});

test('production dependency and package surfaces contain no removed integration', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.dependencies, { chokidar: '^4.0.3' });
  assert.equal(packageJson.build.publish, undefined);
  const serialized = JSON.stringify({
    scripts: packageJson.scripts,
    dependencies: packageJson.dependencies,
    files: packageJson.build.files
  }).toLowerCase();
  for (const forbidden of [
    'electron-updater', 'undici', 'discord', 'tokscale', 'credential',
    'provider', 'sync:worker', 'src/hub', 'src/agent', 'worker/'
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

test('renderer session is memory-only and is not a persistent cookie partition', () => {
  const main = fs.readFileSync(path.join(root, 'src/electron/main.js'), 'utf8');
  assert.match(main, /SESSION_PARTITION = 'codex-offline-memory'/);
  assert.doesNotMatch(main, /persist:/);
  assert.match(main, /fromPartition\(SESSION_PARTITION, \{ cache: false \}\)/);
});
