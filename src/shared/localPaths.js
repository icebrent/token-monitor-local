'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function isWindowsNetworkPath(value) {
  const raw = String(value || '').replaceAll('/', '\\');
  return /^\\\\(?:\?\\UNC\\|\.\\|[^?])+/i.test(raw);
}

function stripWindowsDevicePrefix(value) {
  const raw = String(value || '');
  if (/^\\\\\?\\UNC\\/i.test(raw)) return `\\\\${raw.slice(8)}`;
  if (/^\\\\\?\\[a-z]:\\/i.test(raw)) return raw.slice(4);
  return raw;
}

function comparablePath(value, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let normalized = pathApi.resolve(stripWindowsDevicePrefix(value));
  while (normalized.length > pathApi.parse(normalized).root.length && normalized.endsWith(pathApi.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function assertLocalPath(value, platform = process.platform, label = 'Path') {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is empty`);
  if (platform === 'win32' && isWindowsNetworkPath(raw)) {
    throw new Error(`${label} must not use a UNC or network path`);
  }
  return raw;
}

function nativeRealpath(fsApi, value) {
  const realpath = fsApi.realpathSync?.native || fsApi.realpathSync;
  return realpath.call(fsApi.realpathSync, value);
}

function isWithinRoot(root, candidate, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const base = comparablePath(root, platform);
  const target = comparablePath(candidate, platform);
  return target === base || target.startsWith(`${base}${pathApi.sep}`);
}

function canonicalizeExistingLocalPath(value, options = {}) {
  const fsApi = options.fs || fs;
  const platform = options.platform || process.platform;
  const label = options.label || 'Path';
  const requested = assertLocalPath(value, platform, label);
  const canonical = nativeRealpath(fsApi, requested);
  assertLocalPath(canonical, platform, `${label} canonical path`);
  return canonical;
}

function assertCanonicalPathWithin(root, candidate, options = {}) {
  const fsApi = options.fs || fs;
  const platform = options.platform || process.platform;
  const label = options.label || 'Candidate path';
  const canonicalRoot = canonicalizeExistingLocalPath(root, {
    fs: fsApi,
    platform,
    label: options.rootLabel || 'Root path'
  });
  const canonicalCandidate = canonicalizeExistingLocalPath(candidate, {
    fs: fsApi,
    platform,
    label
  });
  if (!isWithinRoot(canonicalRoot, canonicalCandidate, platform)) {
    throw new Error(`${label} escapes the fixed Codex sessions root`);
  }
  return canonicalCandidate;
}

function fixedCodexRoots(options = {}) {
  const fsApi = options.fs || fs;
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const configuredHome = String(env.CODEX_HOME || '').trim() || pathApi.join(homeDir, '.codex');
  const codexHome = canonicalizeExistingLocalPath(configuredHome, {
    fs: fsApi,
    platform,
    label: 'CODEX_HOME'
  });
  const requestedSessions = pathApi.join(codexHome, 'sessions');
  const sessionsRoot = canonicalizeExistingLocalPath(requestedSessions, {
    fs: fsApi,
    platform,
    label: 'Codex sessions root'
  });
  if (!isWithinRoot(codexHome, sessionsRoot, platform)) {
    throw new Error('Codex sessions root escapes canonical CODEX_HOME');
  }
  return Object.freeze({ codexHome, sessionsRoot });
}

module.exports = {
  assertCanonicalPathWithin,
  assertLocalPath,
  comparablePath,
  fixedCodexRoots,
  isWindowsNetworkPath,
  isWithinRoot,
  stripWindowsDevicePrefix
};
