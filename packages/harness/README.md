# @yaks/harness

An agent harness with nothing under it but a file. One SQLite database it makes
itself, the session daemon in this process, and no server anywhere.

It is composition, not machinery. Four lines are the whole package:

```
open()          the file, the vocabulary, the plugins        store.ts
harnessTools()  the shell (@yaks/process) + the graph tier (@yaks/mcp)
agent()         the seed, the daemon (@yaks/session), the doors  run.ts
plugin          the verbs, over @yaks/cli                      cli.ts
```

## Use

```sh
deno task harness new 'reply with the word pong'
deno task harness ls
deno task harness show <session>
deno task harness send <session> 'and again'
deno task harness tasks
deno task harness models
```

`$HARNESS_DB` says where the graph lives (default `~/.harness/harness.db`); the
model is `gpt-6-astra` unless `--model` says otherwise, reached with
`$OPENAI_API_KEY` or the Codex CLI's sign-in (@yaks/openai).

```ts
import { agent, open } from '@yaks/harness'

let a = agent({ h: open(':memory:'), model: fake })
let s = await a.start('reply with the word pong')
await a.idle(s)
for (let e of await a.transcript(s)) console.log(a.line(e))
```

## What it is made of

- **The graph is the harness.** A transcript is `entry` entities, what it ran is
  `process` entities, the work is `task` entities — @yaks/session, @yaks/process
  and @yaks/task over @yaks/sqlite. Nothing here writes SQL and nothing keeps
  state this process would lose: what is running is `.session.status=running`.
  Point it at the fleet's graph and none of it changes.
- **Two statuses are computed, never stored.** `sessionDerived` and @yaks/task's
  `derived()` are registered as derived columns, so those queries filter in the
  database.
- **The agent holds its own graph.** `harnessTools()` is @yaks/process's shell
  plus @yaks/mcp's generic tier (`graph_apply`, `graph_query`, `graph_show`,
  `graph_schema`), each tool's Zod arguments said as JSON Schema for the model.
- **Boot reconciles.** `open()` frees the leases of holders that are gone;
  `resume()` wakes the transcripts a restart left owed a turn.

## Not here

No TUI (that is @yaks/tui), no sync, no server, no durable effect ledger — the
daemon is woken again by `resume()` instead.

## Compatibility

Deno. It makes a file, reads the environment and starts child processes, and its
SQLite is `jsr:@db/sqlite`.

## Forks and subagents

The default tool table includes `fork`, `spawn`, and `wait`:

- `fork({prompt, instructions?, model?, effort?})` continues the caller's
  transcript prefix **before the current tool turn**, then adds the prompt.
  Unanswered calls are not inherited. It returns a concurrent child session id.
- `spawn({prompt, instructions?, model?, effort?})` returns a fresh child
  session id. It inherits the serving configuration, not the transcript. `model`
  accepts a model name (served by the inherited provider) or an existing model
  entity id.
- `wait({children: [id, ...], timeout?: milliseconds})` waits on direct children
  and returns their statuses and output. The default timeout is 60 seconds;
  timing out leaves the children running. `wait({process, timeout?})` still
  waits on a shell process. Use one target shape, not both.

A child carries `spawned{parent, call}`; a fork additionally has `fork{from}`.
`a.children(session)` reads that structure. When a child settles, the daemon
queues a completion receipt behind any active parent step: a result if the
originating call is still open, otherwise an input that wakes another parent
turn. Failed/stopped children also report their terminal outcome. A stopped
parent is not revived. Receipt ids are derived from the child's final entry, so
`resume()` can reconcile a missed completion without repeating one already
received. Fork/spawn calls themselves are idempotent by call id.

`agent({maxChildren: 4, maxSessions: 16})` sets the defaults explicitly.
Admission is serialized per graph across parents; concurrent roots count against
the same live-session limit. A refused tool call writes an error and a tool
result, and creates no child. Settled, failed, and stopped sessions free their
slots. These are harness tool/start limits, not a security boundary against
arbitrary graph writes or a distributed lock across multiple daemons.

`tools` replaces the default table when supplied. `sessionTools(graph, limits)`
from `@yaks/session` is the standalone delegation table (its admission queries
use the registered `session.status` derived column).

## Performance probe

```sh
DENO_SQLITE_PATH=libsqlite3.so.0 deno run -A packages/harness/perf.ts
```

This reports warmed median/p95 fresh-entry apply time and the subsequent react
step's model-dispatch overhead with a fixed 1,000-entry SQLite transcript. It
uses a fake model and measures no network time. The SQLite/daemon integration
suite lives under `packages/`, outside the repository's fast test tier.
