# @yaks/session

`@yaks/session` stores conversations as graph transcripts, derives their status,
manages claims, and runs model and tool turns. It does not start an
operating-system process.

<a id="install"></a>

```sh
deno add jsr:@yaks/session
# or: npx jsr add @yaks/session
```

## Prompt-cache observations

`yak session cache` reads request usage without keeping a second rollup. It
reports token-weighted cached share and separate groups for session, provider,
model and path. `--requests` adds each observation's id, time, counts and share.

```sh
yak session cache --until 2026-10-01T20:10:00Z
yak session cache --from 2026-10-01T20:10:00Z
yak session cache --from 2026-10-01T20:10:00Z \
  --until 2026-10-02T00:00:00Z --session S-123 --requests
```

Dates are ISO instants with a timezone, selected by request `created.at`. `from`
is inclusive and `until` exclusive: the two sides of the 20:10 UTC cut never
overlap. Without bounds, all observations are read. Undated observations appear
only in an unbounded report.

`cached_share` is `reported_cached_tokens / reported_input_tokens`, summed over
requests reporting both counts, not an average of request percentages. It is
null when that input denominator is zero. `input_tokens` and `cached_tokens` sum
all reported counts; the paired `reported_*` totals explain the share.
`unknown_cache_input_tokens`, `unknown_input_requests` and
`unknown_cache_requests` expose missing coverage; `zero_cache_requests` counts
explicitly reported zeros. Requests not yet reporting usage remain unknown.
Imported CLI entries can carry `ask{to, through}` too; `session{transcript}` on
their session still identifies them as imported. Imported entries can be
cumulative turn totals rather than individual requests. They are excluded from
`total` and the session, provider and model groups, so these never mix
cumulative imports with per-request usage. `imported_observations` counts the
excluded entries; `groups.path.imported` keeps their totals separately, and
`--requests` retains the individual observations. An endpoint that omits cached
usage (or reports null) is unknown, not a cache miss; it does not enter the
share denominator.

Paths come from existing provenance: a session without `session{source}` is
`native`; `session.source` → `call{source}` → `build{}` is `builder`; a source
call whose registered `tool{name}` or `call{name}` is `session_compact` is
`compaction`; another source is `other`. Usage-only entries are `imported`.
Provider and model names are resolved from their rows; missing identity is
`unknown`, not guessed from output text.

`cacheOf(rows, metadata, options)` is the pure reducer.
`cacheRead(graph,
options)` accepts only `read` and `get`, so an app-store
consumer can use the same report without a box-specific adapter. Both are
exported by `@yaks/session`; there is no second consumer needing aggregation in
`@yaks/model` yet.

## Storage model

<a id="the-transcript"></a>

A session entity has a `session` component. Each transcript entry is a separate
entity with `entry{session, seq}`. A **bundle** is one entity's components as a
JSON object. The components beside `entry` determine its type:

| Components                            | Meaning                            |
| ------------------------------------- | ---------------------------------- |
| `content{body}` without `output`      | input from a person or system      |
| `ask{to, through}`                    | a request to a model               |
| `content{body}` with `output{source}` | model output                       |
| `call{to, id, args, source}`          | a tool call requested by a model   |
| `result{call}` with `content`         | a tool result                      |
| `using{provider, model, effort, …}`   | model selection on an input or ask |
| `usage` and `cost` beside an ask      | what the request used and cost     |
| `questions{asked}`                    | typed questions for the next ask   |
| `answer{question, …}` with `output`   | a model's answer to one question   |
| `stop`                                | no further transcript work         |
| `refusal{code}`                       | an expected failure                |
| `exception`                           | an unexpected failure              |

`entry.seq` is assigned transactionally when omitted. `appendEntry()` is the
usual way to append text.

```ts
import { graph } from '@yaks/graph'
import { modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { appendEntry, sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [sessions()] })
await g.apply([{ entity: { eid: 'session' }, session: {} }])

await appendEntry(g, 'session', 'Please review this change')
await appendEntry(g, 'session', 'Build completed', {
  eid: 'notice:build-123',
  notice: true,
})
```

**Sending** is what goes to a model:
`sending{input, instructions, window, tools}`. It is selected independently of
`using{provider, model, effort}` on an input and recorded on each ask.
`sending.input` carries explicit model-native fields, such as lyrics or
duration, validated by the provider.

`sending.tools` names the tools a turn is offered: exactly those, found among
the runner's own and then among the ones it runs only for a turn that names them
(`Deps.named`, `offered()`); without it a turn gets the runner's own.
`sending.instructions` are the system instructions a turn is asked with, and
`sending.window` bounds what it sends: the newest that many lines, reaching back
to the input that began the turn they cut into, so a long transcript costs a
turn no more than a short one. A line is what a model is sent (an input, a
reply, a call, a result); the asks and errors kept beside them are not lines,
and neither are the typed questions other turns asked or their answers. Without
an explicit window, a long native transcript is summarized into a checkpoint
once the next request would fill `Deps.compactAt` (half where absent, the same
for every model) of its model's context window: `model.context` on the model's
row, else `provider.context` on its provider's, else 128,000 tokens
(./compact.ts). What it weighs is what the model holds: the provider's count of
the newest request since the checkpoint, which includes any history an anchor
kept there, plus the lines since. The summary replaces the oldest lines and
keeps the newest that fit half the limit, no more than the summarizer's own
window can read, and no checkpoint follows another within `GAP` asks, so a
window set too small summarizes every few steps, never every step. The next turn
reads that summary and the entries after its boundary. A provider anchor before
the checkpoint is not reused. Every request names its session as
`Request.conversation`, so between checkpoints a provider that keys its prompt
cache by conversation reads the unchanged prefix from it.

A fork has `fork{from}` on its session entity. Its logical transcript contains
the parent transcript through the referenced entry, followed by its own entries.
Provider continuation data is stored as a provider-specific component on an ask
entry; for example, `@yaks/openai` stores `openai{response_id}`.

Session status is derived from entries rather than stored. `statusOf()` returns
`empty`, `pending`, `running`, `settled`, `stopped`, or `failed`.
`sessionDerived` exposes the corresponding `session.status` SQL-derived
property, and `statusComputed` the same rule for @yaks/ram's `computed`, so
`.session.status=running` answers alike in memory. A stop remains effective
until new input resumes the transcript; late model replies and tool results can
be recorded without admitting more work. An unanswered call from the newest
model request keeps a transcript `running` regardless of later entries.
Otherwise, input/result means `pending`, ask/call means `running`, output means
`settled`, stop means `stopped`, a provider's error beside an interrupted ask
means `pending` (the pool asks again), and exception, an error beside a
completed ask, three consecutive errors, or one error coded `limit` (`LIMIT`, a
request refused at a ceiling, which asking again would meet too) means `failed`.
No entries means `empty`. There is no separate `input` component.

A request's `cost{dollars, reported}` (@yaks/model) is written beside its
`usage`: the provider's own dollars where it reports them, and otherwise, in the
same transaction, the usage weighed at the `price` on the row of the model that
answered it (`weighing`, a precondition of `sessions()`). `session.cost` is
computed, never stored: the sum of its entries' `cost`, absent where none
records any. Whole session reads omit this transcript-wide sum; name
`session.cost` in a filter or `.fields=session.cost` to compute it.
`sessionCost` is its SQL, registered in `sessionDerived`.

Applications that run a session add components from other packages:
`process{pid, command, cwd}` and `exit{code}` describe its program;
`worktree{repository, path}` describes its checkout; `spawned{parent, call}`
describes delegation; and @yaks/file's `lines{file, start}` records the line of
the file an imported entry was read from. Start, latest-input, and finish times
are entry `created.at` values. The last `content` and `usage` record what the
run produced. Persona and role remain referenced entities.

`archived{at}` is the general `@yaks/kernel` visibility marker. Archiving a
session does not stop its runner, release claims, remove entries, or change
transcript status.

## Claims

<a id="a-lock-is-a-lease-not-a-patch"></a>

`claim{session}` is stored on the entity a session claims. A **batch** is a list
of bundles applied in one transaction. If a batch attempts to replace another
session's claim, the whole transaction fails with `Bounced`; the collision is
then recorded as `conflict{target, loser, holder, at}`: with `page` claimed by
`ada`, a batch holding `{ entity: { eid: page }, claim: { session: bo } }` fails
with `Bounced: <page> is already claimed by <ada>`.

Reclaiming with the same session is harmless. Set `claim: null` to release a
claim; release is unguarded so a caller can hand a claim over. The collision
check runs in the transaction's `precondition` phase, before cascades change
rows. After rollback, the `audit` phase records the conflict in a separate
transaction. Claims do not expire. Deleting a session releases its claims
through the graph cascade. `reapLeases(storage)` releases claims whose holder is
no longer a session; the `/service` duty runs it when it starts.
`endGone(graph, options)` (`@yaks/session/ended`), run hourly by the same duty,
writes `session.ended` on a session that is over, which is what makes a page of
live sessions a presence test (`.session !session.ended`). An outside harness's
session is over when its process is gone: Claude's by its running-process files,
where a subagent runs in its root session's process and also ends once its log
has been quiet for two hours, and Codex's by a fully imported log quiet for two
hours. A session with no transcript file is over once it has been quiet for two
hours, a day if its turn is unfinished, and holds no claim. The mark leaves
`updated` as it was. Input on the transcript, or a knock or letter addressed to
the session, clears it in the same batch, whatever door it came through
(`./reopen.ts`). What its entries leave unfinished then reads `stopped`;
settled, failed and empty keep reading that way. `session_release` frees what a
marked session held. `session_release` records work when a transcript ends or
receives a claim after ending, so a later worker releases those claims through
the ordinary queue. A managed run that ended cleanly keeps the claims it is
parked on (see below), and lets each go once its task finishes or nothing is
left to wait for.

## Parking on a task

A transcript is **parked** on a task when its run is over (a native transcript
has settled; a managed run's process exited 0 and nobody stopped it) while the
task it holds still waits on a dependency: a `requires` or `contains` edge to a
task that has not finished (`@yaks/task` `dependencies`). When a dependency
finishes, `session_wake` wakes every transcript parked on a task that waits on
it, the same way for both kinds: it appends an input carrying the `using` in
force, naming what finished. `session_run` answers that input for a provider a
host lent a model for, and `@yaks/spawn` answers it by running the command line
again on the provider's own thread. Deleting the link to a dependency that has
not finished wakes the transcript parked on the task it led from the same way
(`unlinked(graph, task, dep)`), read from the edge as the commit found it
(`@yaks/effects` `Event.before`).

News is a dependency that finished after the claim was taken, by somebody other
than the holder, or the link to an unfinished one going away. Each wake is named
for the transcript, the task and what it tells of, so the same news is told
once. A managed run that ends calls `rouse(graph, session)` itself, so a
dependency that finished while it ran is told at once.
`waits(graph, session, task)` says whether a held task still waits on something
the holder is to be woken for, and `unanswered(graph, session)` lists what a
transcript was told that its last turn or run was not given.

When `x` finishes, a transcript parked on `y` which requires `x` receives that
news and a request for another turn, carrying its previous provider choice. The
complete executable scenario, including those exact assertions, is beside `wake`
in [`wake_test.ts`](./wake_test.ts).

```ts
import { wake } from '@yaks/session'

// await wake(graph, 'x') // what session_wake runs when x finishes
```

## Running a transcript

<a id="when-something-runs-the-session"></a>

`react()` performs one required step: request a model response, run the next
tool call, or retry an error. `settle()` runs a transcript until it has nothing
more to do, under a lease named for it, so two processes never run one
transcript at once.

With a durable pool, each `session_run` effect performs one leased step. Inputs,
completed requests, context checkpoints and final tool results owe subsequent
steps in the transaction that records them. A run owed while this process is
already stepping the transcript joins that step, and the step's run owes one
more afterwards, unless the step wrote every change that joined it and left no
turn owed: a step's own reply wakes its transcript, and the step that wrote it
has answered that wake already. A run a stopping worker cuts short owes one more
too while its transcript owes a turn, or has ended and its end is not yet told
(a child's parent, its dispatch). `session_input` performs the same step for a
new input that inherits `using`, leaving an input that selects `using` to
`session_run` so it owes only one turn. Each `session_tool` effect claims and
executes one call independently, so several calls can run together. A background
call (`tool_async`) is answered by `PENDING` ("Pending; its result will
follow."), which a request derives from the call. A model turn starts while
calls run only when there is something new to read: an input, a result, or the
Pending entry (`tool_progress`) a call is given when it outlasts its patience
(`PATIENCE`, 10 seconds; `Deps.patience`), since a call that has run that long
leaves other work worth doing. An input asks at once; a result or a Pending
waits until each call of its reply has answered or outlasted its patience, since
the model asked for them together. A call that answers sooner costs two entries,
the call and its result, and no turn of its own. A tool that `waits` (on a
process, a child, a task) is never given one: the model chose to wait. Older
transcripts hold a `tool_progress` entry beside every background call, which
still answers it.

A request carries each call's answer right after the reply's last call, in the
order of the calls, since many models pair a result with its call by position
rather than by id: its Pending where an earlier request sent one, else its
final. A final whose Pending was sent stays where it landed and names its call
by tool, id and arguments ("The pending shell call c1 {…} finished:"), as a
second output for the call on OpenAI and as a user line on providers that take
one output per call.

Any process working the `@yaks/effects` pool takes an owed step.
`running(g, runner)` is the handler a host registers, lent the models, tools and
limits it has; a transcript asking for a provider the host was lent nothing for,
such as a command line `@yaks/spawn` launches, is left to whoever answers it.

This complete example runs in memory with a local model function:

```ts
import { graph } from '@yaks/graph'
import { type Model, modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { sessionDoc, sessions, settle, transcript } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
const g = graph({ storage: ram(vocab), vocab, plugins: [sessions()] })
const model: Model = async (request) => ({
  id: crypto.randomUUID(),
  model: request.model,
  items: [{ kind: 'assistant', text: 'pong' }],
})
await g.apply([
  { entity: { eid: 'here' }, content: {} },
  { entity: { eid: '$provider' }, provider: { name: 'local' } },
  { entity: { eid: '$model' }, model: { name: 'example' } },
  { entity: { eid: 'session' }, session: {} },
  {
    entity: { eid: 'input' },
    entry: { session: 'session' },
    content: { body: 'Reply with pong' },
    using: { provider: '$provider', model: '$model' },
  },
])
await settle(g, 'session', { holder: 'here', model, tools: [] })
console.log(await transcript(g, 'session'))
```

Replace the local function with `responses({ credential })` from `@yaks/openai`
to use that provider; also load its `openaiDoc` vocabulary.

A host can lend an [executor](../model/README.md) through `Deps.executor`, or
return one as `Served.executor` from `resolveModel` for a selected provider. The
runner commits the original ask before `Executor.submit(call, request)`;
`request.call` and `call` name that ask. The executor freezes the request,
records `inference{executor, request, receipt}` on the ask, and dispatches the
same instance idempotently. The runner releases its lease while the receipt is
pending.

Model metadata is optional preparation, not a prerequisite for an ask.
`providerResolver` lists a provider's catalog only for a pending (unconfirmed)
model. A confirmed model with no price does not trigger another full listing:
some providers never publish prices. A provider with `info(name)` can still
supply per-model metadata. The runner's resolver shares in-flight discovery
across concurrent sessions and caches successful results (including missing
metadata) for five minutes. After a transient discovery failure it continues the
ask and cools down for at least a minute, or the error's longer retry delay. A
host can supply a fifth `report(error)` argument to observe exhausted metadata
discovery failures; permanent provider refusals still propagate. Provider
implementations own HTTP retry/backoff before that fallback. Its sixth argument
is the clock (@yaks/fp `Clock`, the runtime's by default) the cache expires by.

`providerResolver` accepts an executor factory as its fourth argument, keyed by
the selected provider's name. It prepares the provider's metadata and modalities
before submission and confirms the model on receipt. An executor's `available()`
returning false leaves new asks on the inline provider. Its `name` records
durable admission on the ask; older inline asks remain interrupted when a host
enables it.

On a later run, `Executor.resume(call)` reads the frozen request's outcome:
`undefined` leaves the ask pending, a reply completes the same ask, and a
terminal `ModelError` records its failure. A transport or receipt-read failure
is thrown for the effects pool to retry. Restart does not buy another response.
An ask committed before its request was frozen is dispatched under its original
id and transcript boundary. Changing `inference.receipt` owes `session_run` a
run; a receipt arriving while a lease is held is checked again when that lease
is released.

This example lends an executor through a provider selection. Its in-memory
methods illustrate the interface; a host supplies durable request storage,
idempotent submission, and receipt delivery behind them.

```ts
import { type Executor, type Model } from '@yaks/model'
import { type Served } from '@yaks/session'
import { equal } from '@yaks/testing'

let model: Model = async (request) => ({
  id: 'reply',
  model: request.model,
  items: [],
})
let submitted: string[] = []
let executor: Executor = {
  submit: async (call, request) => {
    equal(request.call, call)
    submitted.push(call)
  },
  resume: async () => undefined,
}
let served: Served = { name: 'example', model, executor }
await served.executor!.submit('ask-1', {
  call: 'ask-1',
  model: served.name,
  items: [],
  tools: [],
})
equal(submitted, ['ask-1'])
equal(await served.executor!.resume('ask-1'), undefined)
```

The hosted ask records its exact offered tool names in `sending.tools`. Returned
tool calls keep those tools' stable graph identities, and execution uses the
source ask's offer even when a later input selects different tools.

A provider refusal is recorded as `refusal{code}` with its
`response{body, headers}` beside it. A retryable request wears
`interrupted{code}` and `provisional{note}` while the effects pool still owes
another try. The pool gives it eight tries with backoff, resetting the tries
when a reply makes progress. A request not retried wears `failed{reason}`; new
input permits recovery without replaying completed tool operations.

An entry wearing `questions{asked}` (typed questions in Jev's terms, by name;
@yaks/model `Questions`) asks them with the next turn: the runner sends them as
`Request.questions`, and writes each of the reply's answers as its own entry,
`answer{question, noul, choice, score, confidence, probabilities}` with
`output{source}` naming the ask and a line saying it (`plan: forge, 0.82`), so a
person reading the transcript sees what was decided and a query can match
`.answer.question=plan&.answer.choice=forge`. A retry after an error asks them
again; a later turn does not, and reads neither them nor their answers: they are
rows for whoever asked, so a wake asking every few minutes never crowds the
conversation out of a window.

A streamed request is withdrawn by an entry carrying `cancel{target}` that names
its in-flight attempt: the run holding the transcript aborts it and records the
turn as interrupted. Models receive the abort through `Request.signal`; custom
models must observe it. Independent tool processes are not stopped.

Spawned children share one bound, `maxChildren`: a child waits
`dispatch.state: queued` until fewer than that many are `active`, and a child
waiting on its own children gives up its place while it waits.

The `wait` tool, like every wait here (`changes` in `@yaks/session/wait`), reads
again only once the store's revision has moved, on a beat that starts at 25 ms
and doubles to a second: a short wait answers about as soon as what it waits on
finishes, and a long one costs at most a read a second. Each read takes a task's
status marks (`statusComps` in @yaks/task) or a child's place and transcript
status, never a whole row.

<a id="recorded-tool-execution"></a>

Tool execution vocabulary belongs to `@yaks/tools`. The session loop builds a
runner for each step, executes transcript calls serially, and writes returned
text as `content{body}` plus `output{source}` beside a `result` entry with its
`call` and `ms` fields. A precommit rule adds `entry.session` to results before
sequence allocation. The general tool-runner plugin is not registered because
its effect-phase execution would race the session loop. A refused call is one
entry, its result carrying `refusal{code}` (the runner's `refusalOnResult`), and
the model reads it as that call's result. An unknown tool is handled by a
refusing tool, producing such a result. A durable `execution.state=running`
without a result is not replayed. On restart, a tool may recover its outcome
from durable state; otherwise the runner records an interrupted result so the
model can inspect the state before taking another action. The session then
continues.

## Reading transcripts

<a id="bounded-transcript-reads"></a>

`transcript()` loads the full fork-aware history. A status, a runner step and a
tool snapshot read less: `reach()` returns the newest entries down to the oldest
one their decisions look at (the latest ask and the line it was sent through,
the turns a retry counts, the last stop, the newest checkpoint and what follows
it, the lines of a finite `sending.window`) and the older entries those name. It
answers `statusOf`, `openCalls`, `usingBefore`, `sendingBefore` and a model
turn's context as `transcript()` would, so a step costs the same on a short
transcript and a long one. A step running one call (`{ call: true }`) reads what
its tool reads of the turn, the prompts and the `using` and `sending` in force,
and no window: the turn sent that, not the call. A model turn (`{ turn: true }`)
reads on to its window only where the transcript is pending: one running its
calls, settled, stopped or failed is sent nothing, and its turn reads what a
call's does. What it looks for beyond those newest entries (the open calls, the
newest `using`, `sending` and stop) a graph remembers, and the next reading asks
only the lines appended since and the ones it found. So it does the lines of a
window below the newest page: the next reading asks them by name, which the
store answers from memory, and reads them without an ask's `attempt` or a call's
`execution`, which nothing decides by there. A pending transcript with neither
checkpoint nor window is its own context, and its turn reads it all. A runner
reads a step's transcript once a pass (`reading()`): its checks before the step
(a stop, a cancelled task, an answered call) judge the reading that `react()`
then acts on, unless a line has landed since. `usingOf()` and `openOf()` ask for
the model selection in force and the calls no result answers alone.
`transcriptWindow()` reads a bounded page for user interfaces:

```ts
import { graph } from '@yaks/graph'
import { modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { sessionDoc, sessions, transcriptWindow } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [sessions()] })
await g.apply([
  { entity: { eid: 'session' }, session: {} },
  { entity: { eid: 'hello' }, entry: { session: 'session' } },
])

const newest = await transcriptWindow(g, 'session', { limit: 64 })
const around = await transcriptWindow(g, 'session', { anchor: 'hello' })
const oldest = await transcriptWindow(g, 'session', { edge: 'start' })
```

The result is `{ entries, before, after, total, offset }`. Limits count entries,
are clamped to 1–256, and default to 64. An unknown anchor or one outside the
fork prefix selects the newest page. A fork never includes parent entries
written after its `fork.from` boundary. `transcriptPlan()` returns ordinary
bounded graph queries; it is not a transactionally frozen snapshot, so
subscriptions must refresh it when membership changes. `transcriptSegments()`
describes ancestor ranges, and `transcriptUsage()` reads the latest usage
without transcript text. `before` and `after` indicate unloaded neighbors. Pages
remain in logical transcript order. A plan reads entry positions first, then
limits body reads to the selected ranges; it can be used with `@yaks/api`
subscriptions.

## Harness hooks

The `./cli` facet answers `UserPromptSubmit` context from its local transcript
without opening the graph, so it cannot wait behind a graph writer. An empty or
malformed hook without a session is also a local no-op. Other lifecycle events
and `--json` delegate to the graph's tool runner.

`yak hooks install` writes lifecycle hooks into a Claude-compatible settings
file (default `~/.claude/settings.json`), replacing an earlier install and
leaving every other entry alone. A harness runs each hook with the event as JSON
on stdin.

| Event                       | Command                        | Effect                                                                           |
| --------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| SessionStart, SubagentStart | `yak session context --hook -` | creates the session under the harness's id; prints its claims                    |
| UserPromptSubmit            | `yak session context --hook -` | one timing line: prompt sent (or observed at hook time) and previous reply ended |
| SessionEnd                  | `yak session wrap --hook -`    | releases the session's claims, except the task a managed run is parked on        |

SessionStart, SubagentStart and SessionEnd first post their JSON input to
`POST /session/hook` using a small shell/curl command. The server runs the same
tool and renders the same answer as the CLI; start events return it in
`hookSpecificOutput.additionalContext`. A failed request (including a server
that is down) retries the command shown above with the original input. Partial
HTTP responses are discarded before retrying, and a failed fallback exits
successfully. Requests have a two-second limit and local connection attempts a
100 ms limit.

Claude Code's
[hook type support](https://code.claude.com/docs/en/hooks#prompt-based-hooks)
excludes SessionStart from HTTP hooks, though HTTP response JSON supports
additionalContext. Keeping a command wrapper also gives all three lifecycle
events their local fallback.

UserPromptSubmit reads `transcript_path` locally and prints plain stdout, which
Claude Code adds as context on exit 0. Its documented input has no sent
timestamp: a matching queued submission (or `prompt_id` already in the
transcript) supplies one; otherwise the line says **Prompt observed** at hook
time, not an invented send time. The previous reply uses a main-thread assistant
`end_turn` timestamp, never a tool call or a subagent. Reads are bounded to the
last 1 MiB; unavailable times say `unknown`. A missing/unreadable transcript or
unavailable graph means no context. The hook suppresses errors, exits
successfully and has a two-second ceiling; it never blocks a prompt. See Claude
Code's
[hook input and output reference](https://code.claude.com/docs/en/hooks#userpromptsubmit).

It also writes a PostToolUse HTTP hook posting each tool call to the server's
hook door, `POST /session/hook` (`@yaks/session/routes`; `server` names the
`yak serve`, default `http://localhost:5173`). A harness runs its subagents and
forks under the session's own id, and only the hook event says which context a
call came from (Claude Code's `agent_id`). So the door answers a call from the
session's own line of work with what the bus owes the session, as the context
the harness adds after the call, and a subagent's with nothing. The first event,
a subagent's too, marks the session `hooked{}`, and from then on the bus says
nothing beside a tool reply to it, since a tool call cannot say which context
made it.

A PreToolUse HTTP hook on MCP tools (`mcp__.*`) posts to the same door before
each call, which remembers the session or subagent making it under the call's
id, so the MCP door writes as that run (see "Identity and HTTP attribution").

The hook door speaks only after a tool call, so an agent at rest hears nothing
there. To be woken, its own context runs the listener as a background command
that ends at the first thing it says; the harness then wakes the agent with that
output, and the agent runs it again:

```sh
yak session listen --session "$CLAUDE_CODE_SESSION_ID" --once
```

A listened line counts as heard once printed, so the command's output goes
straight to the harness, never to a file another loop watches.

## Transcripts from outside

A session a harness runs outside this package's daemon is read into the graph
from the harness's own log, by one importer (`@yaks/session/tail`). A reader
(`claude`, `codex`) says what each line of a format means, and `pull()` writes
it: what a person typed (an input, signed by them, and the session marked
`operator`), what the harness put in front of the model (`notice`), what the
model said and thought, and each tool call with its result. A call arrives held
by the session (`execution{state, by}`), so no tool runner here runs it again.
Tool arguments and output pass through `scrub()`, which redacts the shapes a
credential takes.

Each file read is a @yaks/file `file{path, root}` on the volume that holds it,
and every entry read from it wears the line it came from, `lines{file, start}`.
The file carries `transcript{session, consumed, version, finished}`, which says
how many of its lines have been read, which is where a resume starts: a line
that made no entry, or whose entries were deleted since, is not read again.
Entry IDs are derived from the session, the line and the place in it, so a line
read twice writes nothing new. A harness can write one session's id into two
files; the session's first file (`session.transcript`) keeps those IDs, and an
entry of any other file names that file's path too, so the two never collide.
Each entry is dated when the harness wrote it.

`@yaks/spawn` follows a managed run's stdout with it. The
`@yaks/session/service` duty follows Claude Code's transcript files,
`<project>/<session>.jsonl` under its projects directory, and Codex rollouts,
`YYYY/MM/DD/rollout-<date>-<thread>.jsonl` under its sessions directory: one
written to in the last `full` milliseconds is read as it grows, at full depth,
and an older one is read in lazily, one per pass, its prose and provider/model
selections. A look reserves its first bounded slice for the pending source least
recently read, including old backfill, so growing tails cannot starve other
files. Cold parents precede their subagents. The remaining budget reads open
tails least behind first, then unopened recent files newest first, each for a
slice (`SLICE`, 100 ms) until its budget (`BUDGET`, a second) is spent. It skips
a managed run, whose transcript asks a provider for it (`using{provider}`). A
subagent's transcript, `<session>/subagents/agent-<id>.jsonl`, is read the same
way (`subagent`, the reader whose lines are all side conversations) into a
session of its own: `session{id}` the agent id, its eid
`sessionEid(id, parent)`, and `spawned{parent, call}` naming the session that
started it and, from the `agent-<id>.meta.json` beside it, the call that did. A
Claude Code compaction summary becomes a checkpoint in the transcript; a native
continuation starts there.

Codex rollouts use `codexRollout`; managed `codex exec --json` output uses
`codex`. Rollouts keep each response item once, omitting its event notification
mirror. Injected instructions and inter-agent messages are notices, model prose
is output, and tool results name their calls by `call_id`. A child's thread UUID
stays its identity even when its rollout carries inherited metadata; it names
its parent with `spawned{parent}`. Imported model selections name the Codex CLI
provider through `using{provider, model, effort}`. The rollout file is the
source record. Compressed `.jsonl.zst` archives stream through the same
importer; `zstd` must be installed on the host. Each pull reads one decoded
chunk and shares the duty's time budget. `transcript{version, finished}` records
the source file's size and modification time and the version whose decoder
reached successful EOF. A restart resumes incomplete archives by skipping
consumed lines; completed unchanged archives do no decoding. Changed source
versions restart their cursor. Compressing a plain rollout makes another file,
`X.jsonl.zst` beside `X.jsonl`: the first tail on it takes over the plain file's
transcript, and the session's `session.transcript` where it named the plain
file, so reading resumes at the same line and entry identities hold. A failed
archive retries after a minute while the other files progress.

The duty scans sessions one at a time, starting another scan an hour after the
last finishes. `stale()` yields pages of at most 50 imported entry identities
from sessions whose newest entry is older than `full`, checking that age before
each page. `strip()` deletes one page between looks: calls, results, thoughts,
notices and a turn's ending go; what a person typed and what the model said
stay. Provider/model selections and compaction summaries stay too, so an older
transcript can still resume, and so does an entry that records what a turn cost,
since the session's cost is their sum.

| Option        | Default              | Meaning                                 |
| ------------- | -------------------- | --------------------------------------- |
| `every`       | `1000`               | milliseconds between looks              |
| `transcripts` | `~/.claude/projects` | where Claude transcripts are read from  |
| `codex`       | `~/.codex/sessions`  | where Codex rollouts are read from      |
| `full`        | 14 days              | how long a session keeps its full depth |

The Codex default follows `CODEX_HOME` when set; the Claude default follows
`CLAUDE_CONFIG_DIR`.

## Identity and HTTP attribution

<a id="one-id-means-one-run"></a>

A session written under an alias with the harness's own id for it
(`session{id}`) is the entity `sessionEid(id)` names: the id itself where it is
a uuid, as Claude Code's session ids and Codex's thread ids are, and otherwise
an eid derived from it. Whoever holds a Claude session id can read that session
by it, and the hook and the importer that both create it land on one entity. A
managed run's session is written first under an eid of its own, which
`@yaks/spawn` hands Claude Code as its `--session-id`.

`sessionFor()` resolves an entity ID, a human-readable session ID, or a harness
session ID to the same entity. `speaking()` returns the actor a session writes
as: `by` the actor it works as (`actorOf()`), and `via` the session itself. The
actor is the session's persona, else the actor it names (`session.actor`), else
the project it is filed in, else whatever the session that spawned it works as,
so a subagent works as the persona it runs under. A session with no persona
anywhere up its line should be rare. A session is never an actor: one that works
as nobody leaves `by` unsaid.

The `@yaks/session/graph` entry point exports `authenticate()`, for every door
over the graph: an HTTP request and a `yak` command alike. It reads the session
from the `x-via` header, else from a harness's tool call the hook door was told
about. Claude Code runs one MCP connection for a session and all its subagents,
so before each MCP tool call its `PreToolUse` hook posts the call's id with the
session and subagent making it, and the call itself carries that id in its
`_meta` (`claudecode/toolUseId`). A subagent the graph has not met is written
then, spawned by its session, and so is one the harness's `SubagentStart` hook
reports. The hook stores `announced{call, session}` in the graph, so the MCP
request keeps its caller across serving processes and restarts. The result's
hook removes the pairing; abandoned pairings expire after a day. Applications
enforce access separately.

<a id="appending-entries"></a>

Explicit sequence positions are supported for imports. Fractional and occupied
positions are rejected, while retrying an existing entry ID preserves its
position. Passive notices do not wake a settled session; the `notice` tool
appends them without requiring a sequence number. Direct `g.apply` calls can
also omit `entry.seq` when additional components are needed.

## Exports

The main module exports:

- vocabulary and constants: `sessionDoc`, `SESSION`, `CLAIM`, `CONFLICT`,
  `ENTRY`, and the other transcript component names;
- graph integration: `sessions()`, `leasing()`, `naming`, `auditing()`,
  `reapLeases()`, and `staleLeases()`;
- execution: `react()`, `settle()`, `running()`, `admitNext()`, `transcript()`,
  `sessionTools()`, and the provider lookups `offers()`, `providerResolver()`
  and `answers()`;
- parking: `wake()`, `unlinked()`, `rouse()`, `waits()`, `unanswered()`,
  `requested()`, `resting()` and `cleanEnd()`;
- inspection: `statusOf()`, `kindOf()`, `textOf()`, `ordered()`,
  `sessionDerived`, `statusComputed`, and the bounded transcript functions;
- identity and rendering: `sessionFor()`, `sessionEid()`, `speaking()`,
  `where()`, and `sessionViews`, the portable transcript renderers;
- harness readers: `claude`, `subagent`, `codex`, `codexRollout`, `readers`, and
  `scrub()`;
- error types including `Bounced`, `Unnamed`, and `UnknownSession`.

Additional entry points are `@yaks/session/vocab`, `/graph` (with
`authenticate`), `/tools`, `/cli` (local context hooks), `/views`, `/service`
(the duty that reads transcripts), and `/tail` (the importer). `/views` is
`views`, the portable renderers, and `inspectViews`, how the inspector
(@yaks/inspect) draws an entry and a session: an entry as a turn of its
conversation (`Inspect.Turn`), the turns either side of it
(`Inspect.Conversation`, what a belief citing the entry shows), the entry's page
inside its conversation, and a session's page with its status, brief and latest
turns. A **host** is the process that opened the graph; effects and tools
receive its graph and, where needed, its process entity ID.

<a id="what-is-deliberately-not-here"></a>
<a id="compatibility"></a>

The main package runs in Deno, Node, browsers, and Cloudflare Workers. Process
execution belongs to `@yaks/process`; command-line agent execution belongs to
`@yaks/spawn`.

## Claimed-work comments

The session bus delivers no comment to a native transcript: a comment stays a
message in its thread. Direct comments to a session remain thread messages.
Knocks and addressed deliveries retain their bus. An outside harness claiming
work can still hear comments on that work:

```sh
yak claim take <task> --session <outside-session>
yak session listen --session <outside-session>
```

A native transcript is recognized by a `using` entry and no `process`. Its
claimed-work comments stay unmarked by the bus. A listener on an outside
transcript uses the claimed-work exception; it does not hear comments merely
addressed to that session.

## Replies to a session's letters

A letter answering one a session wrote (`mail.reply_to` naming a letter whose
`created.via` is that session) is that session's: a native transcript gets it as
input, and an outside harness hears it from `yak session listen`, at its hook
door, or beside its next tool reply when it has no hook, once. The reply reaches
the session wherever the far side sent it, to the session's own address or to
its project's. While that session may still hear it, the reply waits for it
unmarked, and a session resumed under the same id hears it then.

Once the session that wrote the letter is over (its harness ended it, or its
transcript stopped or failed), a reply sent to a project is held for that
project: the next session of the project hears it, the same way and once. A
session's projects are the home of the persona it wears (`session.persona`,
@yaks/persona's `persona.home`) and every project filed under that home, at any
depth. A session that chose none wears the persona of the checkout it starts in:
its start hook says the directory, and `session_context` records the common
persona of the checkout holding it (@yaks/persona's `carried`), the one its
instruction files say. A session wearing no persona hears only its own replies.
A letter sent with `mail send --about <project>` goes out from the project's
address, so its answer is routed to the project (@yaks/mail). An entity wears
one address, so a project's other addresses are filed under it: a letter to an
entity wearing `email` with `filed.project` naming the project (hello@yaks.app,
filed under the platform's project) is held for the project the same way. Such a
letter is also filed as a task on the project's board (@yaks/mail `mail_task`),
so it stays in sight until it is answered after a session has heard it.

The next session is one at work. An outside session hears what is held on its
own calls; a native transcript hears it only mid-turn (`pending` or `running`).
One settled between turns hears only what is addressed to it, since a settled
transcript is never over and would otherwise wake for every alert its project
ever gets.

Nothing starts a session for a held reply; it waits for one. A managed spawn in
the project's checkout, with the thread as its brief and the project's common
persona, is where that will plug in (./listen.ts), once sessions may be started
again (T-95308) and its provider, model and spend are chosen.

### Prompt timing

`yak session context --hook -` prints prompt timing from the local transcript.
Session-start context is independent.

### Request context

A runner projects explicit transcript inputs, admitted instructions and
source-bound media into model requests. `requestItems` supplies dynamic context
such as the available skill catalogue. Sending a request does not retrieve
historical quotations. Stored `input_context{items}` snapshots remain
inspectable and are excluded from model requests.
