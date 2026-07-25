'use strict';

const { pathToFileURL } = require('node:url');

const BLOCKED_URL_FILTERS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];
const FILE_URL_FILTER = ['file://*/*'];
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

function shouldBlockNetworkUrl(value) {
  try {
    return new Set(['http:', 'https:', 'ws:', 'wss:']).has(new URL(value).protocol);
  } catch (_) {
    return false;
  }
}

function rendererUrl(rendererFile) {
  return pathToFileURL(rendererFile).href;
}

function installOfflineSessionPolicy(electronSession) {
  electronSession.webRequest.onBeforeRequest(
    { urls: BLOCKED_URL_FILTERS },
    (_details, callback) => callback({ cancel: true })
  );
  electronSession.webRequest.onHeadersReceived(
    { urls: FILE_URL_FILTER },
    (details, callback) => callback({
      responseHeaders: {
        ...(details.responseHeaders || {}),
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    })
  );
  electronSession.setPermissionCheckHandler(() => false);
  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function lockWebContents(webContents, rendererFile) {
  const allowedNavigation = rendererUrl(rendererFile);
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-attach-webview', (event) => event.preventDefault());
  webContents.on('will-navigate', (event, url) => {
    if (url !== allowedNavigation) event.preventDefault();
  });
  webContents.on('devtools-opened', () => webContents.closeDevTools());
}

module.exports = {
  BLOCKED_URL_FILTERS,
  CONTENT_SECURITY_POLICY,
  installOfflineSessionPolicy,
  lockWebContents,
  rendererUrl,
  shouldBlockNetworkUrl
};
