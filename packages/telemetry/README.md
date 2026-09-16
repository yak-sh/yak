# @yaks/telemetry

A tool-call log beside a yaks graph: every call through a door, who made it, how
long it took, whether it worked. Recorded without ever throwing; read back
newest-first with repeated errors folded into counted cohorts.

## Install

```sh
deno add jsr:@yaks/telemetry
```

## Use

```ts
import {
  outcome,
  recent,
  record,
  schema,
  stats,
  toolCall,
} from '@yaks/telemetry'

for (let stmt of schema()) db.exec(stmt)

record(db, {
  source: 'mcp',
  name: 'task_list',
  session_id: 'S-1',
  ok: true,
  ms: 12,
})
record(db, {
  source: 'web',
  name: 'render',
  ok: false,
  error: 'TypeError: x',
  detail: stack,
})

recent(db, { only: 'errors', since: '2026-09-01' }) // newest first, cohorted
stats(db) // p50/p95/p99 per (source, name), timed calls only

// an MCP exchange as a call
let call = toolCall(body) // { name, session_id } or null for handshake noise
let { ok, error } = outcome(reply)
```

## What it owns

- **The table.** One row per call, keyed by its rowid. Log data, deliberately
  outside the graph: no entity id, no component, nothing links rows. The sources
  are a CHECK, so a door nobody declared fails loudly at the table.
- **`record` never throws.** A telemetry failure must never break the thing it
  watches; a failed append is warned and dropped, and a re-entrant record is
  dropped rather than looped.
- **Scrubbing on write.** Home paths, URLs, uuids, long hex and long tokens are
  replaced and the field is capped at 2048, so a served log is already clean.
- **Cohorts on read.** An error's fingerprint is its class, its door and the
  shape of its top frames, never the message or the line numbers; N copies of
  one crash read as one row with `count`, `first`, `last`.
- **The MCP classifier.** `toolCall` and `outcome` are pure; a host times the
  exchange and records the pair.

The database is a two-method `Driver` (`query`, `exec`); a host hands over the
methods it already has. `stats` uses SQLite's `percentile_cont` (3.53+).
