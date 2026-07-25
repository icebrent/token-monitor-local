'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertCanonicalPathWithin } = require('./localPaths');

const MAX_JSONL_LINE_BYTES = 8 * 1024 * 1024;
const UNKNOWN_MODEL = 'unknown';

function emptyPeriod() {
  return {
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    clients: {},
    clientCacheReads: {},
    clientCacheWrites: {},
    clientOutputs: {},
    models: {},
    modelCacheReads: {},
    modelCacheWrites: {},
    modelOutputs: {},
    clientModels: {},
    projects: {},
    sessions: {}
  };
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isoTimestamp(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function usageSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    input: number(value.input_tokens),
    cachedInput: number(value.cached_input_tokens),
    cacheWrite: number(value.cache_write_input_tokens),
    output: number(value.output_tokens),
    reasoning: number(value.reasoning_output_tokens),
    total: number(value.total_tokens)
  };
}

function usageDelta(previous, current) {
  if (!current) return null;
  if (!previous) return { ...current };
  if (current.total <= previous.total) return null;
  const delta = {};
  for (const key of Object.keys(current)) delta[key] = Math.max(0, current[key] - previous[key]);
  const expected = delta.input + delta.output;
  const total = current.total - previous.total;
  if (expected !== total) {
    delta.total = total;
    if (delta.input <= total) delta.output = total - delta.input;
    else {
      delta.input = total;
      delta.output = 0;
    }
  } else {
    delta.total = total;
  }
  return delta.total > 0 ? delta : null;
}

function disjointTokens(delta) {
  const cachedInput = Math.min(delta.input, delta.cachedInput);
  const cacheWrite = Math.min(Math.max(0, delta.input - cachedInput), delta.cacheWrite);
  const input = Math.max(0, delta.input - cachedInput - cacheWrite);
  return {
    input,
    cachedInput,
    cacheWrite,
    output: delta.output,
    reasoning: Math.min(delta.output, delta.reasoning),
    total: delta.total || delta.input + delta.output
  };
}

function safeProjectLabel(cwd) {
  const raw = String(cwd || '').trim().replace(/[\\/]+$/, '');
  if (!raw) return '';
  return path.basename(raw) || '';
}

function parseCodexSessionText(text, options = {}) {
  const diagnostics = {
    malformedLines: 0,
    oversizedLines: 0,
    unknownOuterTypes: 0,
    unknownEventTypes: 0,
    cumulativeCorrections: 0,
    fallbackLastUsageEvents: 0
  };
  let sessionId = String(options.sessionId || '').trim();
  let startedAt = '';
  let lastUsedAt = '';
  let projectLabel = '';
  let currentModel = UNKNOWN_MODEL;
  let currentTurnId = '';
  let previousTotal = null;
  const fallbackEvents = new Set();
  const turns = [];
  const knownOuterTypes = new Set(['session_meta', 'turn_context', 'event_msg', 'response_item', 'world_state', 'compacted']);
  const knownEventTypes = new Set([
    'token_count', 'user_message', 'agent_message', 'agent_reasoning', 'task_started', 'task_complete',
    'mcp_tool_call_end', 'exec_command_end', 'patch_apply_end', 'web_search_end', 'context_compacted',
    'turn_aborted', 'thread_settings_applied', 'thread_rolled_back', 'thread_name_updated', 'error'
  ]);

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    if (Buffer.byteLength(rawLine, 'utf8') > MAX_JSONL_LINE_BYTES) {
      diagnostics.oversizedLines += 1;
      continue;
    }
    let record;
    try { record = JSON.parse(rawLine); } catch (_) {
      diagnostics.malformedLines += 1;
      continue;
    }
    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
    const timestamp = isoTimestamp(record.timestamp || payload.timestamp);
    if (!knownOuterTypes.has(record.type)) diagnostics.unknownOuterTypes += 1;

    if (record.type === 'session_meta') {
      sessionId = String(payload.id || payload.session_id || sessionId).trim();
      startedAt = isoTimestamp(payload.timestamp || record.timestamp) || startedAt;
      projectLabel = safeProjectLabel(payload.cwd) || projectLabel;
      continue;
    }
    if (record.type === 'turn_context') {
      currentModel = String(payload.model || currentModel || UNKNOWN_MODEL).trim().toLowerCase() || UNKNOWN_MODEL;
      currentTurnId = String(payload.turn_id || '').trim();
      projectLabel = safeProjectLabel(payload.cwd) || projectLabel;
      continue;
    }
    if (record.type !== 'event_msg') continue;
    if (payload.type && !knownEventTypes.has(payload.type)) diagnostics.unknownEventTypes += 1;
    if (payload.type !== 'token_count') continue;

    const info = payload.info && typeof payload.info === 'object' ? payload.info : {};
    const cumulative = usageSnapshot(info.total_token_usage);
    const last = usageSnapshot(info.last_token_usage);
    let delta = null;
    if (cumulative) {
      if (previousTotal && cumulative.total < previousTotal.total) diagnostics.cumulativeCorrections += 1;
      delta = usageDelta(previousTotal, cumulative);
      previousTotal = cumulative;
    } else if (last) {
      const signature = JSON.stringify([timestamp, currentTurnId, last]);
      if (!fallbackEvents.has(signature)) {
        fallbackEvents.add(signature);
        delta = last;
        diagnostics.fallbackLastUsageEvents += 1;
      }
    }
    if (!delta || delta.total <= 0 || !timestamp) continue;
    const tokens = disjointTokens(delta);
    turns.push({
      timestamp,
      model: currentModel || UNKNOWN_MODEL,
      turnId: currentTurnId,
      tokens
    });
    if (!startedAt || timestamp < startedAt) startedAt = timestamp;
    if (!lastUsedAt || timestamp > lastUsedAt) lastUsedAt = timestamp;
  }

  return {
    sessionId,
    startedAt,
    lastUsedAt,
    projectLabel,
    turns,
    diagnostics
  };
}

function localDay(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function periodStarts(now, allTimeSince) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const allTime = new Date(`${allTimeSince}T00:00:00`);
  return {
    today: today.getTime(),
    month: month.getTime(),
    allTime: Number.isNaN(allTime.getTime()) ? 0 : allTime.getTime()
  };
}

function addNumber(map, key, value) {
  if (value > 0) map[key] = (map[key] || 0) + value;
}

function canonicalProjectKey(value) {
  const label = String(value || '').trim().normalize('NFC');
  return label ? label.toLowerCase().normalize('NFC') : '';
}

function deterministicProjectLabel(left, right) {
  const a = String(left || '').trim().normalize('NFC');
  const b = String(right || '').trim().normalize('NFC');
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function projectRollupFromSessions(sessions) {
  const projects = {};
  for (const session of Object.values(sessions || {})) {
    const label = String(session?.projectLabel || '').trim().normalize('NFC');
    const key = canonicalProjectKey(label);
    if (!key) continue;
    const project = projects[key] || { label, tokens: 0, costUsd: 0, clients: {} };
    project.label = deterministicProjectLabel(project.label, label);
    const tokens = Math.max(0, Math.round(number(session.totalTokens)));
    project.tokens += tokens;
    if (tokens > 0) addNumber(project.clients, 'codex', tokens);
    projects[key] = project;
  }
  return projects;
}

function addTurnToPeriod(period, parsed, turn) {
  const key = `codex:${parsed.sessionId}`;
  const tokens = turn.tokens;
  period.totalTokens += tokens.total;
  period.cacheReadTokens += tokens.cachedInput;
  period.cacheWriteTokens += tokens.cacheWrite;
  period.outputTokens += tokens.output;
  addNumber(period.clients, 'codex', tokens.total);
  addNumber(period.clientCacheReads, 'codex', tokens.cachedInput);
  addNumber(period.clientCacheWrites, 'codex', tokens.cacheWrite);
  addNumber(period.clientOutputs, 'codex', tokens.output);
  addNumber(period.models, turn.model, tokens.total);
  addNumber(period.modelCacheReads, turn.model, tokens.cachedInput);
  addNumber(period.modelCacheWrites, turn.model, tokens.cacheWrite);
  addNumber(period.modelOutputs, turn.model, tokens.output);
  if (!period.clientModels.codex) period.clientModels.codex = {};
  addNumber(period.clientModels.codex, turn.model, tokens.total);

  const session = period.sessions[key] || {
    client: 'codex',
    sessionId: parsed.sessionId,
    startedAt: parsed.startedAt,
    lastUsedAt: turn.timestamp,
    projectLabel: parsed.projectLabel,
    totalTokens: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    models: {},
    modelCosts: {}
  };
  session.totalTokens += tokens.total;
  session.inputTokens += tokens.input;
  session.cacheReadTokens += tokens.cachedInput;
  session.cacheWriteTokens += tokens.cacheWrite;
  session.outputTokens += tokens.output;
  session.reasoningTokens += tokens.reasoning;
  session.lastUsedAt = turn.timestamp > session.lastUsedAt ? turn.timestamp : session.lastUsedAt;
  addNumber(session.models, turn.model, tokens.total);
  period.sessions[key] = session;
}

function graphFromTurns(parsedSessions) {
  const days = new Map();
  for (const parsed of parsedSessions) {
    for (const turn of parsed.turns) {
      const date = localDay(turn.timestamp);
      const day = days.get(date) || {
        date,
        tokens: 0,
        messages: 0,
        perClient: { codex: { tokens: 0, messages: 0 } },
        perModel: {}
      };
      day.tokens += turn.tokens.total;
      day.messages += 1;
      day.perClient.codex.tokens += turn.tokens.total;
      day.perClient.codex.messages += 1;
      const model = day.perModel[turn.model] || { tokens: 0 };
      model.tokens += turn.tokens.total;
      day.perModel[turn.model] = model;
      days.set(date, day);
    }
  }
  return { contributions: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

function dayKeyAddDays(key, delta) {
  const milliseconds = Date.parse(`${key}T00:00:00Z`) + delta * 86400000;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function computeStreaks(days, todayKey) {
  const active = new Set();
  for (const day of (Array.isArray(days) ? days : [])) {
    if (number(day.tokens) > 0) active.add(String(day.date).slice(0, 10));
  }
  let currentStreak = 0;
  let cursor = String(todayKey).slice(0, 10);
  while (active.has(cursor)) {
    currentStreak += 1;
    cursor = dayKeyAddDays(cursor, -1);
  }
  const sorted = [...active].sort();
  let longestStreak = 0;
  let run = 0;
  let previous = null;
  for (const key of sorted) {
    run = previous !== null && key === dayKeyAddDays(previous, 1) ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = key;
  }
  return { currentStreak, longestStreak };
}

function normalizeLocalHistory(graphData, options = {}) {
  const daily = graphData.contributions || [];
  const todayKey = String(options.todayKey || localDay(new Date())).slice(0, 10);
  const months = new Map();
  const modelTotals = {};
  for (const day of daily) {
    const key = day.date.slice(0, 7);
    const month = months.get(key) || { month: key, tokens: 0, messages: 0, perModel: {} };
    month.tokens += day.tokens;
    month.messages += day.messages;
    for (const [model, value] of Object.entries(day.perModel)) {
      month.perModel[model] = { tokens: (month.perModel[model]?.tokens || 0) + value.tokens };
      modelTotals[model] = (modelTotals[model] || 0) + value.tokens;
    }
    months.set(key, month);
  }
  const favoriteModel = Object.entries(modelTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const { currentStreak, longestStreak } = computeStreaks(daily, todayKey);
  return {
    daily,
    monthly: [...months.values()],
    summary: {
      totalTokens: daily.reduce((sum, day) => sum + day.tokens, 0),
      activeDays: daily.filter((day) => day.tokens > 0).length,
      currentStreak,
      longestStreak,
      peakDayTokens: daily.reduce((max, day) => Math.max(max, day.tokens), 0),
      messages: daily.reduce((sum, day) => sum + day.messages, 0),
      favoriteModel
    }
  };
}

function listCodexJsonlFiles(sessionsRoot, options = {}) {
  const fsApi = options.fs || fs;
  const files = [];
  const walk = (dir) => {
    for (const entry of fsApi.readdirSync(dir, { withFileTypes: true })) {
      const candidate = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        assertCanonicalPathWithin(sessionsRoot, candidate, { fs: fsApi, label: 'Codex session directory' });
        walk(candidate);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        files.push(assertCanonicalPathWithin(sessionsRoot, candidate, { fs: fsApi, label: 'Codex session file' }));
      }
    }
  };
  walk(sessionsRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

function createCodexParseCache(options = {}) {
  const fsApi = options.fs || fs;
  const entries = new Map();
  return {
    read(file, sessionId) {
      const stat = fsApi.statSync(file);
      const signature = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
      const cached = entries.get(file);
      if (cached?.signature === signature) return { parsed: cached.parsed, hit: true };
      const parsed = parseCodexSessionText(fsApi.readFileSync(file, 'utf8'), { sessionId });
      entries.set(file, { signature, parsed });
      return { parsed, hit: false };
    },
    prune(files) {
      const present = new Set(files);
      for (const file of entries.keys()) {
        if (!present.has(file)) entries.delete(file);
      }
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    }
  };
}

function collectCodexUsage(options = {}) {
  const fsApi = options.fs || fs;
  const sessionsRoot = options.sessionsRoot;
  const cache = options.cache || null;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const allTimeSince = String(options.allTimeSince || '2024-01-01').slice(0, 10);
  const starts = periodStarts(now, allTimeSince);
  const periods = { today: emptyPeriod(), month: emptyPeriod(), allTime: emptyPeriod() };
  const diagnostics = {
    files: 0,
    malformedLines: 0,
    oversizedLines: 0,
    unknownOuterTypes: 0,
    unknownEventTypes: 0,
    cumulativeCorrections: 0,
    fallbackLastUsageEvents: 0,
    cacheHits: 0,
    cacheMisses: 0
  };
  const parsedSessions = [];

  const files = listCodexJsonlFiles(sessionsRoot, { fs: fsApi });
  cache?.prune(files);
  for (const file of files) {
    const fallbackId = path.basename(file, path.extname(file));
    const result = cache
      ? cache.read(file, fallbackId)
      : { parsed: parseCodexSessionText(fsApi.readFileSync(file, 'utf8'), { sessionId: fallbackId }), hit: false };
    const { parsed } = result;
    diagnostics[result.hit ? 'cacheHits' : 'cacheMisses'] += 1;
    if (!parsed.sessionId) continue;
    diagnostics.files += 1;
    for (const key of Object.keys(parsed.diagnostics)) diagnostics[key] += parsed.diagnostics[key];
    parsedSessions.push(parsed);
    for (const turn of parsed.turns) {
      const timestamp = new Date(turn.timestamp).getTime();
      if (timestamp >= starts.today) addTurnToPeriod(periods.today, parsed, turn);
      if (timestamp >= starts.month) addTurnToPeriod(periods.month, parsed, turn);
      if (timestamp >= starts.allTime) addTurnToPeriod(periods.allTime, parsed, turn);
    }
  }

  for (const period of Object.values(periods)) {
    period.projects = projectRollupFromSessions(period.sessions);
  }
  const history = normalizeLocalHistory(graphFromTurns(parsedSessions), { todayKey: localDay(now) });
  return { periods, history, diagnostics, parsedSessions };
}

module.exports = {
  MAX_JSONL_LINE_BYTES,
  UNKNOWN_MODEL,
  collectCodexUsage,
  createCodexParseCache,
  disjointTokens,
  graphFromTurns,
  listCodexJsonlFiles,
  normalizeLocalHistory,
  parseCodexSessionText,
  periodStarts,
  projectRollupFromSessions,
  usageDelta,
  usageSnapshot
};
