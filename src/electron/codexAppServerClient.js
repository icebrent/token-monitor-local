'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function failure(code, message) { return Object.assign(new Error(message), { code }); }

// Resolve a native executable, including the official npm distribution's vendor binary.
// Never run a shell or interpolate a renderer-provided command.
function findCodex(env = process.env, platform = process.platform) {
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    const candidates = [path.join(directory, platform === 'win32' ? 'codex.exe' : 'codex')];
    if (platform === 'win32') {
      const packageRoot = path.join(directory, 'node_modules', '@openai', 'codex');
      candidates.push(path.join(packageRoot, 'vendor', `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, 'codex', 'codex.exe'));
      candidates.push(path.join(directory, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, 'codex', 'codex.exe'));
      candidates.push(path.join(packageRoot, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, 'codex', 'codex.exe'));
    }
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK);
          if (platform !== 'win32') {
            const fd = fs.openSync(candidate, 'r');
            const magic = Buffer.alloc(2);
            try { fs.readSync(fd, magic, 0, 2, 0); } finally { fs.closeSync(fd); }
            // Refuse shell/Node wrappers whose grandchild cannot be reliably terminated.
            if (magic.toString() === '#!') continue;
          }
          return candidate;
        }
      } catch (_) {}
    }
  }
  throw failure('cli_missing', 'Codex CLI is not installed or is not on PATH');
}

class CodexAppServerClient {
  constructor({ launch = spawn, resolve = findCodex, timeoutMs = 30000, debug = () => {} } = {}) {
    Object.assign(this, { launch, resolve, timeoutMs, debug });
    this.pending = new Map();
    this.nextId = 1;
    this.child = null;
    this.ready = null;
    this.closed = false;
  }

  start() {
    if (this.closed) return Promise.reject(failure('closed', 'App server client is closed'));
    if (this.ready) return this.ready;
    this.ready = this.initialize().catch((error) => {
      this.abort(error);
      throw error;
    });
    return this.ready;
  }

  async initialize() {
    const executable = this.resolve();
    try {
      this.child = this.launch(executable, ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false
      });
    } catch (_) { throw failure('start_failed', 'Codex app-server could not start'); }
    const child = this.child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) return this.abort(failure('malformed_rpc', 'RPC frame is too large'));
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) this.receive(line);
      }
    });
    child.stderr.on('data', () => this.debug('Codex app-server stderr received'));
    child.stdin.on('error', () => {
      if (this.child === child) this.abort(failure('start_failed', 'App-server stdin closed'));
    });
    child.on('error', () => {
      if (this.child === child) this.abort(failure('start_failed', 'Codex app-server could not start'));
    });
    const exited = () => {
      if (this.child === child) this.abort(failure('process_exit', 'Codex app-server exited'));
    };
    child.on('exit', exited);
    child.on('close', exited);
    const result = await this.request('initialize', {
      clientInfo: { name: 'token_monitor_local', title: 'Codex Token Monitor', version: '0.34.0' },
      capabilities: { experimentalApi: true }
    });
    if (!result || typeof result.userAgent !== 'string') throw failure('malformed_rpc', 'Invalid initialize response');
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  }

  request(method, params = {}) {
    if (!this.child) return Promise.reject(failure('process_exit', 'App server is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(failure('timeout', `Official RPC timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); }
      catch (_) { this.abort(failure('start_failed', 'Cannot write to app server')); }
    });
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); }
    catch (_) { return this.abort(failure('malformed_rpc', 'Malformed JSON from app server')); }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return this.abort(failure('malformed_rpc', 'Malformed RPC message'));
    if (typeof message.method === 'string') {
      // No credential refresh or tool capability is provided by this client.
      if (message.id !== undefined) this.child?.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unsupported request' } })}\n`);
      return;
    }
    if (message.id === undefined || (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error'))
      || (Object.hasOwn(message, 'error') && (!message.error || typeof message.error.code !== 'number' || typeof message.error.message !== 'string'))) {
      return this.abort(failure('malformed_rpc', 'Malformed RPC response'));
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(message.id);
    if (message.error) {
      const code = message.error.code;
      const auth = /unauthori[sz]ed|not logged|sign in|authentication|login required/i.test(message.error.message || '');
      entry.reject(failure(auth ? 'not_logged_in' : code === -32601 ? 'unsupported_rpc' : 'endpoint_failed',
        auth ? 'Sign in to Codex CLI first' : code === -32601 ? 'Installed Codex CLI does not support this RPC' : 'Official usage endpoint request failed'));
    } else entry.resolve(message.result);
  }

  async getAccountUsage() { await this.start(); return this.request('account/usage/read'); }
  async getRateLimits() { await this.start(); return this.request('account/rateLimits/read'); }

  get connectionStatus() { return this.child ? 'connected' : 'disconnected'; }

  abort(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child) {
      child.stdin.end();
      child.kill();
      // Force termination if a POSIX process ignores SIGTERM; Windows kill is already forceful.
      if (process.platform !== 'win32') {
        const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000);
        child.once('close', () => clearTimeout(timer));
        timer.unref();
      }
    }
  }

  close() { this.closed = true; this.abort(failure('closed', 'App server client closed')); }
}

module.exports = { CodexAppServerClient, findCodex, failure };
