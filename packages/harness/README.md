# @yaks/harness

An agent runner over a graph, and the host that runs it on this machine with
SQLite persistence, command-line tools and a terminal interface. The runner
composes `@yaks/session` for model execution over graph-backed task and
transcript storage, and names no machine: it runs on a box or in a Cloudflare
Worker. The local host adds `@yaks/process` for running commands on this
machine, a Git checkout per delegated child, MCP servers, and the `~/.yak`
files. No server is required. Model calls may use an external provider; shell
tools run on this machine and are not sandboxed.

- `agent()` puts the session daemon on a graph and exposes session methods.
  Whatever touches a machine is an option its host lends: tools, remote tools,
  what a new session opens with, a step lock, defect reports, and what to
  release on close.
- `local()` is `agent()` here: it opens storage, lends the shell, checkouts,
  instruction files, images, MCP and the OpenRouter sign-in, and adds the
  terminal's entry rendering.
- `open()` creates or opens storage and registers vocabulary and plugins.
- `harnessTools()` combines shell, delegation and graph tools.
- `@yaks/harness/vocab`, `/rules`, and `/tools` expose schemas, graph rules, and
  tool implementations for `@yaks/cli` composition.

The graph stores sessions, transcript entries, tasks, process records, and
configuration in SQLite. Text bodies use blob tables in that database; binary
artifacts and private credential files live separately on disk. Frontend
selection and navigation state are local, with draft recovery files described
below. A **bundle** is one entity's components as a JSON object. A **batch** is
a list of changes applied in one transaction. The **host** is the process that
opened the graph. An **ask** is a recorded model request; a **settled** session
has finished its current turn without more calls to execute and can accept new
input.

## Exports

| Import                | Main exports                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `@yaks/harness`       | `agent`, `seed`, `sessionTitle`, `titleOf`, and their types; web platform only           |
| `@yaks/harness/local` | `local`, `open`, `dbPath`, `harnessTools`, `graphTools`, `parametersOf`, and their types |
| `@yaks/harness/tui`   | `App`, `tui`, `changes`, `panels`, and their types                                       |
| `@yaks/harness/cli`   | CLI `tools` and `own`                                                                    |
| `@yaks/harness/bin`   | Command-line entry point                                                                 |
| `@yaks/harness/vocab` | Vocabulary documents, `vocab`, schema `keywords`, and computed properties via `derived`  |
| `@yaks/harness/rules` | `rules({vocab, sql, vault})`, the graph plugins used by the harness                      |
| `@yaks/harness/tools` | `runs(host)`, implementations of the declared graph tools                                |

## Use

Run these commands from the repository root with Deno installed:

```sh
deno task harness
```

`deno task harness` with no verb opens the terminal UI. The transcript scrolls
and word-wraps beside the Sessions, Tasks, and Context usage panels. Enter
starts a session (or sends to the selected one); Shift+Enter inserts a newline.
Ctrl+N / Ctrl+P or Alt+Down / Alt+Up select root sessions, Ctrl+O selects a new
one, PgUp / PgDn scroll, and Ctrl+C quits. Shift+Enter needs a terminal
supporting kitty keyboard sequences (Alt+Enter also inserts a newline).

```sh
deno task harness new 'reply with the word pong'
deno task harness ls
deno task harness show <session>
deno task harness send <session> 'and again'
deno task harness tasks
deno task harness models
```

`$HARNESS_HOME` moves harness state without changing `HOME`: the defaults are
`$HARNESS_HOME/yak.db` and checkouts for children assigned tasks under
`$HARNESS_HOME/worktrees`, with `~/.yak` as the state directory when unset.
`$HARNESS_DB` (including `:memory:`) and `$HARNESS_WORKTREE_DIR` override the
individual places, as do `open(path)` and `local({worktrees})` in code. For
probes, set `HARNESS_HOME` and `TASKS_HOME` to scratch directories and clean
them up; `TASKS_HOME` moves the process supervisor's files (unless `PROCESS_DIR`
is set). Keep `HOME` unchanged so Deno reuses its module cache. If a probe must
move `HOME`, export the invoking `DENO_DIR` before moving it.

The model is `gpt-6-astra` unless `--model` names another, reached with
`$OPENAI_API_KEY` or the Codex CLI's sign-in (@yaks/openai).

```ts
import { local, open } from '@yaks/harness/local'
import type { Model } from '@yaks/model'

// A local model for this example; replace it with a provider adapter.
let model: Model = async (request) => ({
  id: crypto.randomUUID(),
  model: request.model,
  items: [{ kind: 'assistant', text: 'pong' }],
})
let a = local({ h: open(':memory:'), model, tools: [] })
try {
  let s = await a.start('reply with the word pong')
  await a.idle(s)
  for (let e of await a.transcript(s)) console.log(a.line(e))
} finally {
  await a.close()
}
```

For tests and embedded instances, pass the storage handle as `h`. Do not spread
`open()` into the options: `local({ ...open(':memory:') })` is rejected by both
the type contract and a runtime check. Without an explicit `h`, `local()` opens
the configured persistent database. A temporary working directory does not
isolate that database.

Settled subagents are hidden by default regardless of their assigned tasks.
Tasks remain available in the Tasks panel. **Ctrl+S** toggles **Show settled**;
NORMAL mode also provides `s`. Root sessions, the selected child, and ancestors
of active descendants stay reachable. Explicit archival remains separate. This
filter changes display/navigation only; completion messages and child
transcripts remain available. Failed and stopped children remain visible.

## Keyboard modes

**Ctrl+U cuts the entire draft in INSERT or VISUAL mode:** it saves the exact
source (including newlines) in the frontend's private `visual.yank`, requests an
OSC52 clipboard write, then clears the draft and resets its cursor. It does not
send a message. Empty drafts leave the clipboard alone. If the clipboard writer
throws, the draft is retained. If no writer is available, the draft is cut to
the local clipboard copy only. The status line reports the outcome; terminal
clipboard permissions can prevent OSC52 delivery, which cannot be acknowledged.
The local clipboard copy remains recoverable until replaced or its saved
recovery copy is removed. `Alt+p` inserts it into the draft. The standalone
textarea's Ctrl+U editing behavior is unchanged.

The composer starts in **INSERT** mode. Escape enters **NORMAL**, and `i`
returns to editing without changing the draft or cursor. NORMAL commands never
submit or type into the composer. `?` opens help; `?` or Escape dismisses it.
There is no permanent shortcut panel.

| NORMAL key                   | Action                                                  |
| ---------------------------- | ------------------------------------------------------- |
| `j` / `k`                    | Move transcript cursor down / up                        |
| `h` / `l`                    | Move transcript cursor left / right                     |
| `gg` / `G`                   | Transcript start / end; `G` resumes bottom-follow       |
| Tab                          | Switch transcript / sidebar focus                       |
| `Ctrl+w h` / `Ctrl+w l`      | Focus transcript / sidebar                              |
| `j` / `k` with sidebar focus | Select visible rows                                     |
| `n` / `p`                    | Next / previous root                                    |
| `o`                          | New session                                             |
| `t`                          | Toggle message / task composer                          |
| `a` / `z` / `s`              | Archive selected session / show archived / show settled |
| `v`                          | VISUAL selection of rendered transcript text            |
| Ctrl+U / Ctrl+D              | Move selection half a page up / down                    |
| Ctrl+B / Ctrl+F              | Move transcript selection a page up / down              |
| `i`                          | Return to INSERT                                        |

In VISUAL, `hjkl` extend selection, `y` copies and returns to NORMAL, and Escape
cancels to NORMAL. Tab cycles selectable surfaces. In INSERT, Alt+v starts draft
selection. Draft selection uses source text; transcript selection uses rendered
text and can span retained entries. Enter opens the selected entry's source.
This is not a full Vim editor. Normal `gg` is a two-key sequence, canceled by
any intervening command or leaving the mode, with no timing requirement.
Bracketed paste in NORMAL is ignored rather than interpreted as commands.

Existing modified navigation shortcuts remain available for compatibility.
Ctrl+C always quits; Ctrl+End follows the transcript end. Plain `?`, `hjkl`, and
`y` still type normally in INSERT. Mode/focus/help state belongs to the
frontend's private graph, while the TUI key-routing and text-surface APIs are
graph-independent.

In INSERT mode, Tab toggles the visible composer mode between **message** (the
default) and **task**, without changing the draft. Task mode requires a selected
session; Enter calls `a.taskEntry(session, text)` to create a `doc` and a bare
`task{}` (no filing metadata), contain it under the session's claimed tasks, and
spawn a child that claims it. With no claimed tasks, containment is under the
session itself. The first line (up to 120 characters) is the title; the entire
text is the body. The queued execution request, task, edges, child and claim are
one atomic write through `taskEntry(graph, session, text, limits?)` from
`@yaks/session`. A rejected submission creates nothing and appears by the
composer. The parent stays selected and available for messages; the child and
its open/wip task appear in the sidebar, and completion arrives in the parent
transcript without a keypress.

Typing only touches the editor. Post-commit graph effects refresh the content,
including model replies arriving while stdin is idle; there is no polling loop
for transcript refresh. The sidebar is `Opts.panels` in `app.ts`: each
contribution in `panels.ts` is `{title, read, Render}`, with `read` returning
bundles from graph-backed interfaces. To embed the app, mount `App` with
`{agent: a, subscribe: changes(a), panels}`; use
`run(() => h(App, opts), {backend})` to choose a terminal backend.

## What it is made of

- **Persistent state.** A transcript is `entry` entities, what it ran is
  `process` entities, the work is `task` entities — @yaks/session, @yaks/process
  and @yaks/task over @yaks/sqlite. Storage initialization and migrations use
  SQL; normal agent operations use the graph API. Session state is persisted;
  running sessions can be queried with `.session.status=running`.
- **Two statuses are computed, never stored.** `@yaks/harness/vocab` registers
  computed session and task status properties through `@yaks/session/vocab`. The
  task plugin uses the same `taskMarks` from @yaks/session: completed/cancelled
  win, then a claim means wip, otherwise open. `blocked` stays a component of
  its own, never a status. Queries filter in the database, and the sidebar reads
  that same status.
- **Work need not be filed.** `doc` + bare `task{}` is a task without project
  metadata; optional `filed{project, priority, domain, assignee}` adds project
  and assignment metadata. `a.tasks()` reads `.task.status=open,wip`, oldest
  first, without requiring filing or a project. The CLI and sidebar use that
  same interface.
- **Tools use the session's graph.** `harnessTools()` combines process,
  delegation, artifact, text-inspection, and generic graph tools (`graph_apply`,
  `graph_query`, `graph_show`, `graph_schema`). Existing JSON Schemas are
  retained; Zod arguments are converted to JSON Schema for the model.
- **Restart recovery.** `open()` releases execution leases whose holders are
  absent from the graph; `resume()` schedules sessions with unfinished work.

## Not here

The standalone harness does not run a sync service or HTTP server. It does not
keep a separate persisted log of pending effects; `resume()` restarts work from
the session records. The terminal renderer and its widgets come from @yaks/tui.

## Compatibility

The executable and main module require Deno with filesystem, environment, and
subprocess permissions. SQLite comes from `jsr:@db/sqlite`. Vocabulary exports
can also be loaded by a browser.

## Forks and subagents

The default tool table includes `fork`, `spawn`, and `wait`:

- `fork({prompt, instructions?, model?, effort?})` continues the caller's
  transcript prefix **before the current tool turn**, then adds the prompt.
  Unanswered calls are not inherited. It returns a concurrent child session id.
- `spawn({prompt, instructions?, model?, effort?})` returns a fresh child
  session id. It inherits the serving configuration, not the transcript. `model`
  accepts a model name or an existing model entity id; the inherited provider
  stays while it serves that model, and otherwise the provider that serves it
  answers. A name no model has yet becomes a model the inherited provider serves
  under that name.
- `spawn({task, instructions?, model?, effort?})` instead accepts a task eid or
  `T-<number>`. The child's first input records its title and body when
  submitted; its claim commits with the child, so the task is wip as soon as it
  is created. Choose exactly one of `prompt` and `task`. Independent subtasks
  can run in parallel; tree ordering is through `requires`/`contains`, not
  priority.
- `wait({children: [id, ...], timeout?: milliseconds})` waits on direct children
  and returns their statuses and output. The default timeout is 60 seconds;
  timing out leaves the children running.
- `wait({tasks: [id, ...], timeout?: milliseconds})` returns each task's
  `{task, status, done}`. Shared @yaks/task `done()` requires a settled task
  (completed or cancelled) with no unfinished tasks directly referenced by
  `requires` or `contains` edges. Timeout returns the current state without
  cancelling work.
- `wait({process, timeout?})` still waits on a shell process. The tool table
  exposes one merged `wait`: choose exactly one of process, children, or tasks.

A child carries `spawned{parent, call}`; a fork additionally has `fork{from}`.
`a.children(session)` reads that structure. When a child settles, the daemon
queues a completion receipt behind any active parent step: a result if the
originating call is still open, otherwise an input that wakes another parent
turn. Failed/stopped children also report their terminal outcome. A stopped
parent is not revived. When its claimed task is done, a child with no active
work delivers `task T-<number> <status>` plus its final message, with the
idempotent receipt id `delivery:<child>:task:<task>:<status>`. A child settling
before the task is done still reports its outcome, using a receipt id derived
from its final entry. `resume()` reconciles missed receipts without repeating
ones already received. Fork/spawn calls themselves are idempotent by call id.

`local({maxChildren: 32, maxSessions: 64})` sets the defaults explicitly. Child
submissions return an ID and a persisted `dispatch.state=queued` record;
`session.status=queued` distinguishes waiting children from active or settled
ones. One scheduler per graph runs up to `maxChildren` child callbacks across
all parents (32 by default). FIFO submission order is durable; resumed nested
waits reacquire a slot before returning. Root sessions do not consume child
slots; `maxSessions` remains a limit checked when starting a root session. A
waiting delegated parent releases its slot, so capacity one supports nested
delegation. Worktree preparation runs only when a queued child is selected to
execute; failures and queued cancellation terminate with a completion message.
Restart recovers interrupted scheduling; spawn replay preserves ID and fork
boundary. `a.d.stop()` immediately prevents new execution and waits for running
storage callbacks; it does not empty the persisted queue or complete assigned
tasks. Use `await a.close()` to stop the daemon and close the harness database.
Independent supervised processes are untouched. This is a single-daemon pool,
not a distributed lease or a security boundary against arbitrary graph writes.
Provider limits still constrain model throughput. Scheduling does not reduce the
context sent to providers or the cost of frontend data refreshes.

`tools` replaces the default table when supplied. `sessionTools(graph, limits)`
from `@yaks/session` is the standalone delegation table (its scheduling queries
use the registered `session.status` derived property).

## Performance probe

```sh
deno run -A packages/harness/perf.ts
```

This reports warmed median/p95 fresh-entry apply time and the subsequent
`react()` step's model-dispatch overhead with a fixed 1,000-entry SQLite
transcript. It uses a fake model and measures no network time. The SQLite/daemon
integration suite lives under `packages/`, outside the repository's fast test
tier.

### Auto-task lifecycle context

Task-mode submission writes a passive `notice` entry into the parent transcript
in the same batch as the task and child. It records the original request and
user-created origin. A notice neither wakes the parent nor changes its derived
status; the next model request includes it. Completion still wakes the parent,
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

<a id="subagent-git-homes"></a>

### Subagent working directories

Sessions carry `home{worktree,cwd}`. The worktree reference names a shared Git
checkout entity owned by `@yaks/git`; cwd is a separate optional command
default, not an isolation boundary. Root starts discover the existing checkout.
Legacy sessions attach lazily on their first shell call. Ordinary children
inherit home without making a checkout.

`spawn` and `fork` accept `worktree: {path, base?, branch?}` to create a
checkout, or `home: <worktree-eid>` to attach an existing one. These are
mutually exclusive. `cwd` can override the command directory independently. The
child and its initial input are recorded as queued before preparation. The
scheduler prepares the checkout before executing the child. The generic session
package only exposes a host preparation hook; it knows no Git.

A new worktree defaults to detached committed HEAD, not the parent's dirty
files. Its root becomes the default cwd unless explicitly overridden. Shell
resolution is per call → persisted session cwd → home worktree root → harness
directory; it inherits the harness environment. This is not sandboxing. Failed
Git preparation is recorded on the `checkout` entity and the failed child
session, with a completion receipt to the parent. Retrying preparation
reconciles the same path.

The harness removes a child checkout only after the session ends and the
checkout is clean with HEAD reachable from another branch (`worktrees.ts`).
Session completion is determined from the transcript: a `stop` entry, an
exception, or a finished turn with no pending calls. If the session has an
associated process, that process must also have exited. A settled dispatch
record alone is insufficient. No merge is performed; dirty checkouts and commits
not on another branch are retained and reported. Before removal, the graph
records the checkout's current branch and commit. If the session resumes, the
harness recreates the checkout at the same path, branch, and commit before
executing further work.

<a id="prompt-context-pilot"></a>

### Instruction files and prompt history

`prompt{scope,source,revision}` on an entry explicitly marks its `content.body`
as instructions for model requests. Ordinary file reads and tool results never
gain instruction status. `agent.instruct(session, text, source)` appends local
instructions; it is an explicit wake-producing operation, not a passive notice.
OpenAI receives ordered developer messages, including instructions added during
the conversation.

Root sessions snapshot global `~/.agents/AGENTS.md` then ancestor `AGENTS.md`
files from filesystem root to cwd. Missing files are ignored, other read errors
prevent session creation. Each file's canonical path and content SHA-256 are
recorded. No mtime sorting or retrospective reload occurs. Existing
`opts.instructions` and `using.instructions` remain the legacy base instruction
channel; delegated `instructions` now append local guidance rather than
replacing that base.

Fresh children copy shared prompt snapshots from their parent. Forks copy no
files: their exact inherited prefix is followed by a local fork-execution note,
optional child guidance, and the assignment. Fresh children intentionally
inherit the parent's file snapshots even when assigned a different home; loading
instruction files from the new directory requires an explicit action. A
renamed/deleted source doesn't alter history. This implementation is designed
for a local POSIX filesystem; it doesn't yet provide UI controls for choosing
instruction files, or prompt supersession. Prompt entries have a query-matched
transcript renderer that shows one clipped line with sequence, scope, and source
name. Instruction text remains stored and is sent to the provider unchanged;
compact display does not remove it from context. Fork notes are guidance, not a
prohibition on useful delegation. Provider cache hits are not guaranteed.

#### Prompt history and cache limits

`prompt.revision` is the file content SHA-256, not an identity for a full model
request. Ordered snapshots, the fork boundary and recorded base instructions
preserve instruction history. There is no aggregate request-prefix identity,
cache-retention registry, automatic prompt refresh or supersession. Provider
cached-token counts do not guarantee that a particular prefix remains cached.

Task completion receipts use `completed.by`, the author of the completion. Graph
tools sign writes with their calling session; `@yaks/task` fills a missing `by`
from that actor on the first completion mark. A named completion author is
preserved, including when recording a completion after the fact. If the
receiving parent authored the completion, its previously delivered child result
is not echoed back or used to wake it again. New child responses still arrive.
Child, other session, and anonymous/external completions retain their normal
receipts. The author survives restart; marks without `by` are treated as
external. Removing and recreating a completion mark records the new author;
editing an existing mark preserves its original author.

### Session tree

Sessions are grouped beneath their root, with assignment titles and compact IDs.
Branches are always open. `Ctrl+j/k` traverse selectable sidebar rows in visual
order, including New session and tasks. `Ctrl+h/l` focus the transcript/sidebar.
Panels expose selectable contributions alongside their renderers, so navigation
follows the same panel order as rendering. Selecting a claimed task opens its
worker session; an unclaimed task stays highlighted without changing transcript.
`Ctrl+N/P` (also Alt+Down/Up) switch roots, skipping descendants. The selected
row has a subtle background; tree connectors show relationships without
selection or expansion arrows. `Ctrl+S` reveals settled children.

Ctrl+h and Ctrl+j require extended keyboard reporting to distinguish them from
Backspace and Enter. Legacy Backspace/Enter continue editing/submitting; they
are never reinterpreted as navigation. Ctrl+k is reserved for navigation in the
harness (the standalone textarea retains its kill-to-end binding). Plain hjkl
still types; VISUAL mode retains priority.

The Tasks panel shrinks to their content within bounded shares. Context usage is
last at the bottom; the session tree receives remaining height and scrolls.

`Alt+a` archives/unarchives only the selected session, never its root. `Alt+z`
shows archived roots so they can be selected and restored. Archiving writes a
persistent `archived` component: it neither stops execution nor removes history.
Archiving a session hides its subtree; descendants receive no additional archive
marks. Selection and visibility preferences live only in the frontend graph. The
tree supports both keyboard navigation and mouse row selection.

Session titles are read from original local input, excluding inherited fork
history and instruction/notice entries. This adds transcript reads when graph
data is refreshed, rather than on each keystroke. The asynchronous frontend data
adapter and its performance limits are documented in
[Frontend implementation](FRONTEND.md).

### Defect diagnostics

Unexpected failures at the executable boundary (including global errors and
unhandled rejections), daemon steps, effects, and frontend
projections/submissions become an `exception` entity in the graph. Inspect
`.exception` through the graph tools. These diagnostic entities have no `entry`:
they neither enter a conversation nor wake a model. Their `content.body`
contains JSON with the stack, recursive cause chain, timestamp, process ID,
phase, and session when known. Expected tool refusals retain the existing
`error` semantics.

There is no second journal. If no graph is available or the diagnostic graph
write fails, the record is written to stderr as one JSON line. A failed
diagnostic write includes the original failure without recursively attempting
more graph writes. Graph writes drain for at most 250ms at executable shutdown.

Global handlers observe rather than suppress fatal runtime defaults, restoring
the terminal on the fatal path. Embedded users of `local()` get daemon
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
identifiers cannot be reassigned. This storage upgrade is idempotent.

Transcript positions are retained per session, including detached item anchors,
while asynchronous session reads are pending. **Ctrl+End** jumps to the
transcript end and resumes following; plain End still moves the input cursor.
Sidebar panels share the available height instead of letting a large session
tree hide Tasks or Context usage. Wheel over a panel to scroll its contents;
tree keyboard selection is automatically revealed. Long tree labels are clipped
to one row.

### Inspecting large tool results

The standard tools include `graph_value_read` and `graph_value_search` from
`@yaks/blob`. Tool-result bodies over 16,384 Unicode code points are replaced in
model requests by a short preview and a revisioned graph address. The full
result remains in the transcript and blob-backed storage. This applies equally
to shell output and large graph-tool responses. User messages and instruction
snapshots are unchanged. Set `outputLimit` on `agent()` or `local()` to change
the threshold.

Read accepts `entity`, `component`, `property`, `start`, `count`, and optional
`revision`. Search accepts the same address with a literal `query` and bounded
`limit`. These tools inspect any authorized text property, including `doc.body`,
not only tool results. They don't open files or grant access through a raw hash.
See [`@yaks/blob`](../blob/README.md#bounded-text-inspection-for-tools) for
range units and [`@yaks/context`](../context/README.md#large-tool-results) for
policy limits.

## Worker runtime

The TUI runs the backend in a Web Worker and communicates using `postMessage` by
default. See [the worker runtime](WORKER.md) for ownership, measurements,
shutdown behavior, and unresolved subscription/backpressure issues.

## Generated images

Native image generation is enabled by default on Responses requests, including
Codex OAuth, unknown models, and custom endpoints. The server decides support;
there is no model allowlist or startup capability probe.

Set `HARNESS_IMAGES=0` or pass `images: false` to disable it. `HARNESS_IMAGES=1`
explicitly enables the default behavior. Programmatic image settings override
the environment. Worker mode uses the same configuration.

An unsupported tool can cause the entire request to be rejected. The adapter
preserves the provider error instead of silently retrying without the tool.
Current provider errors do not reliably distinguish unsupported image tools from
other invalid requests, so there is no negative capability cache or speculative
fallback. Disable images explicitly if your endpoint rejects them.

Binary bytes use `@yaks/blob`'s external file backend under
`$HARNESS_HOME/images` (default `~/.yak/images`), or `HARNESS_IMAGE_DIR`. This
directory is made private. Keep it with database backups. Do not point it at an
unrelated shared directory: the harness enforces mode 0700 on it.

Configure it in code with:

```ts
local({
  h,
  name: 'gpt-4.1',
  images: { directory, tool: { output_format: 'png' }, maxBytes: 33554432 },
})
```

`remote` accepts the same cloneable `images` options; storage callbacks are
constructed inside the worker. Custom model implementations own their own
artifact storage configuration.

Images are persisted before their graph references, with content-derived
artifact IDs and attachment entries associated with the original ask and
session. The transcript shows an artifact label rather than base64. Generated
images are replayed as textual artifact references unless explicitly inspected
with `image_view`. Optional Kitty graphics display and explicit image inputs are
described below. Automatic blob cleanup and an image-editing tool are not
implemented.

For example, with `OPENAI_API_KEY` configured:

```sh
deno task harness new --model gpt-4.1 'Generate an image of a small garden'
```

This is a paid provider operation, not a test command. No live generation is
performed merely by enabling the option; the model decides whether to invoke it.

### Inline generated images (experimental)

Set `HARNESS_GRAPHICS=kitty` to display fully visible PNG attachments using the
Kitty graphics protocol. This is separate from image-generation enablement. The
default remains a text artifact label. Both inline and worker modes resolve
registered artifact entities through the configured external image store;
neither accepts arbitrary file paths. Reads check the artifact's size and
SHA-256 hash. Back up the image directory with the graph database.

Attachments reserve eight terminal rows. Their bytes load only when the complete
rectangle is on screen; partially visible attachments show a label. PNG files
above 4 MiB, other image formats, unavailable files, and load failures also
retain the label. Scrolling, resizing, and session changes remove old
placements. VISUAL mode continues to select the artifact's textual label, not
image pixels.

In tmux, enable `allow-passthrough`; the harness wraps graphics commands when
`TMUX` is set. SSH requires no server-side display. This renderer does not
negotiate terminal support: only enable it on terminals supporting Kitty
graphics. Visual placement in iTerm2 still needs user verification.

The worker's image read uses a bounded `Uint8Array` postMessage result; it is
structured-cloned, not transferred. This copies up to 4 MiB per cache miss. No
base64 enters the replicated graph or transcript. The renderer keeps eight
images and does not re-upload bytes on each keystroke. Partial clipping,
JPEG/WebP display, progress/error indicators, and terminal capability discovery
are future work.

Transcript appends now allocate integer positions transactionally. On first
startup after this upgrade, the harness repairs legacy fractional positions in
one transaction, preserving entry identities and fork boundaries. This is an
O(history) one-time operation; subsequent startups use a migration marker. Do
not run an older harness writer concurrently during the upgrade. Normal appends
query the latest local entry, not the entire transcript.

## Importing, attaching, and inspecting files

The default tools include:

- `artifact_import({path})`: copies a regular local file (up to 20 MiB) into
  external artifact storage. Relative paths use the calling session's directory.
  Later changes to the source file do not change the stored snapshot. Importing
  does not attach the file or expose its contents to the model.
- `artifact_attach({artifact})`: attaches an existing artifact to the current
  tool-call entry for the user. Images can use the configured terminal renderer;
  other formats retain a reference label. This does not enable model vision.
- `image_view({artifact})`: explicitly supplies a registered PNG, JPEG, or WebP
  to the model following the inspection result. This requires a vision-capable
  provider/model. There is no automatic retry with the image removed.

The tools use the same external storage directory as generated images. Image
bytes are verified against the registered hash and size. The graph stores the
reference, audience, and inspected revision, not base64. The OpenAI adapter adds
an `input_image` user message after the tool results. Only the outgoing provider
request contains a data URL. The original tool call/result pair remains intact.

A replay, including inherited fork history, includes explicitly viewed images
again; continuation requests include only inspection results in their new
window. User-only attachments never become model image inputs. Changing an
artifact reference after inspection fails the revision check instead of sending
new bytes under the previously approved revision. Requests are limited to 20 MiB
of inspected images. These tools currently inspect signatures rather than fully
decoding images; animated GIF, SVG, remote URL import, and video are
unsupported. Unknown imported files receive `application/octet-stream`.

Responses stream by default. Set `HARNESS_STREAM=0` or pass `streaming: false`
to disable streaming. See [STREAMING.md](STREAMING.md) for lifecycle and
limitations.

### Provider web access

Native OpenAI web search is enabled by default, including OAuth configurations.
Supported models can search, open pages, and find text within pages. Disable it
with `HARNESS_WEB=0`, or pass `web: false` to `local()` or `remote()`. Explicit
programmatic configuration takes precedence over the environment. The worker
receives the same configuration. Final response citations appear as source
links. This is provider-hosted browsing, not an unrestricted filesystem/network
fetch function; provider compatibility errors remain visible.

Transcript selection is controlled by the frontend graph. The generic TUI
`VirtualList` accepts `selected` and `onSelect`; navigation reveals the selected
item without measuring the full history. Key routing and help share a binding
registry in `keyboard.ts`. Ctrl+U cuts the draft in INSERT/VISUAL, but moves
half a page in NORMAL. Tab remains a compatibility focus shortcut.

## Runtime inspection

In NORMAL mode, press `r` to open a runtime panel for the selected session and
its direct children. `j`/`k` select a row; `r` or Escape closes it. The panel
shows queued, generating, waiting-for-tool, interrupted, and terminal states.
Durations are time since the displayed request or last activity, not provider
billing time. Only the visible panel updates its clock (once a second); clock
updates do not query the backend unless a domain change is pending. Domain
notifications are coalesced to at most one read per second while visible.

- `x` requests cancellation of the selected model request, or cancels a queued
  session before execution. Cancellation uses `AbortSignal`; a custom model must
  honor it. It does not terminate independent processes or cancel tasks.
- `c` submits an explicit continuation instruction to an idle or interrupted
  session. It does not resend an interrupted HTTP request. Running and stopped
  sessions are not resumed through this action.

The read API is `agent.runtime(session)`; actions use
`agent.control(session, 'interrupt' | 'cancel-queued' | 'resume')`. The worker
frontend exposes the same operations. Queued cancellation uses a graph
precondition, so a stale panel cannot cancel work that has already started.
Provider cancellation has no remote completion acknowledgment: the panel reports
that cancellation was requested, not that the server stopped billing or that an
external operation was undone. Process termination remains the separate,
explicit process tool; this panel intentionally does not offer a kill-all
action.

### Draft recovery

Draft text, cursor, and message/task mode are restored per session, including
unsent new-session text. Recovery stays on the frontend machine, not the backend
or model. `Ctrl+U` cuts to the clipboard and saved local copy; `Alt+p` restores
that copy. Failed or interrupted submissions restore editable text rather than
automatically resending it.

Local unencrypted recovery files use private permissions under `~/.yak/drafts`.
Set `HARNESS_FRONTEND` for a stable named profile and `HARNESS_DRAFT_DIR` to
relocate storage. See [frontend state](FRONTEND.md#local-draft-recovery) for
isolation, retention, and crash-recovery limits.

The CLI and terminal frontend do not add a built-in agent description or style
instruction. Instruction files are loaded through `@yaks/context`; callers can
still supply explicit `instructions`. Existing sessions retain their recorded
request history, but the retired built-in harness instruction is omitted from
future requests. A restart loads this behavior; it cannot retract instructions
from a request already in progress.

## Transcript loading

The UI loads a 64-entry window around the bottom or saved entry position, then
loads overlapping ranges on navigation. Context usage reads only the newest
reported usage fields. Full model history is unchanged. See
[WINDOWS.md](WINDOWS.md) for the subscription design, benchmark, and entry-size
limits.

### Cooperative migration announcements

The harness checks the SQLite migration control table before installing its
application schema. A pending/failed announcement refuses startup. While
running, it polls that table once per second. A new announcement or completed
generation stops new execution, drains active work, and closes the database;
subsequent commands report that a restart is required. It does not automatically
restart the worker. `migrationPollMs` can configure the interval in
`agent`/`remote` options.

Migration tooling can use `h.migrations.run(name, callback, options)` from an
otherwise idle handle, or `migrations(driver)` on a dedicated connection. The
migrator must allow at least the longest participating polling interval. See
[@yaks/sqlite migration announcements](../sqlite/README.md#preannounced-migrations)
for failure recovery and timing limitations. In particular, the grace period is
not a guarantee that all active callbacks finished.

This version protects only **explicitly announced migrations**. Existing
synchronous `open()` schema installation and legacy startup conversions have not
been converted to asynchronous preannounced migrations. Do not assume opening a
new harness version is coordinated with older running connections. Stop those
connections before such upgrades. Already-completed migrations are not a version
compatibility check when an older binary first opens the file.

## The harness as a plugin module

The harness exposes separate sub-module exports for composition:
`@yaks/harness/vocab` supplies schema documents and computed properties,
`@yaks/harness/rules` supplies graph plugins, and `@yaks/harness/tools` supplies
tool implementations. `store.ts` uses the same definitions for its SQLite file
that `@yaks/cli`'s `compose` uses for a database exposed by a server. The
configured server can expose these graph operations over HTTP; importing these
modules does not start the session daemon, open a database, or start a server.

The executable accepts `session list` and `list session`, returning session
bundles as JSON. The same definition is exposed as MCP `session_list` through
the MCP adapter. Both word orders on the command line derive from the same Tool
noun/verb fields, without alias declarations. `bin.ts` passes `@yaks/cli`'s
`cli()` one flat list — the graph's tools, then the harness's own — and there is
no plugin registration in between. See
[the command-line entry point and the export shape](../cli/README.md).

Mouse clicks select session rows, **New session**, and task rows in the sidebar.
A claimed task opens its worker session; an unclaimed task selects only the row.
Clicking a row focuses the sidebar without changing the current mode or
submitting the draft. In INSERT mode, typing continues in the composer. The
whole painted row, including its trailing background, is clickable. Mouse
reporting must reach the application through the terminal/multiplexer.

### Transcript previews

Shell calls show the command from their arguments. Tool results remain literal
and dim, with previews limited to five displayed rows (and 2,000 source code
points). Truncated previews are labeled; stored text and provider context are
unchanged. Explicit source selection and graph-value inspection still use the
full text. User input is rendered as normal-brightness Markdown inside its
dim-bordered box.

## Remote MCP tools

Optional MCP server configuration is shared by sessions and connects through
`@yaks/mcp-client`. No servers are enabled implicitly.

MCP server definitions live in the harness graph, shared by all sessions. Add a
server with `graph_apply` (or ask an agent to add it):

```json
[
  {
    "entity": { "eid": "$server" },
    "mcp_server": { "name": "yaks.app", "url": "https://yaks.app/mcp" }
  }
]
```

Press **Esc**, **A** to authorize the server. Server rows persist across
restarts; configuration changes take effect on the next model request, without
restarting. The panel identifies each server by display name and EID and reports
invalid definitions. Query `.mcp_server` to list them. Set `mcp_server.enabled`
to `false` to disable a server, patch its URL or options to edit it, or remove
its `mcp_server` component to remove it. The `$server` alias in the write above
asks the graph to generate a UUID; use the returned EID for later edits. The
server name supplies a readable tool namespace: `yaks.app` exposes `app_list` as
`yaks_app__app_list`. Renaming changes future exposed names, not the server
entity or its OAuth credentials. Distinct configuration revisions have derived
UUID tool entities, so changing an endpoint cannot retarget already-issued calls
even when their exposed names are identical. Names that normalize to the same
namespace are rejected. Remote names are passed unchanged to `tools/call`; names
that cannot fit the provider's 64-character alphanumeric/underscore/hyphen
format are reported rather than hashed.

Optional fields are `credential` (a hostname reference into the existing yak
bearer store), `allow` (a JSON-encoded array of exact remote tool names), and
`redirect_url`, `client_id`, `client_metadata_url`, `scope` for OAuth settings.
Omitting `allow` exposes all discovered tools; `"[]"` exposes none. The graph's
current vocabulary stores this list as JSON text. Token values, callback codes,
and verifiers never belong in these fields. A sign-in is a connection the server
entity owns; changing the endpoint signs in anew, and renaming a server does not
invalidate its sign-in.

A `credential` hostname must match the endpoint hostname. `yak login <token>`
stores a bearer; it does not initiate OAuth. `YAKS_TOKEN` retains its existing
credential override behavior. This is independent of model-provider credentials.
No other agent's configuration is discovered automatically.

Disabled/removed/reconfigured servers disappear from subsequent model requests.
Handlers already offered to a request keep their original connection so their
results can still be delivered. Retired connections close when the harness
drains and shuts down; repeated edits can therefore retain transports until
shutdown. Invalid or unavailable optional servers do not block other servers or
ordinary chat; open the authorization panel to inspect their errors. Treat
descriptions/results as data, not instruction files.

The backend worker owns these connections; sessions share configuration, not new
connection definitions. Discovery occurs at execution boundaries, never while
typing. List-change notifications affect later tool snapshots, not requests
already dispatched. Remote tools use deterministic namespaced names;
descriptions and metadata identify their source. The existing session executor
writes normal call/result entries—there is no second MCP executor.

Text and structured output use ordinary transcript storage and large-output
references. Image/audio/embedded binary resource blocks are stored through
external blob storage and attached as artifact references; they are not
automatically sent back as model vision inputs. Binary blocks are limited to 20
MiB each. Transport failures and `isError` tool replies are expected tool
errors, not silent success. The client never automatically retries a remote
mutation. Re-sign in and restart after an authentication/connection failure.

This integration is tools-only Streamable HTTP. It does not implement stdio or
resources/prompts selection. Browser OAuth and reconnect after sign-in are
described below; failed tool mutations are not automatically retried. The local
mock publish flow is tested; no public mockup is published during tests.

In-flight tool handlers are retained locally when a later discovery snapshot
changes; a server withdrawing a tool does not silently substitute a different
handler for an already-issued call. This is not durable remote capability
versioning: after restart, removed tools cannot be reconstructed from their old
schema alone. The server remains responsible for validating current invocation
arguments and permissions. The retained handler map is process-lifetime state.

### Transcript cursor and source detail

In NORMAL, `hjkl` moves a block cursor over the rendered transcript. The entry
containing the cursor retains a subtle background. `v` extends an in-place text
selection, `y` copies it, and Escape cancels it; Markdown stays rendered
throughout. `i` returns to the composer and hides the transcript
cursor/highlight. Use `Ctrl+w h` / `Ctrl+w l` to focus transcript/sidebar; Tab
remains an alias. Sidebar `j/k` still selects its rows. Half/full-page and
`gg/G` navigation remain.

Enter explicitly opens the current entry's source, including compact prompts and
clipped tool output, in a bounded detail panel. `j/k` scroll the chunk, `[` /
`]` fetch adjacent chunks, and Escape returns to the transcript. Source reads
are authorized through the session's fork ancestry and revision-checked, with at
most 4,096 Unicode code points per read. This does not restore transcript
search. A source change while paging requires closing and reopening the detail.

Rendered copies omit box/table borders and generated padding and join ordinary
soft wraps. They are bounded to retained measured entries and 65,536 UTF-16
units; a larger or evicted range reports an error instead of silently copying
less. Viewport reflow retains the entry identity and clamps row/column, rather
than promising stable character identity through arbitrary live Markdown
changes. The composer keeps its existing explicit source-text selection
behavior.

### Sign in to an MCP server

Add an `mcp_server` entity as above, then press **Esc**, **A** in the TUI.
Choose a server with j/k and Enter. Open the displayed authorization link in
your browser. After approval, copy the complete return URL from the address bar
and paste it into the authorization panel; press Enter. The return URL is hidden
and never sent to the model, a transcript, or draft recovery storage. Esc
cancels.

The default callback is `http://localhost:8765/oauth/callback`. No listener is
started, so a browser connection error at that address is expected; copy the
address bar anyway. If a server requires pre-registration, add the `client_id`
and `redirect_url` fields to its `mcp_server` component, with `scope` or
`client_metadata_url` when required. The callback must match the registered
redirect. Browser and provider policies can restrict this copy-address-bar
workflow.

A sign-in is a connection ([@yaks/connections](../connections)) the server
entity owns, through an integration discovered from the server
(`@yaks/mcp-client/oauth`) that also keeps the client registered there. The
graph holds the connection's handle, and the vault beside the database
(`~/.yak/secrets`, private files) holds the tokens. Pending logins do not
survive restart. Existing `credential` bearer configuration remains a fallback.
Successful OAuth connects the shared server and makes its tools available on the
next model request. Unauthorized optional servers are omitted until signed in;
other discovery failures remain errors. Tokens refresh through the connection,
not a model tool.

A program embedding the harness can call `authorizeMCP` on the agent, passing an
action — `'list'`, `'begin'`, `'complete'` or `'cancel'` — and optionally a
server name and a return URL. These calls are controls for the embedding
program, not agent instructions. Never paste a return URL into the ordinary
conversation input.

## OpenRouter

OpenAI remains the default. OpenRouter is a separate provider, selected through
ordinary graph model configuration, with its own credentials. Add configuration
(the `$` names create entities in this write):

```json
[
  { "entity": { "eid": "$router" }, "provider": { "name": "openrouter" } },
  { "entity": { "eid": "$model" }, "model": { "name": "claude-sonnet-4" } },
  {
    "entity": { "eid": "$offer" },
    "edge": { "from": "$router", "to": "$model" },
    "serves": { "name": "anthropic/claude-sonnet-4" }
  }
]
```

A provider and a model are each their name: the ids are derived from it, so
writing this twice writes it once. The `serves` edge is the provider's offering
of the model, and its `name` is what OpenRouter calls the model — what every
request it serves asks for.

Choose a model identifier available to your OpenRouter account. Then press
**Esc, A**, select **OpenRouter (model provider)**, open the authorization URL,
and paste the full return URL into the private authorization input. No callback
listener runs: a browser connection-error page is expected; copy its address
bar. The API key is kept as a connection the provider owns
([@yaks/connections](../connections)): its secret is in the vault, never in the
graph, transcript, or draft. This is a separate account from MCP servers and
OpenAI; existing credentials are never borrowed. No model request is sent merely
by configuring or authorizing the provider.

To select that model for a session, append an entry containing `using` with the
returned provider/model EIDs. This selects the next request intentionally:

```json
{
  "entity": { "eid": "$message" },
  "entry": { "session": "<session UUID>" },
  "using": { "provider": "<provider UUID>", "model": "<model UUID>" },
  "content": { "body": "Continue using the selected OpenRouter model." }
}
```

An existing model entity ID (EID) can also be passed to `fork` or `spawn`. The
parent's provider stays while it serves that model; otherwise the one provider
this harness can reach that serves it answers, and a model two reachable
providers serve needs the provider named in `using`. The command
`harness new --provider openrouter --model vendor/model 'message'` creates a new
session under that provider; authorize beforehand in the TUI. Embedding
applications can use `local({provider: 'openrouter', name: 'vendor/model'})`;
configuration is recorded in the graph. Tests can inject
`providers: {openrouter: fakeModel}`.

OpenRouter Responses is stateless: full applicable context is sent on every
request, including forks. Provider/model switches don't reuse another model's
stored response ID for continuation. Native OpenAI image generation and web
search are omitted; regular function tools and explicit image inputs remain
model-dependent.

The model selector below lists configured models; it does not fetch the
OpenRouter catalog or expose OpenRouter provider-routing options. The shared
graph `provider`/`model` records are the configuration source. Credential files
are private plaintext, not encrypted; PKCE completion has been tested against
mocks, not a live account.

### Choosing a model in the TUI

Press **Esc, m** to open the model selector. It lists every offering in the
graph — each `serves` edge, shown as model and provider. Use **j/k** or arrows
and **Enter**, or click a row. **Esc** cancels without changing the draft. The
choice records both the model and the provider that serves it.

With **New session** selected, the choice applies when that draft is submitted;
it does not change the harness default or another session. For an existing
session, the choice appends a passive `notice` + `using` configuration entry. It
does not send an invented chat message or start a model request. The
`Model (next)` label shows the choice for future requests; any request already
running keeps its original model. Historical request configuration remains
unchanged. Forks inherit the effective configuration.

The selector reads the configured catalog when opened; it does not fetch a
provider's model catalog or prices. Authorize the provider with **A** first.
Selection itself neither performs authentication nor contacts the model; an
unauthorized request reports the provider error rather than falling back to a
different provider. This is a local selection UI, not automatic model routing.
