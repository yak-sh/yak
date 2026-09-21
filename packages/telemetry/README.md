# @yaks/telemetry

**Retired.** The graph now holds what this log held. A tool call is a `call`
entity, claimed by an `execution` and completed as a `result` carrying its `ms`
and its `created.by`; when it failed, an `error` or `exception` component sits
beside it, with the message in `content` and `output.source` pointing at the
call ([@yaks/tools](../tools)). A second table holding the same facts, outside
the entity tables and impossible to query alongside anything else, is one
storage layout too many. `/telemetry` is a graph query now: see
[@yaks/tools](../tools/README.md#what-replaced-the-tool-call-log).

No package in `packages/` uses this one. It remains in the workspace only
because the fleet server (`src/telemetry.ts`, `src/db.ts`) imports it, and it
will be deleted along with `src/` at cutover (T-37584). It exports no plugin
entry points.

---

A tool-call log stored beside a yaks graph: every call, whichever entry point it
arrived through, who made it, how long it took, and whether it worked. Recorded
without ever throwing; read back newest first, with repeated errors grouped into
counted cohorts.

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

- **The table.** One row per call, keyed only by its rowid. Log data,
  deliberately outside the graph: no entity id, no component, and no references
  between rows. The set of sources is a CHECK constraint, so a row from a source
  nobody declared fails loudly at the table.
- **`record` never throws.** A telemetry failure must never break what it is
  measuring; a failed insert is logged as a warning and dropped, and a `record`
  call made from inside another one is dropped rather than looping.
- **Scrubbing on write.** Home directory paths, URLs, UUIDs, long hex strings
  and long opaque tokens are replaced, and the field is truncated at 2048
  characters, so the log is already clean before it is served.
- **Cohorts on read.** An error's fingerprint is its class, its source and the
  shape of its top stack frames — never the message or the line numbers — so N
  copies of one crash are returned as one row with `count`, `first` and `last`.
- **The MCP classifier.** `toolCall` and `outcome` are pure functions; the
  caller times the exchange and records the pair.

The database is a two-method `Driver` (`query`, `exec`); the caller passes in
the methods it already has. `stats` uses SQLite's `percentile_cont` (3.53+).
