'use strict';

const crypto = require('node:crypto');

function hashAccountKey(seed) {
  const raw = String(seed || '').trim();
  if (!raw) return '';
  if (raw.startsWith('sha256:')) return raw;
  const hash = crypto.createHash('sha256');
  hash.update('codex').update('\0').update(raw).update('\0');
  return `sha256:${hash.digest('hex')}`;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2 || !parts[1]) return {};
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function codexAuthIdentity(auth) {
  const tokens = auth?.tokens || auth || {};
  const idToken = tokens.id_token || auth?.id_token || '';
  const payload = decodeJwtPayload(idToken);
  const nested = payload['https://api.openai.com/auth'] || payload['https://api.openai.com/profile'] || {};
  const email = String(
    payload.email ||
    nested.email ||
    auth?.account?.email ||
    auth?.email ||
    ''
  ).trim().toLowerCase();
  const accountLabel = String(
    payload.chatgpt_plan_type ||
    nested.chatgpt_plan_type ||
    auth?.account?.planType ||
    auth?.account?.plan_type ||
    ''
  ).trim();
  const providerAccountId = String(
    payload.chatgpt_account_id ||
    nested.chatgpt_account_id ||
    payload.sub ||
    ''
  ).trim();
  // Key on the stable provider account id so the same account dedupes across
  // refreshes/devices; fall back to email only when no account id is available.
  const seed = providerAccountId || email;
  return {
    email,
    accountLabel,
    providerAccountId,
    accountKey: hashAccountKey(seed)
  };
}

module.exports = {
  decodeJwtPayload,
  codexAuthIdentity,
  hashAccountKey
};
