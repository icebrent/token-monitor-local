'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  collectCodexUsage,
  createCodexParseCache,
  parseCodexSessionText,
  usageDelta
} = require('../../src/shared/codexJsonlParser');

function line(type, timestamp, payload) {
  return JSON.stringify({ type, timestamp, payload });
}

test('cumulative token_count snapshots are differenced and duplicates are ignored', () => {
  const text = [
    line('session_meta', '2026-07-01T00:00:00Z', { id: 's1', cwd: 'C:\\work\\alpha', timestamp: '2026-07-01T00:00:00Z' }),
    line('turn_context', '2026-07-01T00:00:01Z', { turn_id: 't1', model: 'gpt-5' }),
    line('event_msg', '2026-07-01T00:00:02Z', { type: 'token_count', info: {
      last_token_usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 },
      total_token_usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 }
    } }),
    line('event_msg', '2026-07-01T00:00:03Z', { type: 'token_count', info: {
      last_token_usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 },
      total_token_usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 }
    } }),
    line('turn_context', '2026-07-01T00:00:04Z', { turn_id: 't2', model: 'gpt-5-mini' }),
    line('event_msg', '2026-07-01T00:00:05Z', { type: 'token_count', info: {
      last_token_usage: { input_tokens: 50, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 60 },
      total_token_usage: { input_tokens: 150, cached_input_tokens: 60, cache_write_input_tokens: 10, output_tokens: 30, reasoning_output_tokens: 7, total_tokens: 180 }
    } })
  ].join('\n');
  const parsed = parseCodexSessionText(text);
  assert.equal(parsed.turns.length, 2);
  assert.deepEqual(parsed.turns[0].tokens, {
    input: 50, cachedInput: 40, cacheWrite: 10, output: 20, reasoning: 5, total: 120
  });
  assert.deepEqual(parsed.turns[1].tokens, {
    input: 30, cachedInput: 20, cacheWrite: 0, output: 10, reasoning: 2, total: 60
  });
  assert.deepEqual(parsed.turns.map((turn) => turn.model), ['gpt-5', 'gpt-5-mini']);
});

test('reasoning is an informational subset of output and cached input is disjoint', () => {
  const delta = usageDelta(null, {
    input: 5000, cachedInput: 4000, cacheWrite: 0, output: 200, reasoning: 50, total: 5200
  });
  assert.equal(delta.total, 5200);
  const parsed = parseCodexSessionText(line('event_msg', '2026-07-01T00:00:00Z', {
    type: 'token_count',
    info: { total_token_usage: {
      input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 200,
      reasoning_output_tokens: 50, total_tokens: 5200
    } }
  }));
  assert.equal(parsed.turns[0].tokens.input, 1000);
  assert.equal(parsed.turns[0].tokens.cachedInput, 4000);
  assert.equal(parsed.turns[0].tokens.output, 200);
  assert.equal(parsed.turns[0].tokens.reasoning, 50);
  assert.equal(parsed.turns[0].tokens.total, 5200);
});

test('period totals attribute individual turns across day and month boundaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-periods-'));
  const sessions = path.join(root, 'sessions');
  const beforeMonth = new Date(2026, 5, 30, 23, 0, 0);
  const inMonth = new Date(2026, 6, 1, 1, 0, 0);
  const now = new Date(2026, 6, 1, 12, 0, 0);
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 's1.jsonl'), [
    line('session_meta', beforeMonth.toISOString(), { id: 's1', cwd: '/work/alpha' }),
    line('turn_context', new Date(beforeMonth.getTime() + 1000).toISOString(), { turn_id: 't1', model: 'gpt-5' }),
    line('event_msg', new Date(beforeMonth.getTime() + 2000).toISOString(), { type: 'token_count', info: {
      total_token_usage: { input_tokens: 90, cached_input_tokens: 40, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 100 }
    } }),
    line('turn_context', inMonth.toISOString(), { turn_id: 't2', model: 'gpt-5' }),
    line('event_msg', new Date(inMonth.getTime() + 1000).toISOString(), { type: 'token_count', info: {
      total_token_usage: { input_tokens: 135, cached_input_tokens: 60, output_tokens: 15, reasoning_output_tokens: 3, total_tokens: 150 }
    } })
  ].join('\n'));
  const result = collectCodexUsage({
    sessionsRoot: fs.realpathSync.native(sessions),
    now,
    allTimeSince: '2024-01-01'
  });
  assert.equal(result.periods.today.totalTokens, 50);
  assert.equal(result.periods.month.totalTokens, 50);
  assert.equal(result.periods.allTime.totalTokens, 150);
  assert.equal(result.periods.today.sessions['codex:s1'].startedAt, beforeMonth.toISOString());
  assert.equal(result.history.summary.totalTokens, 150);
  assert.equal(result.history.daily.reduce((sum, day) => sum + day.tokens, 0), 150);
});

test('unknown records and models degrade without breaking known usage', () => {
  const parsed = parseCodexSessionText([
    line('future_outer', '2026-07-01T00:00:00Z', { type: 'future_event' }),
    line('event_msg', '2026-07-01T00:00:01Z', { type: 'future_event' }),
    line('event_msg', '2026-07-01T00:00:02Z', { type: 'token_count', info: {
      total_token_usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 }
    } })
  ].join('\n'));
  assert.equal(parsed.turns[0].model, 'unknown');
  assert.equal(parsed.turns[0].tokens.total, 10);
  assert.equal(parsed.diagnostics.unknownOuterTypes, 1);
  assert.equal(parsed.diagnostics.unknownEventTypes, 1);
});

test('fallback last_token_usage events are deduplicated by turn, timestamp, and usage', () => {
  const event = line('event_msg', '2026-07-01T00:00:02Z', { type: 'token_count', info: {
    last_token_usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 }
  } });
  const parsed = parseCodexSessionText([event, event].join('\n'));
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.diagnostics.fallbackLastUsageEvents, 1);
});

test('parse cache reparses appended, truncated, and rewritten logs and prunes deletions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-cache-'));
  const sessions = path.join(root, 'sessions');
  const file = path.join(sessions, 's1.jsonl');
  fs.mkdirSync(sessions);
  const tokenLine = (total, second) => line('event_msg', `2026-07-01T00:00:${second}Z`, {
    type: 'token_count',
    info: { total_token_usage: { input_tokens: total - 1, output_tokens: 1, total_tokens: total } }
  });
  fs.writeFileSync(file, tokenLine(10, '01'));
  const sessionsRoot = fs.realpathSync.native(sessions);
  const cache = createCodexParseCache();
  const options = { sessionsRoot, cache, now: new Date(2026, 6, 1, 12), allTimeSince: '2024-01-01' };

  assert.equal(collectCodexUsage(options).periods.allTime.totalTokens, 10);
  assert.equal(collectCodexUsage(options).diagnostics.cacheHits, 1);

  fs.appendFileSync(file, `\n${tokenLine(20, '02')}`);
  assert.equal(collectCodexUsage(options).periods.allTime.totalTokens, 20);

  fs.writeFileSync(file, tokenLine(5, '03'));
  assert.equal(collectCodexUsage(options).periods.allTime.totalTokens, 5);

  fs.writeFileSync(file, tokenLine(7, '04'));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(file, future, future);
  assert.equal(collectCodexUsage(options).periods.allTime.totalTokens, 7);

  fs.writeFileSync(path.join(sessions, 's2.jsonl'), tokenLine(3, '05'));
  assert.equal(collectCodexUsage(options).periods.allTime.totalTokens, 10);
  fs.unlinkSync(file);
  assert.equal(collectCodexUsage(options).periods.allTime.totalTokens, 3);
  assert.equal(cache.size, 1);
});
