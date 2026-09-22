# @yaks/tools

`@yaks/tools` executes tools through a graph and records each invocation in that
graph. A tool is a named function that receives graph data and validated
arguments, then returns graph patches. The package records the request,
execution state, result, elapsed time, and any failure.

```sh
deno add jsr:@yaks/tools
```

A **bundle** is one entity's components represented as a JSON object. In
[@yaks/graph](../graph), it is also the patch used to read or write that entity:
the `entity` field contains its id, and the other fields contain its components.
A tool receives the call entity as a bundle and returns an array of bundles:

```ts
import type { Tool } from '@yaks/graph'

const greet: Tool = {
  noun: 'person',
  verb: 'greet',
  description: 'Greet a person',
  inputSchema: {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' } },
  },
  run: (_bundles, ctx) => [{
    entity: { eid: '$greeting' },
    content: { body: `hello ${ctx.args.name}` },
    output: { source: ctx.call },
  }],
}
```

The runner parses `call.args`, validates it against `inputSchema`, and exposes
the result as `ctx.args`. The context also provides the call id, caller
identity, graph access, and an optional working directory. A tool does not apply
its returned bundles. The runner applies them and attributes the writes to the
caller.

<a id="components"></a>

## Stored data

The graph is the durable store for calls and their outcomes. `toolsDoc` declares
these components:

- `tool{name, description}` identifies a registered tool. `name` is its identity
  (the vocabulary's `identity` keyword): the entity id is derived from it, and
  `toolEid(name)` computes that id for a call to point at.
- `call{to, args, id?, source?}` records an invocation. `to` refers to a `tool`
  entity, `args` is a JSON string, `id` can preserve a transport's correlation
  id, and `source` can refer to the request or schedule that created the call.
- `execution{state, by?}` records the state (`running`, `done`, or `failed`)
  and, when configured, the process that claimed the call.
- `result{call, ms}` refers to the completed call and records its duration. The
  result entity also gets `content{body}` containing a text rendering of the
  answer.
- `content{body}` stores text. `output{source, id?, phase?}` identifies what
  produced output and can preserve provider-specific output metadata.
- `error{code}` records an expected failure. `exception` records an unexpected
  failure and can carry diagnostic fields supplied by the graph's stamping
  rules.

The call is written before its tool runs, so the request remains recorded if
execution is interrupted. Tool output, the result, and the final execution state
are then committed together. A tool marked `readOnly` returns existing bundles
without writing them again; the runner still stores its result and execution
state.

<a id="running-a-tool"></a>

## Ordinary usage

Load the vocabulary into a graph, create a runner with the tools available in
the current process, and register their `tool` entities with `ensure()`:

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  answerOf,
  faulted,
  runner,
  toolEid,
  toolsDoc,
  worded,
} from '@yaks/tools'

const vocab = loadVocab([toolsDoc])
const g = graph({ vocab, storage: ram(vocab) })
const r = runner(g, { tools: [greet] })
await r.ensure()

const records = await r.call([{
  entity: { eid: '$call' },
  call: { to: toolEid('person_greet'), args: '{"name":"Ada"}' },
}])

if (faulted(records)) throw new Error(worded(answerOf(records)))
console.log(worded(answerOf(records)))
```

`call()` writes the supplied changes, finds the call bundle among them, and runs
its tool. It returns the tool's output together with runner bookkeeping. Use
`answerOf()` to remove `result` and `execution` bundles before displaying the
answer. `worded()` joins `content.body` values, or returns formatted JSON when
no text is present. `faulted()` checks the stored execution state rather than
treating an answer that contains `error` data as an execution failure.

Use `run(callId)` for a call already stored in the graph. Use `drive()` to run
all currently eligible calls in one pass.

<a id="whose-name-a-tool-writes-in"></a>

The runner reads the caller from the call's `created.by` provenance stamp and
uses that identity when applying tool output. Authorization therefore applies to
the caller rather than the process executing the tool. If the vocabulary does
not declare and stamp `created`, the tool runs without a caller identity.

The graph passed as the first argument to `runner()` stores calls and runner
bookkeeping. The optional `host` setting is a `Graph` that tools access through
`ctx.graph` and `ctx.read`; it defaults to the storage graph. This separation
lets a process keep invocation records in one graph while tools operate on
another.

Other runner options are `owner`, the process entity written to `execution.by`;
`cwd`, passed to tools as `ctx.cwd`; `report`, called for unexpected errors;
`otherwise`, the tool that answers a call naming none of the runner's tools
(left out, such a call is left for the runner that has its tool); and `now`, an
injectable clock used to measure `result.ms`.

<a id="the-two-rules"></a>

## Selecting pending calls

`toolsDoc` declares two effect-phase rules:

```text
call_ready  $call .call, !results, !wake;         +result.call=$call
call_woken  $call .call, .wake, .fired, !results; +result.call=$call
```

`call_ready` selects a call with no result and no `wake` component. `call_woken`
selects a call whose [@yaks/wake](../wake) trigger has fired. If the graph does
not load the wake components, only the first rule can match.

The emitted result entity has an id derived from the rule match. Reprocessing
the same call therefore addresses the same result entity rather than creating a
second one.

Importing `@yaks/tools` does not start a polling loop or register effects. A
process that should execute calls written by other processes registers each
runner rule with [@yaks/effects](../effects):

```ts
for (const rule of r.rules) {
  fx.on(rule.plan, (event) => r.run(event.entity.eid))
}
```

`drive()` evaluates the same rules once. `reconcile(r)` calls
`drive({ redrive: true })` and is intended for startup recovery.

<a id="at-most-once-and-what-a-crash-leaves-behind"></a>

## Claims and recovery

Before invoking a tool, the runner writes `execution.state = "running"` with a
precondition that prevents two processes from claiming an unclaimed call. It
then writes `done` or `failed` with the result. Concurrent runners over the same
graph share an in-process invocation and stored answer.

When `owner` is set, `execution.by` identifies the process holding the claim. A
runner leaves a call claimed by another active owner alone. If that owner's
entity has an `exit` component, the claim is considered abandoned and a later
sweep can take it. This also prevents imported call histories from being
executed again merely because another runner reads them.

Calling `run()` for a call that has a `running` claim but no result throws
`UnfinishedCall`. `reconcile()` retries such calls during startup. Retrying can
repeat an external side effect if the process stopped after that effect but
before committing the result, so the package provides at-most-once claiming, not
an exactly-once execution guarantee.

Throw `CallError(code, message)` for an expected refusal. The runner stores an
`error{code}` bundle, marks the execution failed, and returns a result. Other
thrown values produce an `exception` bundle and are also passed to `report`.
Argument parsing, schema validation, and rejected graph writes follow the same
failure path, ensuring a claimed call ends in `failed` with a result.

<a id="scheduling"></a>

## Scheduled calls

A call with `wake{at}` becomes eligible after its `fired` component is written.
A call with `wake{every}` is a recurring schedule and is not executed itself.
Each firing creates a separate call whose `call.source` refers to the schedule.
The generated call id is derived from the schedule id and firing time, so two
different firing times create two calls and repeating the same firing time
addresses the same call.

Keep one scheduling owner per graph. [@yaks/session](../session) runs the calls
in its transcript in order through `run()` and does not register these effects.

<a id="a-check-is-a-tool-whose-verb-is-check"></a>

## Health checks

A health check is an ordinary tool whose `verb` is `check`. There is no separate
registry: `checks(tools)` filters a loaded tool list to those checks. Each
package can therefore declare checks for its own invariants, and removing that
package removes its checks.

```ts
import { ailing, checked, checks } from '@yaks/tools'

const available = checks(r.tools)
```

`checked(call, about, findings)` builds the standard one-bundle response for a
check. It always includes readable `content.body` and `output.source`. If there
are findings, `error.code` contains the most severe level: `fail` for a measured
invariant violation, or `warn` for a leak or an outcome the check could not
determine. A check with no findings still returns a response. `ailing(answer)`
is true only when that verdict is `fail`. Reporting a failed invariant does not
mean the tool invocation itself failed; use `faulted()` for the latter.

## Exports

The main `@yaks/tools` entry point exports:

- vocabulary documents: `toolsDoc`, `callDoc`, and `toolDoc`;
- runner construction and types: `runner`, `Runner`, and `Opts`;
- rule metadata: `RULES`, `READY`, and `WOKEN`;
- invocation helpers: `toolEid`, `answerOf`, `worded`, `faulted`, and
  `reconcile`;
- errors: `CallError` and `UnfinishedCall`;
- check helpers and types: `CHECK`, `checks`, `checked`, `ailing`, `Finding`,
  and `Level`.

Use `@yaks/tools/vocab` when only declarations are needed. It exports
`toolsDoc`, `callDoc`, `toolDoc`, and `docs` without importing the runner or the
JSON Schema validation code. `callDoc` contains the invocation and output
components but omits `tool`; `toolDoc` contains only `tool`; `toolsDoc` contains
both plus the effect rules.

<a id="what-replaced-the-tool-call-log"></a>

## Querying invocation history

Invocation history lives in the graph rather than in a separate telemetry table.
The former log fields map to graph data as follows:

| Information | Graph field                                                               |
| ----------- | ------------------------------------------------------------------------- |
| Tool        | `call.to`, referring to `tool{name}`                                      |
| Caller      | `created.by` on the call                                                  |
| Duration    | `result.ms`                                                               |
| Outcome     | `execution.state`                                                         |
| Failure     | An `error` or `exception` bundle whose `output.source` refers to the call |
| Time        | `created.at`                                                              |

For example:

```text
.result                       # completed calls, newest first
.exception                    # unexpected failures
.call .execution.state=failed # calls whose execution failed
```

Because these records are graph components, they are journaled and available to
graph subscriptions. The old transport name is not stored; add a component to
`call` if an application needs it. These records also cannot survive a failure
that prevents the graph transaction itself from being written.
