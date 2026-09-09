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
