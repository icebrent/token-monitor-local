'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BLOCKED_URL_FILTERS,
  CONTENT_SECURITY_POLICY,
  installOfflineSessionPolicy,
  lockWebContents,
  shouldBlockNetworkUrl
} = require('../../src/electron/offlinePolicy');

test('HTTP, HTTPS, WebSocket, and secure WebSocket URLs are blocked', () => {
  for (const url of [
    'http://127.0.0.1:1234/data',
    'https://example.invalid/data',
    'ws://192.168.1.2/socket',
    'wss://example.invalid/socket'
  ]) assert.equal(shouldBlockNetworkUrl(url), true, url);
  assert.equal(shouldBlockNetworkUrl('file:///app/index.html'), false);
  assert.equal(shouldBlockNetworkUrl('data:text/plain,local'), false);
  assert.equal(BLOCKED_URL_FILTERS.length, 4);
});

test('session policy cancels network requests and denies every permission', () => {
  let beforeRequest = null;
  let permissionCheck = null;
  let permissionRequest = null;
  const fake = {
    webRequest: {
      onBeforeRequest: (_filter, handler) => { beforeRequest = handler; },
      onHeadersReceived: () => {}
    },
    setPermissionCheckHandler: (handler) => { permissionCheck = handler; },
    setPermissionRequestHandler: (handler) => { permissionRequest = handler; }
  };
  installOfflineSessionPolicy(fake);
  beforeRequest({}, (result) => assert.deepEqual(result, { cancel: true }));
  assert.equal(permissionCheck(), false);
  permissionRequest(null, 'geolocation', (allowed) => assert.equal(allowed, false));
});

test('strict CSP denies all connections, objects, forms, and framing', () => {
  for (const directive of [
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ]) assert.match(CONTENT_SECURITY_POLICY, new RegExp(directive));
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-inline|unsafe-eval/);
});

test('web contents deny windows, webviews, devtools, and non-app navigation', () => {
  const handlers = {};
  let windowHandler = null;
  let closedDevTools = false;
  const contents = {
    setWindowOpenHandler: (handler) => { windowHandler = handler; },
    on: (name, handler) => { handlers[name] = handler; },
    closeDevTools: () => { closedDevTools = true; }
  };
  lockWebContents(contents, 'C:\\app\\index.html');
  assert.deepEqual(windowHandler(), { action: 'deny' });
  for (const name of ['will-attach-webview', 'will-navigate']) {
    let prevented = false;
    handlers[name]({ preventDefault: () => { prevented = true; } }, 'https://example.invalid/');
    assert.equal(prevented, true, name);
  }
  handlers['devtools-opened']();
  assert.equal(closedDevTools, true);
});
