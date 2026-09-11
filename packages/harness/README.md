# @yaks/harness

A local agent runner with SQLite persistence, command-line tools and a terminal
interface. It composes `@yaks/session` for model execution, `@yaks/process` for
host commands, and graph-backed task and transcript storage. No server is
required. Model calls may use an external provider; shell tools execute on the
host and are not sandboxed.

- `open()` creates or opens storage and registers vocabulary and plugins.
- `harnessTools()` combines shell, delegation and graph tools.
- `agent()` configures the model and session daemon and exposes session methods.
- `plugin` supplies commands for `@yaks/cli`.

## Use

Settled subagents are hidden from Sessions and Subagents by default. **Ctrl+S**
toggles **Show settled**; NORMAL mode also provides `s`. Root sessions and the
selected child stay visible. This is only a display/navigation filter: parent
completion messages and child transcripts are retained; enable the toggle to
revisit a settled child. Failed and stopped children remain visible for
attention.

## Keyboard modes

**Ctrl+U cuts the entire draft in any mode:** it saves the exact source
(including newlines) in the frontend's private `visual.yank`, requests an OSC52
clipboard write, then clears the draft and resets its cursor. It does not send a
message. Empty drafts leave the clipboard alone. If the clipboard writer throws,
the draft is retained. If no writer is available, the draft is cut to the local
yank only. The status line reports the outcome; terminal clipboard permissions
can prevent OSC52 delivery, which cannot be acknowledged. The local yank remains
recoverable until replaced or this frontend closes. The standalone textarea's
Ctrl+U editing behavior is unchanged.

The composer starts in **INSERT** mode. Escape enters **NORMAL**, and `i`
returns to editing without changing the draft or cursor. NORMAL commands never
submit or type into the composer. `?` opens help; `?` or Escape dismisses it.
There is no permanent shortcut panel.

| NORMAL key                | Action                                                    |
| ------------------------- | --------------------------------------------------------- |
| `j` / `k`                 | Select next / previous transcript entry                   |
| `h` / `l`                 | Focus transcript / sidebar                                |
| `gg` / `G`                | Transcript start / end; `G` resumes bottom-follow         |
| Tab                       | Switch transcript / sidebar focus                         |
| `hjkl` with sidebar focus | h/l changes pane; j/k selects visible rows                |
| `n` / `p`                 | Next / previous root                                      |
| `o`                       | New session                                               |
| `t`                       | Toggle message / task composer                            |
| `a` / `z` / `s`           | Archive selected session / show archived / show settled   |
| `v`                       | VISUAL selection of the transcript's anchored item source |
| Ctrl+U / Ctrl+D           | Move selection half a page up / down                      |
| Ctrl+B / Ctrl+F           | Move transcript selection a page up / down                |
| `i`                       | Return to INSERT                                          |

In VISUAL, `hjkl` extend selection, `y` copies and returns to NORMAL, and Escape
cancels to NORMAL. Tab cycles selectable surfaces. In INSERT, Alt+v starts draft
selection. Selection remains source-based and within one item; this is not a
full Vim editor. Normal `gg` is a two-key sequence, canceled by any intervening
command or leaving the mode, with no timing requirement. Bracketed paste in
NORMAL is ignored rather than interpreted as commands.

Existing modified navigation shortcuts remain available for compatibility.
Ctrl+C always quits; Ctrl+End follows the transcript end. Plain `?`, `hjkl`, and
`y` still type normally in INSERT. Mode/focus/help state belongs to the
frontend's private graph, while the TUI key-routing and text-surface APIs are
graph-independent.

`deno task harness` with no verb opens the terminal UI. The transcript scrolls
and word-wraps beside the Sessions, Tasks, and Context usage panels. Enter
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
`{title, read, Render}`, with `read` returning bundles from graph-backed
interfaces. To embed the app, mount `App` with
`{agent: a, subscribe: changes(a), panels}`; use
`run(() => h(App, opts), {backend})` to choose a terminal backend.

```sh
deno task harness new 'reply with the word pong'
deno task harness ls
deno task harness show <session>
deno task harness send <session> 'and again'
deno task harness tasks
deno task harness models
```

`$HARNESS_HOME` moves harness state without changing `HOME`: the defaults are
`$HARNESS_HOME/harness.db` and `$HARNESS_HOME/exceptions.jsonl`, with
`~/.harness` as the state directory when unset. `$HARNESS_DB` (including
`:memory:`) and `$HARNESS_ERROR_LOG` override the individual files. For probes,
set `HARNESS_HOME` and `TASKS_HOME` to scratch directories and clean them up;
`TASKS_HOME` moves the process supervisor's files (unless `PROCESS_DIR` is set).
Keep `HOME` unchanged so Deno reuses its module cache. If a probe must move
`HOME`, export the invoking `DENO_DIR` before moving it.

The model is `gpt-6-astra` unless `--model` says otherwise, reached with
`$OPENAI_API_KEY` or the Codex CLI's sign-in (@yaks/openai).

```ts
import { agent, open } from '@yaks/harness'

// Supply a model adapter implementing the @yaks/session model contract.
let a = agent({ h: open(':memory:'), model })
let s = await a.start('reply with the word pong')
await a.idle(s)
for (let e of await a.transcript(s)) console.log(a.line(e))
```

For tests and embedded instances, pass the storage handle as `h`. Do not spread
`open()` into the options: `agent({ ...open(':memory:') })` is rejected by both
the type contract and a runtime check. Without an explicit `h`, `agent()` opens
the configured persistent database. A temporary working directory does not
isolate that database.

## What it is made of

- **Persistent state.** A transcript is `entry` entities, what it ran is
  `process` entities, the work is `task` entities — @yaks/session, @yaks/process
  and @yaks/task over @yaks/sqlite. Nothing here writes SQL and session state is
  persisted; running sessions can be queried with `.session.status=running`.
- **Two statuses are computed, never stored.** `sessionDerived` and @yaks/task's
  `derived(taskMarks)` are registered as derived columns. The task plugin uses
  the same `taskMarks` from @yaks/session: completed/cancelled win, then a claim
  means wip, otherwise open. `blocked` stays a facet, never a status. Queries
  filter in the database, and the sidebar reads that same status.
- **Work need not be filed.** `doc` + bare `task{}` is a microtask; optional
  `filed{project, priority, domain, assignee}` places it in the portfolio.
  `a.tasks()` reads `.task.status=open,wip`, oldest first, without requiring
  filing or a project. The CLI and sidebar use that same interface.
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

`agent({maxChildren: 32, maxSessions: 64})` sets the defaults explicitly. Child
submissions return an ID and durable `dispatch.state=queued` intent;
`session.status=queued` distinguishes waiting children from active or settled
ones. One shared graph-local scheduler admits up to `maxChildren` callbacks
across all parents (32 by default). FIFO submission order is durable; resumed
nested waits reacquire a slot before returning. Root sessions do not consume
child slots; `maxSessions` remains a root-start guard. A waiting delegated
parent releases its slot, so capacity one supports nested delegation. Worktree
preparation runs only on admission; failures and queued cancellation terminate
with a completion receipt. Restart reconciles interrupted admissions; spawn
replay preserves ID and fork anchor. `stop()` gates admission synchronously and
drains running storage callbacks, not the durable queue or task settlement.
Independent supervised processes are untouched. This is a single-daemon pool,
not a distributed lease or a security boundary against arbitrary graph writes.
Model/API throughput is still bounded by provider limits; full transcript
transfer and coarse UI projection costs are unchanged.

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
transcript renderer that shows one clipped line with sequence, scope, and source
name. Instruction text remains stored and is sent to the provider unchanged;
compact display does not remove it from context. Fork notes are guidance, not a
prohibition on useful delegation. Provider cache hits are not guaranteed.

#### Prompt history and cache limits

`prompt.revision` is the file content SHA-256, not an identity for a full model
request. Ordered snapshots, the fork anchor and recorded base instructions
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

Tasks shrinks to their content within bounded shares. Context usage is last at
the bottom; the session tree receives remaining height and scrolls.

`Alt+a` archives/unarchives only the selected session, never its root. `Alt+z`
shows archived roots so they can be selected and restored. Archival is a
persistent `archived` facet: it neither stops execution nor removes history.
Archiving a session hides its subtree; descendants receive no additional archive
marks. Selection and visibility preferences live only in the frontend graph.
Trees are keyboard-controlled for now; no coordinate-specific mouse hacks were
added.

The session title projection reads original local input, excluding inherited
fork history and instruction/notice entries. This currently adds transcript
reads to domain refreshes (not keystrokes); the existing coarse async domain
projection adapter remains a performance interface, documented in
[Frontend implementation](FRONTEND.md).

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
snapshots are unchanged. Set `outputLimit` on `agent()` to change the threshold.

Read accepts `entity`, `component`, `property`, `start`, `count`, and optional
`revision`. Search accepts the same address with a literal `query` and bounded
`limit`. These tools inspect any authorized text property, including `doc.body`,
not only tool results. They don't open files or grant access through a raw hash.
See [`@yaks/blob`](../blob/README.md#bounded-graph-value-inspection) for range
units and [`@yaks/context`](../context/README.md#large-tool-results) for policy
limits.

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

Binary bytes use `@yaks/blob`'s external file backend under `~/.harness/images`,
or `HARNESS_IMAGE_DIR`. This directory is made private. Keep it with database
backups. Do not point it at an unrelated shared directory: the harness enforces
mode 0700 on it.

Programmatic configuration is
`agent({h, name: 'gpt-4.1', images: {directory,
tool: {output_format: 'png'}, maxBytes: 33554432}})`.
`remote` accepts the same cloneable `images` options; storage callbacks are
constructed inside the worker. Custom model implementations own their own
artifact storage configuration.

Images are persisted before their graph references, with content-derived
artifact IDs and attachment entries associated with the original ask and
session. The transcript shows an artifact label rather than base64. No terminal
image display, image editing/input replay, or automatic blob cleanup is
implemented. Inline images and Kitty graphics rendering can be added in the
terminal backend later. Only the textual artifact reference is replayed when
provider-side conversation storage is unavailable.

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
`TMUX` is set. SSH requires no server-side display. This pilot does not
negotiate terminal support: only enable it on terminals supporting Kitty
graphics. Actual visual placement in iTerm2 still needs user verification.

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
reference, audience, and admitted revision, not base64. The OpenAI adapter adds
an `input_image` user message after the tool results. Only the outgoing provider
request contains a data URL. The original tool call/result pair remains intact.

A replay, including inherited fork history, includes explicitly viewed images
again; continuation requests include only inspection results in their new
window. User-only attachments never become model image inputs. Changing an
artifact reference after inspection fails the revision check instead of sending
new bytes under the old admission. Requests are limited to 20 MiB of inspected
images. These tools currently inspect signatures rather than fully decoding
images; animated GIF, SVG, remote URL import, and video are unsupported. Unknown
imported files receive `application/octet-stream`.

Responses stream by default. Set `HARNESS_STREAM=0` or pass `streaming: false`
to disable streaming. See [STREAMING.md](STREAMING.md) for lifecycle and
limitations.

### Provider web access

Native OpenAI web search is enabled by default, including OAuth configurations.
Supported models can search, open pages, and find text within pages. Disable it
with `HARNESS_WEB=0`, or pass `web: false` to `agent()` or `remote()`. Explicit
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
or model. `Ctrl+U` cuts to the clipboard and saved local yank; `Alt+p` restores
that yank. Failed or interrupted admissions restore editable text rather than
automatically resending it.

Local unencrypted recovery files use private permissions under
`~/.harness/drafts`. Set `HARNESS_FRONTEND` for a stable named profile and
`HARNESS_DRAFT_DIR` to relocate storage. See
[frontend state](FRONTEND.md#local-draft-recovery) for isolation, retention, and
crash-recovery limits.

The CLI and terminal frontend do not add a built-in agent description or style
instruction. Instruction files are admitted through `@yaks/context`; callers can
still supply explicit `instructions`. Existing sessions retain their served
request history, but the retired built-in harness instruction is omitted from
future requests. A restart loads this behavior; it cannot retract instructions
from a request already in progress.

## Transcript loading

The UI loads a 64-entry window around the bottom or saved entry anchor, then
loads overlapping ranges on navigation. Context usage reads only the newest
reported usage fields. Full model history is unchanged. See
[WINDOWS.md](WINDOWS.md) for the subscription design, benchmark, and entry-size
limits.

### Cooperative migration announcements

The harness checks the SQLite migration control table before installing its
application schema. A pending/failed announcement refuses startup. While
running, it polls that table once per second. A new announcement or completed
generation stops admission, drains active work, and closes the database;
subsequent commands report that a restart is required. It does not automatically
restart the worker. `migrationPollMs` can configure the interval in
`agent`/`remote` options.

Migration tooling can use `h.migrations.run(name, callback, options)` from an
otherwise idle handle, or `migrations(driver)` on a dedicated connection. The
migrator must allow at least the longest participating polling interval. See
[@yaks/sqlite migration announcements](../sqlite/README.md#preannounced-migrations)
for failure recovery and timing limitations. In particular, the grace period is
not a guarantee that all active callbacks finished.

This first version protects only **explicitly announced migrations**. Existing
synchronous `open()` schema installation and legacy startup conversions have not
been converted to asynchronous preannounced migrations. Do not assume opening a
new harness version is coordinated with older running connections. Stop those
connections before such upgrades. Already-completed migrations are not a version
compatibility check when an older binary first opens the file.
