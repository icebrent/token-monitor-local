'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { CodexAppServerClient, findCodex } = require('../../src/electron/codexAppServerClient');

test('CLI detection supports native PATH and Windows npm vendor installs without shell wrappers', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'official-cli-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => findCodex({ PATH: root }, 'win32'), { code: 'cli_missing' });
  const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`;
  const executable = path.join(root, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'codex', 'codex.exe');
  fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.writeFileSync(executable, 'fixture'); fs.chmodSync(executable, 0o755);
  assert.equal(findCodex({ PATH: root }, 'win32'), executable);
  const native = path.join(root, 'codex.exe'); fs.writeFileSync(native, 'fixture'); fs.chmodSync(native, 0o755);
  assert.equal(findCodex({ PATH: root }, 'win32'), native);
  const wrapper = path.join(root, 'codex'); fs.writeFileSync(wrapper, '#!/usr/bin/env node\n'); fs.chmodSync(wrapper, 0o755);
  for (const platform of ['linux', 'darwin']) {
    assert.throws(() => findCodex({ PATH: root }, platform), { code: 'cli_missing' });
  }
  fs.writeFileSync(wrapper, 'native fixture');
  for (const platform of ['linux', 'darwin']) assert.equal(findCodex({ PATH: root }, platform), wrapper);
  if (process.platform !== 'win32') {
    fs.chmodSync(wrapper, 0o644);
    for (const platform of ['linux', 'darwin']) assert.throws(() => findCodex({ PATH: root }, platform), { code: 'cli_missing' });
  }
});

for (const platform of ['linux', 'darwin']) test(`${platform} discovery requires executable permission and ignores PATH wrappers`, () => {
  // Model POSIX permissions even on a Windows test host; never inspect the real PATH.
  const files = new Map([
    ['/wrapper/codex', { mode: 0o755, magic: '#!' }],
    ['/native/codex', { mode: 0o644, magic: 'NA' }]
  ]);
  const checked = [];
  const fakeFs = {
    constants: { X_OK: 1 },
    statSync(file) { if (!files.has(file)) throw new Error('missing fixture'); return { isFile: () => true }; },
    accessSync(file, mode) { checked.push([file, mode]); if (!(files.get(file).mode & 0o111)) throw new Error('not executable'); },
    openSync: (file) => file,
    readSync: (file, buffer) => buffer.write(files.get(file).magic),
    closeSync() {}
  };
  const context = { module: { exports: {} }, Buffer, process: { platform, arch: 'x64', env: {} },
    require: (name) => name === 'node:fs' ? fakeFs : name === 'node:path' ? path.posix : { spawn() { throw new Error('No real process allowed'); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/electron/codexAppServerClient.js'), 'utf8'), context);
  const resolve = context.module.exports.findCodex;
  assert.throws(() => resolve({ PATH: '/wrapper:/native' }), { code: 'cli_missing' });
  files.get('/native/codex').mode = 0o755;
  assert.equal(resolve({ PATH: '/wrapper:/native' }), '/native/codex');
  assert.deepEqual(checked, [['/wrapper/codex', 1], ['/native/codex', 1], ['/wrapper/codex', 1], ['/native/codex', 1]]);
});

function mock(t, { timeoutMs = 100, autoInitialize = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const messages = [];
  child.stdin = new Writable({ write(chunk, _, done) {
    const message = JSON.parse(chunk.toString()); messages.push(message);
    if (autoInitialize && message.method === 'initialize') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: 'fixture' } }) + '\n'));
    done();
  } });
  child.kill = () => { child.killed = true; };
  const client = new CodexAppServerClient({ resolve: () => 'codex.exe', launch: (exe, args, options) => {
    assert.equal(exe, 'codex.exe'); assert.deepEqual(args, ['app-server', '--listen', 'stdio://']);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true); return child;
  }, timeoutMs });
  t.after(() => client.close());
  return { client, child, messages, respond: (id, result) => child.stdout.write(JSON.stringify({ id, result }) + '\n') };
}

test('initialize and initialized precede usage; concurrent requests correlate out of order', async (t) => {
  const { client, messages, respond } = mock(t);
  await client.start();
  assert.deepEqual(messages.map((message) => message.method), ['initialize', 'initialized']);
  assert.equal(messages[0].params.capabilities.experimentalApi, true);
  const usage = client.getAccountUsage(); const limits = client.getRateLimits();
  await Promise.resolve();
  const requests = messages.slice(-2);
  assert.deepEqual(requests.map((message) => message.method), ['account/usage/read', 'account/rateLimits/read']);
  assert.deepEqual(requests[0].params, {}); // Never request thread estimates.
  respond(requests[1].id, { limits: 42 }); respond(requests[0].id, { usage: 99 });
  assert.deepEqual(await usage, { usage: 99 }); assert.deepEqual(await limits, { limits: 42 });
  assert.equal(client.pending.size, 0);
});

for (const [name, trigger, code] of [
  ['malformed JSON', (child) => child.stdout.write('{broken\n'), 'malformed_rpc'],
  ['malformed response', (child) => child.stdout.write('{"id":2}\n'), 'malformed_rpc'],
  ['process exit', (child) => child.emit('exit', 1), 'process_exit'],
  ['process error', (child) => child.emit('error', new Error('spawn failure')), 'start_failed']
]) test(name + ' rejects pending RPCs and cleans child', async (t) => {
  const { client, child } = mock(t); await client.start();
  const request = client.getAccountUsage(); await Promise.resolve();
  trigger(child); await assert.rejects(request, { code });
  assert.equal(client.pending.size, 0); assert.equal(child.killed, true);
});

test('request timeout and handshake timeout', async (t) => {
  const { client } = mock(t, { timeoutMs: 10 }); await client.start();
  await assert.rejects(client.getAccountUsage(), { code: 'timeout' });
  assert.equal(client.pending.size, 0);
  const other = mock(t, { timeoutMs: 10, autoInitialize: false });
  await assert.rejects(other.client.start(), { code: 'timeout' }); assert.equal(other.child.killed, true);
});

test('missing CLI, failed spawn, auth, unsupported RPC and endpoint errors are distinct', async (t) => {
  const missing = new CodexAppServerClient({ resolve: () => { throw Object.assign(new Error('missing'), { code: 'cli_missing' }); } });
  await assert.rejects(missing.start(), { code: 'cli_missing' }); missing.close();
  const failed = new CodexAppServerClient({ resolve: () => 'codex', launch: () => { throw new Error('failed'); } });
  await assert.rejects(failed.start(), { code: 'start_failed' }); failed.close();
  const { client, child, messages } = mock(t); await client.start();
  for (const [error, code] of [[{ code: 401, message: 'Unauthorized' }, 'not_logged_in'], [{ code: -32601, message: 'unknown' }, 'unsupported_rpc'], [{ code: 500, message: 'failed' }, 'endpoint_failed']]) {
    const request = client.getAccountUsage(); await Promise.resolve();
    child.stdout.write(JSON.stringify({ id: messages.at(-1).id, error }) + '\n');
    await assert.rejects(request, { code });
  }
});

test('JSON lines can be split across chunks; stderr is never parsed', async (t) => {
  const { client, child, messages } = mock(t); await client.start();
  const request = client.getRateLimits(); await Promise.resolve();
  child.stderr.write('{invalid JSON');
  const line = JSON.stringify({ id: messages.at(-1).id, result: { ok: true } }) + '\n';
  child.stdout.write(line.slice(0, 5)); child.stdout.write(line.slice(5));
  assert.deepEqual(await request, { ok: true });
});

test('close rejects requests, kills process, and prevents restart', async (t) => {
  const { client, child } = mock(t); await client.start();
  const request = client.getAccountUsage(); await Promise.resolve(); client.close();
  await assert.rejects(request, { code: 'closed' }); assert.equal(child.killed, true);
  await assert.rejects(client.start(), { code: 'closed' });
});
