# @yaks/harness

An agent harness with nothing under it but a file. One SQLite database it makes
itself, the session daemon in this process, and no server anywhere.

It is composition, not machinery. Four lines are the whole package:

```
open()          the file, the vocabulary, the plugins        store.ts
harnessTools()  shell + delegation + graph, one merged wait    tools.ts
agent()         the seed, the daemon (@yaks/session), the doors  run.ts
plugin          the verbs, over @yaks/cli                      cli.ts
```

## Use

`deno task harness` with no verb opens the terminal UI. The transcript scrolls
and word-wraps beside the Sessions, Subagents, Tasks and Keys panels. Enter
starts a session (or sends to the selected one); Shift+Enter inserts a newline.
Ctrl+N / Ctrl+P or Alt+Down / Alt+Up select sessions, Ctrl+O selects a new one,
PgUp / PgDn scroll, and Ctrl+C quits. Shift+Enter needs a terminal supporting
kitty keyboard sequences (Alt+Enter also inserts a newline).

Tab toggles the visible composer mode between **message** (the default) and
**task**, without changing the draft. Task mode requires a selected session;
Enter calls `a.taskEntry(session, text)` to mint a `doc` and bare `task{}` (no
filing metadata), contain it under the session's claimed tasks, and spawn a
child that claims it. With no claimed tasks, containment is under the session
itself. The first line (up to 120 characters) is the title; the entire text is
the body. Admission, task, edges, child and claim are one atomic write through
`taskEntry(graph, session, text, limits?)` from `@yaks/session`. A cap refusal
creates nothing and appears by the composer. The parent stays selected and
available for messages; the child and its open/wip task appear in the sidebar,
and completion arrives in the parent transcript without a keypress.

Typing only touches the editor. Post-commit graph effects refresh the content,
including model replies arriving while stdin is idle; there is no polling loop.
The sidebar is `Opts.panels` in `app.ts`: each contribution in `panels.ts` is
`{title, read, Render}`, with `read` returning bundles from graph-backed doors.
To embed the app, mount `App` with `{agent: a, subscribe: changes(a), panels}`;
use `run(() => h(App, opts), {backend})` to choose a terminal backend.

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
  `derived(taskMarks)` are registered as derived columns. The task plugin uses
  the same `taskMarks` from @yaks/session: completed/cancelled win, then a claim
  means wip, otherwise open. `blocked` stays a facet, never a status. Queries
  filter in the database, and the sidebar reads that same status.
- **Work need not be filed.** `doc` + bare `task{}` is a microtask; optional
  `filed{project, priority, domain, assignee}` places it in the portfolio.
  `a.tasks()` reads `.task.status=open,wip`, oldest first, without requiring
  filing or a project. The CLI and sidebar use that same door.
- **The agent holds its own graph.** `harnessTools()` is @yaks/process's shell
  plus @yaks/mcp's generic tier (`graph_apply`, `graph_query`, `graph_show`,
  `graph_schema`), each tool's Zod arguments said as JSON Schema for the model.
- **Boot reconciles.** `open()` frees the leases of holders that are gone;
  `resume()` wakes the transcripts a restart left owed a turn.

## Not here

No sync, no server, no durable effect ledger — the daemon is woken again by
`resume()` instead. The terminal host and widgets come from @yaks/tui.

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
- `spawn({task, instructions?, model?, effort?})` instead accepts a task eid or
  `T-<number>`. The child's first input records its title and body as served;
  its claim commits with the child, so the task is wip from the first tick.
  Choose exactly one of `prompt` and `task`. Independent subtasks can run in
  parallel; tree ordering is through `requires`/`contains`, not priority.
- `wait({children: [id, ...], timeout?: milliseconds})` waits on direct children
  and returns their statuses and output. The default timeout is 60 seconds;
  timing out leaves the children running.
- `wait({tasks: [id, ...], timeout?: milliseconds})` returns each task's
  `{task, status, done}`. Shared @yaks/task `done()` requires a settled task
  (completed or cancelled) with no open direct `requires`/`contains` far ends.
  Timeout returns the current state without cancelling work.
- `wait({process, timeout?})` still waits on a shell process. The tool table
  exposes one merged `wait`: choose exactly one of process, children, or tasks.

A child carries `spawned{parent, call}`; a fork additionally has `fork{from}`.
`a.children(session)` reads that structure. When a child settles, the daemon
queues a completion receipt behind any active parent step: a result if the
originating call is still open, otherwise an input that wakes another parent
turn. Failed/stopped children also report their terminal outcome. A stopped
parent is not revived. When its claimed task is done, a quiet child delivers
`task T-<number> <status>` plus its final message, with the idempotent receipt
id `delivery:<child>:task:<task>:<status>`. A child settling before the task is
done still reports its outcome, using a receipt id derived from its final entry.
`resume()` reconciles missed receipts without repeating ones already received.
Fork/spawn calls themselves are idempotent by call id.

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
