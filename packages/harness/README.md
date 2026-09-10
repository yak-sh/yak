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

Settled subagents are hidden from Sessions and Subagents by default. **Ctrl+S**
toggles **Show settled** (shown in Keys). Root sessions and the selected child
stay visible. This is only a display/navigation filter: parent completion
messages and child transcripts are retained; enable the toggle to revisit a
settled child. Failed and stopped children remain visible for attention.

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
deno run -A packages/harness/perf.ts
```

This reports warmed median/p95 fresh-entry apply time and the subsequent react
step's model-dispatch overhead with a fixed 1,000-entry SQLite transcript. It
uses a fake model and measures no network time. The SQLite/daemon integration
suite lives under `packages/`, outside the repository's fast test tier.

### Auto-task lifecycle context

Task-mode submission writes a passive `notice` entry into the parent transcript
in the same batch as the task and child. It records the original request and
user-created origin. A notice neither wakes the parent nor changes its derived
status; the next natural ask includes it. Completion still wakes the parent,
with the original context, factual child/task status, and child result. Receipt
identity remains durable and idempotent across resume/reconciliation. Ordinary
model delegation keeps its existing receipt behavior.

### Sidebar status indicators

Session and task indicators use query-matched `@yaks/render` registrations: `●`
green = completed task / settled session; `●` yellow = active work; `◐` yellow =
task still claimed by a settled worker; `○` blue = open; `●` red = failed
session / unfinished task whose worker failed. Stopped sessions and cancelled
tasks use a muted open circle. A stopped or unknown/missing task worker uses a
muted half-circle rather than claiming the work is active or complete. Completed
tasks outrank their worker's state. The task panel joins already-read session
state only for rendering; nothing is persisted twice. Completed tasks still
follow the existing open-task filtering.

### Subagent Git homes

Sessions carry `home{worktree,cwd}`. The worktree reference names a shared Git
checkout entity owned by `@yaks/git`; cwd is a separate optional command
default, not an isolation boundary. Root starts discover the existing checkout.
Legacy sessions attach lazily on their first shell call. Ordinary children
inherit home without making a checkout.

`spawn` and `fork` accept `worktree: {path, base?, branch?}` to create a
checkout, or `home: <worktree-eid>` to attach an existing one. These are
mutually exclusive. `cwd` can override the command directory independently.
Creation finishes before child session/input publication, so no child runs
against an unprepared checkout. The generic session package only exposes a host
preparation hook; it knows no Git.

A new worktree defaults to detached committed HEAD, not the parent's dirty
files. Its root becomes the default cwd unless explicitly overridden. Shell
resolution is per call → persisted session cwd → home worktree root → harness
directory; it inherits the harness environment. This is not sandboxing. No
checkout is merged or deleted automatically. Failed Git preparation remains as
`checkout` intent/error and as the failed tool result; retrying reconciles the
same path.

### Prompt context pilot

`prompt{scope,source,revision}` on an entry explicitly admits its `content.body`
as instructions. Ordinary file reads and tool results never gain instruction
status. `agent.instruct(session, text, source)` appends local instructions; it
is an explicit wake-producing operation, not a passive notice. OpenAI receives
ordered developer messages, including mid-conversation admissions.

Root sessions snapshot global `~/.agents/AGENTS.md` then ancestor `AGENTS.md`
files from filesystem root to cwd. Missing files are ignored, other read errors
abort admission. Each file's canonical path and content SHA-256 are recorded. No
mtime sorting or retrospective reload occurs. Existing `opts.instructions` and
`using.instructions` remain the legacy base instruction channel; delegated
`instructions` now append local guidance rather than replacing that base.

Fresh children copy shared prompt snapshots from their parent. Forks copy no
files: their exact inherited prefix is followed by a local fork-execution note,
optional child guidance, and the assignment. Fresh children intentionally
inherit the parent's file snapshots even when assigned a different home;
admitting that new home's guidance is explicit. A renamed/deleted source doesn't
alter history. This pilot is host/POSIX-oriented; it doesn't yet provide UI
admission controls, or prompt supersession. Prompt entries have a query-matched
transcript renderer. Fork notes are guidance, not a prohibition on useful
delegation. Provider cache hits are not guaranteed.

#### Prefix identity and cache observations (follow-up)

A file's `prompt.revision` is its content SHA-256, not an identity for the full
served prefix. Delegation guidance and fork notes currently have no revision.
The ordered transcript snapshots, fork anchor, and ask's recorded base
instructions preserve instruction history, but no aggregate provider-request
prefix identity or global cache-warmth registry is recorded yet.

A future registry should derive identities from the exact ordered served prefix
(including base instructions, message roles, tool definitions and relevant
provider serialization), scoped by provider/model/account and caching options.
Record request observations and provider-reported cached tokens separately from
predicted warmth. Sending a prefix does not prove retention, and an aggregate
cached-token count does not prove every prefix boundary was cached. Do not infer
expiry from a universal five-minute timeout. Provider-specific retention
controls and explicit cache breakpoints are distinct capabilities.

A refresh must record a new served revision without rewriting old entries; forks
must initially preserve their parent's prefix. Automatic revision selection,
TTL-based refresh, and live-provider cache/mid-session experiments are outside
this integration. Correctness and revoked guidance take precedence over cache
savings.

Task completion receipts use the mutation's actor, not `completed.by` (the
attribution of the work). Graph tools sign writes with their calling session;
`@yaks/task` records that actor on the first completion mark. If the receiving
parent wrote the completion, its previously delivered child result is not echoed
back or used to wake it again. New child responses still arrive. Child, other
session, and anonymous/external completions retain their normal receipts.
Provenance survives restart; older marks without an actor are treated as
external. Removing and recreating a completion mark records the new writer;
editing an existing mark preserves its original actor.

### Session tree

Sessions are grouped beneath their root, with assignment titles and compact IDs.
`Ctrl+N/P` (also Alt+Down/Up) switch **roots**, skipping descendants. `Alt+j/k`
moves through visible tree rows; `Alt+l` expands or enters a child, and `Alt+h`
collapses or selects its parent. Plain hjkl still types in the composer. The
selected child's ancestors stay open. `Ctrl+S` reveals settled children; roots
remain visible until archived.

`Alt+a` archives/unarchives the selected root, even when invoked on a
descendant. `Alt+z` shows archived roots so they can be selected and restored.
Archival is a persistent `archived` facet: it neither stops execution nor
removes history. Descendants inherit visibility from their root; they receive no
archive marks. Expansion and visibility preferences live only in the frontend
graph. Trees are keyboard-controlled for now; no coordinate-specific mouse hacks
were added.

The session title projection reads original local input, excluding inherited
fork history and instruction/notice entries. This currently adds transcript
reads to domain refreshes (not keystrokes); the existing coarse async domain
projection adapter remains a performance seam, documented in `FRONTEND.md`.

### Defect diagnostics

Unexpected failures at the executable boundary (including global errors and
unhandled rejections), daemon steps, effects, and frontend
projections/submissions are journaled **before** attempting a graph write.
Inspect `.exception` through the graph tools. These diagnostic entities have no
`entry`: they neither enter a conversation nor wake a model. Their
`content.body` contains JSON with the stack, recursive cause chain, timestamp,
process ID, phase, and session when known. Expected tool refusals retain the
existing `error` semantics.

The independent append-only fallback is `~/.harness/exceptions.jsonl`,
overridden by `HARNESS_ERROR_LOG`. It is synchronously appended and fsynced so a
broken SQLite connection or fatal event cannot erase the original failure. Files
are created mode 0600. If writing the journal itself fails, stderr receives the
original failure and journal error; graph persistence failures do not recurse.
Graph writes drain for at most 250ms at executable shutdown. Late graph failures
remain in the journal; automatic journal replay is not implemented.

Global handlers observe rather than suppress fatal runtime defaults, restoring
the terminal on the fatal path. Embedded users of `agent()` get daemon
diagnostics; the global hooks belong only to the executable lifetime. Known
API-key values, Bearer credentials and recognizable OpenAI keys are redacted;
arbitrary secrets embedded in third-party exception messages cannot be
exhaustively identified. No environment dumps or transcript snapshots are
captured. Treat logs as private. This cannot capture SIGKILL, power loss, or
errors before the executable loads, and OOM may prevent capture. Existing
model/tool exception entries remain governed by session execution; the reporter
does not reinterpret ordinary tool results. Transcript entries use `eid` and
session-local `entry.seq`, not human `entity.num`. Opening a database clears
historical entry numbers without renumbering tasks or other entities. The SQLite
allocator retains its pre-migration high-water mark, so old task/other human
identifiers cannot be reassigned. This is an idempotent storage upgrade;
candidate tests use temporary databases, never the live store.

Transcript positions are retained per session, including detached item anchors,
while asynchronous session reads are pending. **Ctrl+End** jumps to the
transcript end and resumes following; plain End still moves the input cursor.
Sidebar panels share the available height instead of letting a large session
tree hide Tasks, Context usage, or Keys. Wheel over a panel to scroll its
contents; tree keyboard selection is automatically revealed. Long tree labels
are clipped to one row.
