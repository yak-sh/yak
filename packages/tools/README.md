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
A tool is `run(call, graph)`: it receives the call entity as a bundle and the
graph it runs on, and returns an array of bundles:

```ts
import { argsOf, type Tool } from '@yaks/graph'

const greet: Tool = {
  noun: 'person',
  verb: 'greet',
  description: 'Greet a person',
  inputSchema: {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' } },
  },
  run: (call) => [{
    entity: { eid: '$greeting' },
    content: { body: `hello ${argsOf(call).name}` },
    output: { source: call.entity.eid },
  }],
}
```

`call.args` is an object. The runner validates it against `inputSchema` and
hands the tool the call with the validated arguments in their place (`argsOf`),
the caller in `created{by, via}` (`who`), and, where a program on this machine
runs the call, that program in `process{pid, command, cwd}`. A tool does not
apply its returned bundles. The runner applies them and attributes the writes to
the caller.

<a id="components"></a>

## Stored data

The graph is the durable store for calls and their outcomes. `toolsDoc` declares
these components:

- `tool{name, description}` identifies a registered tool. `name` is its identity
  (the vocabulary's `identity` keyword): the entity id is derived from it, and
  `toolEid(name)` computes that id for a call to point at.
- `call{to, args, id?, source?}` records an invocation. `to` refers to a `tool`
  entity, `args` is an object of arguments, `id` can preserve a transport's
  correlation id, and `source` can refer to the request or schedule that created
  the call.
- `execution{state, by?}` records the state (`running`, `done`, or `failed`)
  and, when configured, the process that claimed the call.
- `result{call, ms}` refers to the completed call and records its duration. The
  result entity also gets `content{body}` containing a text rendering of the
  answer.
- `content{body}` stores text. `output{source, id?, phase?, value?}` identifies
  what produced output, can preserve provider-specific output metadata, and
  carries the output as data where its producer declared a shape for it.
- `error{code}` records an expected failure. `exception` records an unexpected
  failure and can carry diagnostic fields supplied by the graph's stamping
  rules.

The call is written before its tool runs, so the request remains recorded if
execution is interrupted. Tool output, the result, and the final execution state
are then committed together. A tool marked `readOnly` returns existing bundles
without writing them again; the runner still stores its result and execution
state. A call with `check: true` to a tool that writes is a rehearsal: the
runner applies the tool's output with every check and rolls it back, answers
what a kept write would have returned, and stores only its own bookkeeping.

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

const records = await r.call({
  entity: { eid: '$call' },
  call: { to: toolEid('person_greet'), args: { name: 'Ada' } },
})

if (faulted(records)) throw new Error(worded(answerOf(records)))
console.log(worded(answerOf(records)))
```

`call()` writes the call already claimed, in one change, and runs its tool in
this process: the caller asking is the one waiting for the answer. A `$` eid is
given a fresh one first, so the call is in flight here from the moment it is
written. It returns the tool's output together with runner bookkeeping. Use
`answerOf()` to remove `result` and `execution` bundles before displaying the
answer. `worded()` joins `content.body` values, or returns formatted JSON when
no text is present. `structured(tool, answer)` is the answer as data: the
bundles under `result`, or the `output.value` of a tool that declares an
`outputSchema`. `faulted()` checks the stored execution state rather than
treating an answer that contains `error` data as an execution failure.

Use `run(callId)` for a call already stored in the graph, and `due(callId)` for
one a rule selected: it runs the call if nobody holds it and otherwise leaves
it, where `run()` answers with the call in flight or refuses an unfinished one.
Use `drive()` to run all currently eligible calls in one pass.

<a id="whose-name-a-tool-writes-in"></a>

The runner reads the caller from the call's `created.by` provenance stamp and
uses that identity when applying tool output. Authorization therefore applies to
the caller rather than the process executing the tool. If the vocabulary does
not declare and stamp `created`, the tool runs without a caller identity.

The graph passed as the first argument to `runner()` stores calls and runner
bookkeeping. The optional `host` setting is the `Graph` handed to tools as their
second argument; it defaults to the storage graph. This separation lets a
process keep invocation records in one graph while tools operate on another.

Other runner options are `owner`, the process entity written to `execution.by`;
`process`, the `{pid, command, cwd}` of the program running the calls, put on
every call a tool is handed and never stored; `report`, called for unexpected
errors; `otherwise`, the tool that answers a call naming none of the runner's
tools (left out, such a call is left for the runner that has its tool); and
`now`, an injectable clock used to measure `result.ms`.

<a id="the-two-rules"></a>

## Selecting pending calls

`toolsDoc` declares two effect-phase rules:

```text
call_ready  $call .call, !execution, !results, !wake; +result.call=$call
call_woken  $call .call, .wake, .fired, !results;       +result.call=$call
```

`call_ready` selects a call nobody has claimed, with no result and no `wake`
component. A call written through `call()` carries its claim from the start, so
it owes no run: the caller is running it. `call_woken` selects a call whose
[@yaks/wake](../wake) trigger has fired. If the graph does not load the wake
components, only the first rule can match.

The emitted result entity has an id derived from the rule match. Reprocessing
the same call therefore addresses the same result entity rather than creating a
second one.

Importing `@yaks/tools` does not start a polling loop or register effects. A
process that should execute calls written by other processes registers each
runner rule with [@yaks/effects](../effects):

```ts
for (const rule of r.rules) {
  fx.on(rule.plan, (event) => r.due(event.entity.eid))
}
```

`drive()` evaluates the same rules once. `reconcile(r)` calls
`drive({ redrive: true })` and is intended for startup recovery.

<a id="at-most-once-and-what-a-crash-leaves-behind"></a>

## Claims and recovery

Before invoking a tool, the runner writes `execution.state = "running"` with a
precondition that prevents two processes from claiming an unclaimed call. It
then writes `done` or `failed` with the result, and a runner that loses the
claim to another has nothing to run. Concurrent runners over the same graph
object share an in-process invocation.

When `owner` is set, `execution.by` identifies the process holding the claim. A
runner leaves a call claimed by another active owner alone. If that owner's
entity has an `exit` component, the claim is considered abandoned and a later
sweep can take it. This also prevents imported call histories from being
executed again merely because another runner reads them.

A claim naming this runner's own owner that this runner is not running belongs
to another thread of the same process, and is left to it, redrive and all: a
process's own claims are taken again only once it has exited. Calling `run()`
for a call that has a `running` claim with no owner and no result throws
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
check. `about` is the claim that holds when nothing is found ("no transcript has
stalled"): the body reads `<about> — nothing to report`, or
`<n> finding(s) against: <about>` above the findings. It always includes
readable `content.body` and `output.source`. If there are findings, `error.code`
contains the most severe level: `fail` for a measured invariant violation, or
`warn` for a leak or an outcome the check could not determine. A check with no
findings still returns a response. `ailing(answer)` is true only when that
verdict is `fail`. Reporting a failed invariant does not mean the tool
invocation itself failed; use `faulted()` for the latter.

## Exports

The main `@yaks/tools` entry point exports:

- vocabulary documents: `toolsDoc`, `callDoc`, and `toolDoc`;
- runner construction and types: `runner`, `Runner`, and `Opts`;
- rule metadata: `RULES`, `READY`, and `WOKEN`;
- invocation helpers: `toolEid`, `answerOf`, `worded`, `structured`, `faulted`,
  and `reconcile`;
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
