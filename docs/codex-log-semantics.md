# Codex JSONL accounting semantics

Codex Offline Monitor reads only the canonical `${CODEX_HOME:-~/.codex}/sessions`
tree. It treats each regular `.jsonl` file as one session and ignores symlinks,
junctions, non-JSONL files, malformed records, and individual lines larger than
8 MiB.

## Token events

`event_msg` records whose payload type is `token_count` contain two related
objects:

- `total_token_usage` is the cumulative usage snapshot for the session.
- `last_token_usage` describes the latest turn and is used only as a fallback
  for older logs that do not provide the cumulative object.

The parser subtracts consecutive cumulative snapshots. Equal snapshots are
bookkeeping replays and add nothing, which prevents duplicate counting. A
fallback event is deduplicated by its timestamp, turn id, and complete usage
shape.

This precedence is evidence-based rather than assumed. The real-log
cross-validation found one session where the cumulative counter exceeded the
sum of all latest-turn objects. See
[`codex-parser-cross-validation.md`](codex-parser-cross-validation.md).

Codex follows the OpenAI token convention:

- `input_tokens` includes `cached_input_tokens` and, when present,
  `cache_write_input_tokens`.
- uncached input is therefore `input - cached input - cache write`.
- `output_tokens` includes `reasoning_output_tokens`.
- reasoning is reported as an informational subset of output and is never added
  again to the billable/total token count.
- the additive total is uncached input + cached input + cache write + output,
  which equals input + output and `total_tokens`.

## Time and model attribution

Each positive cumulative delta belongs to the timestamp of that `token_count`
record and to the most recent `turn_context.model`. A session may therefore
contribute different turns to different days, months, and models. Today and
month use the machine's local calendar boundaries. All-time applies its
configured date cutoff to each turn, not to the session start date.

If no model has appeared yet, the turn is assigned to `unknown` with zero cost.
Unknown record and event types are counted in diagnostics and otherwise ignored.

## File changes

Collection derives state from the current complete file, so an append, truncate,
or rewrite cannot double-count a prior in-memory cursor. The runtime cache may
reuse an unchanged parsed file, but any size or modification-time change causes
that file to be parsed again from byte zero. Deleted sessions may survive only
in the application's own explicitly documented local history archive.

Malformed and oversized lines are skipped and surfaced through diagnostics. A
cumulative counter decrease is treated as a correction boundary: the new
snapshot replaces the previous baseline instead of producing a negative or
duplicated delta.
