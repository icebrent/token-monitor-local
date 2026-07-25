# Codex parser cross-validation

Before removing tokscale, the bundled tokscale 4.6.1 collector and the native
Codex JSONL parser were run sequentially against the same canonical local
session tree on 2026-07-25. The input contained 210 real session files and was
not copied, edited, or reduced to fixtures.

Session keys were normalized to their trailing Codex UUID for comparison,
because tokscale prefixes the filename while the native parser uses the
`session_meta.payload.id` value.

| Scope | Sessions | Models | Result |
| --- | ---: | ---: | --- |
| today | 8 | 2 | exact match |
| month | 98 | 4 | exact match |
| all-time | 210 | 6 | one session differs |
| daily trend | 39 populated days | 6 overall | one day differs |

For today and month, total, uncached input, cached input, cache write, output,
reasoning, every model total, and every normalized session total matched
exactly.

The only all-time difference is 61,305 tokens in one older session:

| Component | Native parser minus tokscale |
| --- | ---: |
| uncached input | 8,943 |
| cached input | 51,072 |
| cache write | 0 |
| output | 1,290 |
| reasoning subset of output | 223 |
| additive total | 61,305 |

The same 61,305-token difference appears on exactly one daily-trend date and
one model. No other model, session, or day differs.

## Cause

That real session contains 80 `token_count` events. Its final cumulative
`total_token_usage` exceeds the sum of all `last_token_usage` objects by exactly
the component differences above. tokscale's aggregate equals the sum of
`last_token_usage`; the native parser equals the final cumulative counters.

The native parser intentionally retains this difference. Codex labels
`total_token_usage` as the session total, the counter is monotonic throughout
the file, and cumulative differencing also handles duplicate snapshots without
double-counting. `last_token_usage` remains a compatibility fallback only when
the cumulative object is absent.

The validation also confirmed a removal requirement: tokscale attempted
requests to external pricing sources while producing a local report. This is
incompatible with the offline boundary even though token parsing itself uses
local files.
