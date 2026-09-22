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
| `content{body}` with `output{source}` | model or process output            |
| `call{to, id, args, source}`          | a tool call requested by a model   |
| `result{call}` with `content`         | a tool result                      |
| `using{provider, model, effort}`      | model selection on an input or ask |
| `stop`                                | no further transcript work         |
| `error{code}`                         | an expected failure                |
| `exception`                           | an unexpected failure              |

`entry.seq` is assigned transactionally when omitted. `appendEntry()` is the
usual way to append text, and `repairSequences()` migrates older data while
preserving entry IDs and references.

```ts
import { appendEntry } from '@yaks/session'

await appendEntry(graph, sessionId, 'Please review this change')
await appendEntry(graph, sessionId, 'Build completed', {
  eid: 'notice:build-123',
  notice: true,
})
```

A fork has `fork{from}` on its session entity. Its logical transcript contains
the parent transcript through the referenced entry, followed by its own entries.
Provider continuation data is stored as a provider-specific component on an ask
entry; for example, `@yaks/openai` stores `openai{response_id}`.

Session status is derived from entries rather than stored. `statusOf()` returns
`empty`, `pending`, `running`, `settled`, `stopped`, or `failed`.
`sessionDerived` exposes the corresponding `session.status` SQL-derived column.
An unanswered call from the newest model request keeps a transcript `running`
regardless of later entries. Otherwise, input/result means `pending`, ask/call
means `running`, output means `settled`, stop means `stopped`, and exception or
three consecutive errors means `failed`. No entries means `empty`. There is no
separate `input` component.

Applications that run a session add components from other packages:
`process{pid, command, cwd}` and `exit{code}` describe its program;
`worktree{repository, path}` describes its checkout; `spawned{parent, call}`
describes delegation; and `imported{source, line}` records imported log entries.
Start, latest-input, and finish times are entry `created.at` values. The last
`content`, `usage`, and process output record what the run produced. Persona and
role remain referenced entities.

`archived{at}` is the general `@yaks/kernel` visibility marker. Archiving a
session does not stop its daemon, release claims, remove entries, or change
transcript status.

## Claims

<a id="a-lock-is-a-lease-not-a-patch"></a>

`claim{session}` is stored on the entity a session claims. A **batch** is a list
of changes applied in one transaction. If a batch attempts to replace another
session's claim, the whole transaction fails with `Bounced`; the collision is
then recorded as `conflict{target, loser, holder, at}`.

```ts
graph.apply([{ entity: { eid: page }, claim: { session: ada } }])
graph.apply([{ entity: { eid: page }, claim: { session: bo } }])
// Bounced: <page> is already claimed by <ada>
```

Reclaiming with the same session is harmless. Set `claim: null` to release a
claim; release is unguarded so a caller can hand a claim over. The collision
check runs in the transaction's `precondition` phase, before cascades change
rows. After rollback, the `audit` phase records the conflict in a separate
transaction. Claims do not expire. Deleting a session releases its claims
through the graph cascade. `reapLeases(storage)` releases claims whose holder is
no longer a session.

## Running a transcript

<a id="the-daemon"></a>
<a id="when-something-runs-the-session"></a>

`react()` performs one required step: request a model response, run the next
tool call, or retry an error. `settle()` repeats steps directly. `daemon()`
registers the same work with `@yaks/effects` so new entries schedule turns.

This complete example runs in memory with a local model function:

```ts
import { effects } from '@yaks/effects'
import { graph } from '@yaks/graph'
import { type Model, modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { daemon, sessionDoc, sessions, transcript } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
const fx = effects(vocab)
const g = graph({ storage: ram(vocab), vocab, plugins: [sessions(), fx] })
const model: Model = async (request) => ({
  id: crypto.randomUUID(),
  model: request.model,
  items: [{ kind: 'assistant', text: 'pong' }],
})
const d = daemon(g, fx, { model, tools: [] })
try {
  await g.apply([
    { entity: { eid: 'provider' }, provider: { name: 'local' } },
    {
      entity: { eid: 'model' },
      model: { name: 'example', provider: 'provider' },
    },
    { entity: { eid: 'session' }, session: {} },
    {
      entity: { eid: 'input' },
      entry: { session: 'session' },
      content: { body: 'Reply with pong' },
      using: { provider: 'provider', model: 'model' },
    },
  ])
  await d.idle('session')
  console.log(await transcript(g, 'session'))
} finally {
  await d.stop()
}
```

Replace the local function with `responses({ credential })` from `@yaks/openai`
to use that provider; also load its `openaiDoc` vocabulary.
`deno task session:spike` is the repository's provider-backed example, which
prints a transcript with the `Line` and `Status` renderers.

`daemon.interrupt(session)` returns whether it found an active turn and aborts
that turn's model request. It does not wait for provider acknowledgement or stop
independent tool processes. Models receive the abort through `Request.signal`;
custom models must observe it. `daemon.stop()` stops accepting work and drains
admitted callbacks.

<a id="recorded-tool-execution"></a>

Tool execution vocabulary belongs to `@yaks/tools`. The session loop builds a
runner for each step, executes transcript calls serially, and writes returned
text as `content{body}` plus `output{source}` beside a `result` entry with its
`call` and `ms` fields. A precommit rule adds `entry.session` to results before
sequence allocation. The general tool-runner plugin is not registered because
its effect-phase execution would race the session loop. An unknown tool is
handled by a refusing tool, producing an `error{code}` result. A durable
`execution.state=running` without a result requires explicit recovery and is not
replayed automatically (`UnfinishedCall`).

## Reading transcripts

<a id="bounded-transcript-reads"></a>

`transcript()` loads the full fork-aware history used for a model request.
`transcriptWindow()` reads a bounded page for user interfaces:

```ts
import { transcriptWindow } from '@yaks/session'

const newest = await transcriptWindow(graph, sessionId, { limit: 64 })
const around = await transcriptWindow(graph, sessionId, { anchor: entryId })
const oldest = await transcriptWindow(graph, sessionId, { edge: 'start' })
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

## Identity and HTTP attribution

<a id="one-id-means-one-run"></a>

`sessionFor()` resolves an entity ID, a human-readable session ID, or a harness
session ID to the same entity. `speaking()` returns the actor a session writes
as. The `@yaks/session/routes` entry point exports `authenticate()`, which reads
the session from the `x-via` header. Writes use `session.actor` as `by` when
present, otherwise the session itself; `via` identifies the session in either
case. Applications enforce access separately.

<a id="appending-entries"></a>

Explicit sequence positions are supported for imports. Fractional and occupied
positions are rejected, while retrying an existing entry ID preserves its
position. Passive notices do not wake a settled session; the `notice` tool
appends them without requiring a sequence number. Direct `g.apply` calls can
also omit `entry.seq` when additional components are needed. `repairSequences()`
processes parents before forks and preserves `fork.from` and `ask.through`
references. Historical ties are resolved by creation stamp, storage order, then
entity ID; unpositioned entries are placed after the last entry stamped before
them, with ties resolved by the same rule. Run repair before starting session
work. Concurrent older writers that calculate their own positions must be
upgraded to avoid collision errors.

## Exports

The main module exports:

- vocabulary and constants: `sessionDoc`, `SESSION`, `CLAIM`, `CONFLICT`,
  `ENTRY`, and the other transcript component names;
- graph integration: `sessions()`, `leasing()`, `naming`, `auditing()`,
  `reapLeases()`, and `staleLeases()`;
- execution: `react()`, `settle()`, `daemon()`, `transcript()`, and
  `sessionTools()`;
- inspection: `statusOf()`, `kindOf()`, `textOf()`, `ordered()`,
  `sessionDerived`, and the bounded transcript functions;
- identity and rendering: `sessionFor()`, `speaking()`, `where()`, and `views`;
- error types including `Bounced`, `Unnamed`, and `UnknownSession`.

Additional entry points are `@yaks/session/vocab`, `/rules`, `/tools`,
`/effects`, `/routes`, and `/views`. A **host** is the process that opened the
graph; effects and tools receive its graph and, where needed, its process entity
ID.

<a id="what-is-deliberately-not-here"></a>
<a id="compatibility"></a>

The main package runs in Deno, Node, browsers, and Cloudflare Workers. Process
execution belongs to `@yaks/process`; command-line agent execution belongs to
`@yaks/spawn`.
