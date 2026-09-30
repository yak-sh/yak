# @yaks/session

`@yaks/session` stores conversations as graph transcripts, derives their status,
manages claims, and runs model and tool turns. It does not start an
operating-system process.

<a id="install"></a>

```sh
deno add jsr:@yaks/session
# or: npx jsr add @yaks/session
```

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
| `error{code}`                         | an expected failure                |
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

`using.tools` names the tools a turn is offered: exactly those, found among the
runner's own and then among the ones it runs only for a turn that names them
(`Deps.named`, `offered()`); without it a turn gets the runner's own.
`using.instructions` are the system instructions a turn is asked with, and
`using.window` bounds what it sends: the newest that many lines, reaching back
to the input that began the turn they cut into, so a long transcript costs a
turn no more than a short one. A line is what a model is sent (an input, a
reply, a call, a result); the asks and errors kept beside them are not lines,
and neither are the typed questions other turns asked or their answers. Without
an explicit window, a long native transcript is summarized into a checkpoint
before it fills the model's input budget. The next turn reads that summary and
the entries after its boundary. A provider anchor before the checkpoint is not
reused.

A fork has `fork{from}` on its session entity. Its logical transcript contains
the parent transcript through the referenced entry, followed by its own entries.
Provider continuation data is stored as a provider-specific component on an ask
entry; for example, `@yaks/openai` stores `openai{response_id}`.

Session status is derived from entries rather than stored. `statusOf()` returns
`empty`, `pending`, `running`, `settled`, `stopped`, or `failed`.
`sessionDerived` exposes the corresponding `session.status` SQL-derived
property. An unanswered call from the newest model request keeps a transcript
`running` regardless of later entries. Otherwise, input/result means `pending`,
ask/call means `running`, output means `settled`, stop means `stopped`, and
exception, three consecutive errors, or one error coded `limit` (`LIMIT`, a
request refused at a ceiling, which asking again would meet too) means `failed`.
No entries means `empty`. There is no separate `input` component.

A request's `cost{dollars, reported}` (@yaks/model) is written beside its
`usage`: the provider's own dollars where it reports them, and otherwise, in the
same transaction, the usage weighed at the `price` on the row of the model that
answered it (`weighing`, a precondition of `sessions()`). `session.cost` is
computed, never stored: the sum of its entries' `cost`, absent where none
records any. `sessionCost` is its SQL, registered in `sessionDerived`.

Applications that run a session add components from other packages:
`process{pid, command, cwd}` and `exit{code}` describe its program;
`worktree{repository, path}` describes its checkout; `spawned{parent, call}`
describes delegation; and `imported{source, line}` records imported log entries.
Start, latest-input, and finish times are entry `created.at` values. The last
`content` and `usage` record what the run produced. Persona and role remain
referenced entities.

`archived{at}` is the general `@yaks/kernel` visibility marker. Archiving a
session does not stop its runner, release claims, remove entries, or change
transcript status.

## Claims

<a id="a-lock-is-a-lease-not-a-patch"></a>

`claim{session}` is stored on the entity a session claims. A **batch** is a list
of changes applied in one transaction. If a batch attempts to replace another
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
`session_release` runs when a transcript stops or fails and releases its claims;
its sweep also finds claims left by transcripts that ended before a worker ran.

## Running a transcript

<a id="when-something-runs-the-session"></a>

`react()` performs one required step: request a model response, run the next
tool call, or retry an error. `settle()` runs a transcript until it has nothing
more to do, under a lease named for it, so two processes never run one
transcript at once.

That is the runner, and it runs wherever the effects role does, never as a loop
in the process that asked. `session_run` is an effect this package declares: a
commit that asks a transcript for a turn (a `using` on an entry, a child
admitted, a task it holds finishing) owes a run in the same transaction, and any
process working the `@yaks/effects` pool takes it. `running(g, runner)` is the
handler a host registers, lent the models, tools and limits it has; a transcript
asking for a provider the host was lent nothing for, such as a command line
`@yaks/spawn` launches, is left to whoever answers it.

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

<a id="recorded-tool-execution"></a>

Tool execution vocabulary belongs to `@yaks/tools`. The session loop builds a
runner for each step, executes transcript calls serially, and writes returned
text as `content{body}` plus `output{source}` beside a `result` entry with its
`call` and `ms` fields. A precommit rule adds `entry.session` to results before
sequence allocation. The general tool-runner plugin is not registered because
its effect-phase execution would race the session loop. An unknown tool is
handled by a refusing tool, producing an `error{code}` result. A durable
`execution.state=running` without a result is not replayed. On restart, a tool
may recover its outcome from durable state; otherwise the runner records an
interrupted result so the model can inspect the state before taking another
action. The session then continues.

## Reading transcripts

<a id="bounded-transcript-reads"></a>

`transcript()` loads the full fork-aware history used for a model request.
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

`yak hooks install` writes lifecycle hooks into a Claude-compatible settings
file (default `~/.claude/settings.json`), replacing an earlier install and
leaving every other entry alone. A harness runs each hook with the event as JSON
on stdin.

| Event                       | Command                        | Effect                                                        |
| --------------------------- | ------------------------------ | ------------------------------------------------------------- |
| SessionStart, SubagentStart | `yak session context --hook -` | creates the session under the harness's id; prints its claims |
| SessionEnd                  | `yak session wrap --hook -`    | releases the session's claims                                 |

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

Every entry carries `imported{source, line}`, and each file read is an entity of
its own, `log{session, source, consumed}`, that says how many of its lines have
been read, which is where a resume starts: a line that made no entry, or whose
entries were deleted since, is not read again. Entry IDs are derived from the
session, the line and the place in it, so a line read twice writes nothing new.
A harness can write one session's id into two files; the session's first log
(`session.log`) keeps those IDs, and an entry of any other log names its file
too, so the two never collide. Each entry is dated when the harness wrote it.

`@yaks/spawn` follows a managed run's stdout with it. The
`@yaks/session/service` duty follows Claude Code's transcript files,
`<project>/<session>.jsonl` under its projects directory: one written to in the
last `full` milliseconds is read as it grows, at full depth, and an older one is
read in lazily, one per pass, its prose alone. A look reads the transcripts it
already follows least behind first, then the ones it has yet to open most
recently written first, each for a slice (`SLICE`, 100 ms) until its budget
(`BUDGET`, a second) is spent, so a backlog is read over many looks and a live
session's next lines lead every one. It skips a managed run, whose transcript
asks a provider for it (`using{provider}`). A subagent's transcript,
`<session>/subagents/agent-<id>.jsonl`, is read the same way (`subagent`, the
reader whose lines are all side conversations) into a session of its own:
`session{id}` the agent id, its eid `sessionEid(id, parent)`, and
`spawned{parent, call}` naming the session that started it and, from the
`agent-<id>.meta.json` beside it, the call that did. A Claude Code compaction
summary becomes a checkpoint in the transcript; a native continuation starts
there.

Once an hour the duty finds the imported sessions whose newest entry is older
than `full` (`stale()`), from any importer, and strips each to its prose
(`strip()`, a small batch between looks): calls, results, thoughts, notices and
a turn's ending go; what a person typed and what the model said stay. Compaction
summaries stay too, so an older transcript can still resume, and so does an
entry that records what a turn cost, since the session's cost is their sum.

| Option        | Default              | Meaning                                 |
| ------------- | -------------------- | --------------------------------------- |
| `every`       | `1000`               | milliseconds between looks              |
| `transcripts` | `~/.claude/projects` | where transcripts are read from         |
| `full`        | 14 days              | how long a session keeps its full depth |

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
as. The `@yaks/session/rules` entry point exports `authenticate()`, which reads
the session from the `x-via` header, for every door over the graph: an HTTP
request and a `yak` command alike. Writes use `session.actor` as `by` when
present, otherwise the session itself; `via` identifies the session in either
case. Applications enforce access separately.

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
- inspection: `statusOf()`, `kindOf()`, `textOf()`, `ordered()`,
  `sessionDerived`, and the bounded transcript functions;
- identity and rendering: `sessionFor()`, `sessionEid()`, `speaking()`,
  `where()`, and `sessionViews`, the portable transcript renderers;
- harness readers: `claude`, `subagent`, `codex`, `readers`, and `scrub()`;
- error types including `Bounced`, `Unnamed`, and `UnknownSession`.

Additional entry points are `@yaks/session/vocab`, `/rules` (with
`authenticate`), `/tools`, `/views`, `/service` (the duty that reads
transcripts), and `/tail` (the importer). `/views` is `views`, the portable
renderers, and `inspectViews`, how the inspector (@yaks/inspect) draws an entry
and a session: an entry as a turn of its conversation (`Inspect.Turn`), the
turns either side of it (`Inspect.Conversation`, what a belief citing the entry
shows), the entry's page inside its conversation, and a session's page with its
status, brief and latest turns. A **host** is the process that opened the graph;
effects and tools receive its graph and, where needed, its process entity ID.

<a id="what-is-deliberately-not-here"></a>
<a id="compatibility"></a>

The main package runs in Deno, Node, browsers, and Cloudflare Workers. Process
execution belongs to `@yaks/process`; command-line agent execution belongs to
`@yaks/spawn`.
