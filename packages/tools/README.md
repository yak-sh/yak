# @yaks/tools

Executes recorded graph tool calls and keeps their answers, duration, and
execution state. It also parses app-declared commands and provides their HTTP
route and answer rendering.

## Calls and answers

A **call** is an [entity](../graph/README.md#data-model) recording a request to
run a [tool](../graph/README.md#tools):
`call: { to: toolEid('person_greet'), args: { name: 'Ada' } }`. A **runner**
validates calls, invokes its tools, and writes their answers and bookkeeping to
a [graph](../graph/README.md#data-model) (`Runner`). An **answer** is the array
of [bundles](../graph/README.md#data-model) a tool returns. **Content** is the
text attached to an entity, `content: { body: 'hello' }`. **Output** identifies
what produced an entity, its provider id, and its data:
`output: { source: '<call eid>', value: { total: 3 } }`. A **result** is the
entity recording completion, with `result: { call: '<call eid>', ms: 3 }` and
the answer's text in `content.body`. A **call claim** is the call's
`execution.by`, identifying the runner holding it. **Execution state** is
computed from that call claim, an interruption, and the call's explicitly named
answers: `running`, `done`, `failed`, or `interrupted`.

```sh
deno add jsr:@yaks/tools
```

## Run a tool

A tool returns bundles; the runner applies them as the caller. Load the
[vocabulary](../vocab/README.md#vocabulary), register the tools with `ensure()`,
and use `call()` for a direct invocation. `executionComputed` supplies execution
state to RAM; `executionDerived(vocab)` supplies it to
[SQLite](../sqlite/README.md).

```ts
import { argsOf, graph, type Tool } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  answerOf,
  executionComputed,
  faulted,
  runner,
  toolEid,
  toolsDoc,
  worded,
} from '@yaks/tools'
import { equal } from '@yaks/testing'

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
const vocab = loadVocab([toolsDoc])
const g = graph({ vocab, storage: ram(vocab, { computed: executionComputed }) })
const r = runner(g, { tools: [greet] })
await r.ensure(['person_greet'])
const bundles = await r.call({
  entity: { eid: 'greet-ada' },
  call: { to: toolEid('person_greet'), args: { name: 'Ada' } },
})
equal(faulted(bundles, 'greet-ada'), false)
equal(worded(answerOf(bundles, 'greet-ada')), 'hello Ada')
equal(
  ((await g.get(['greet-ada']))[0].execution as { state: string }).state,
  'done',
)
equal((await g.read('.result.call=greet-ada')).length, 1)
```

`ensure()` registers all the runner's tools; `ensure(names)` registers only
those named. `toolEid(name)` derives the eid from `tool.name`, the vocabulary's
[identity keyword](../vocab/README.md#identity-and-indexes). `toolRow(tool)`
builds the advertised `tool{name, description, revision}` bundle. `call()`
writes the call and call claim together before invoking the tool in this
process. A call whose eid is a [graph alias](../graph/README.md#ids-and-names)
is assigned a fresh eid first.

## Exports

| Import                 | Exports                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/tools`          | `runner`, `Runner`, `Opts`, `Reply`; `toolEid`, `toolRow`, `answerOf`, `worded`, `structured`, `valueIn`, `display`, `faulted`, `parsed`; `reconcile`, `CallError`, `UnfinishedCall`, `Interrupted`; `executionState`, `executionComputed`, `executionDerived`; `RULES`, `READY`, `WOKEN`, `WORDS`, `MOST`; `CHECK`, `checks`, `checked`, `ailing`, `Finding`, `Level`; `toolsDoc`, `callDoc`, `toolDoc` |
| `@yaks/tools/access`   | `mayCall`, `Floor`                                                                                                                                                                                                                                                                                                                                                                                       |
| `@yaks/tools/declared` | `parseTools`, `filled`, `invoke`, `commands`, `schemaOf`, `viewsOf`, `mayCall`, `TOOLS_EXAMPLE`; `Arg`, `ToolDef`, `Tools`, `Context`                                                                                                                                                                                                                                                                    |
| `@yaks/tools/routes`   | `routes`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@yaks/tools/vocab`    | `toolsDoc`, `callDoc`, `toolDoc`, `docs`, `description`, `derived`                                                                                                                                                                                                                                                                                                                                       |
| `@yaks/tools/value`    | `valueIn`                                                                                                                                                                                                                                                                                                                                                                                                |
| `@yaks/tools/views`    | `views`                                                                                                                                                                                                                                                                                                                                                                                                  |

## Stored data

`toolsDoc` declares these [components](../graph/README.md#data-model):

| Component                            | Purpose                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `tool{name, description, revision?}` | Identifies a registered tool; its eid is derived from `name`.                                     |
| `call{to, args, id?, source?}`       | Names the tool, arguments, optional provider id, and originating entity.                          |
| `execution{by, state}`               | Holds the call claim and computed execution state.                                                |
| `result{call, ms?}`                  | Records completion and duration when the runner observed the start.                               |
| `content{body}`                      | Carries content.                                                                                  |
| `output{source?, id?, value?}`       | Records output.                                                                                   |
| `refusal{code}`                      | A **refusal** records a deliberate rejection with a reason code.                                  |
| `exception`                          | An **exception** records an unexpected failure; diagnostic properties may be stamped by the host. |
| `finding{level}`                     | Carries a [check](#health-checks)'s verdict.                                                      |

`callDoc` omits the `tool` declaration; `toolDoc` contains only that
declaration. `toolsDoc` contains both and the runner's effect rules. Importing
declarations from `@yaks/tools/vocab` avoids importing the runner and its input
validation.

```ts
import { callDoc, toolDoc, toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const split = loadVocab([callDoc, toolDoc])
const whole = loadVocab([toolsDoc])
equal(!!split.comp('call'), true)
equal(!!split.comp('tool'), true)
equal(!!whole.comp('result'), true)
```

Calls remain recorded if a process stops before answering. The tool's answer and
runner bookkeeping commit together. A storage refusal marked `retryable: true`
keeps the completed answer in memory and retries persistence with backoff; it
does not invoke the tool again. The first refusal is reported through `report`.
Until persistence succeeds, a process crash can lose that in-memory answer.

## Reads, rehearsals, and failures

A `readOnly` tool returns bundles without writing them again; the runner still
writes its result and call claim. A **rehearsal** is a call with `check: true`
to a tool that writes: every write phase runs, the write rolls back, and the
proposed answer is returned. The runner still records completion.

Throw `CallError(code, message)` for an expected refusal. Other thrown values
produce an `exception` answer and are passed to `report`. Invalid arguments,
failed schema validation, and refused graph writes also produce failed calls.
The runner resolves schema-declared
[references](../vocab/README.md#routing-and-references) through `g.address`
before invocation. A tool that writes is refused if such an argument names no
entity of the declared component; a read-only tool can read whatever the id
names, including deleted history.

```ts
import { graph, type Tool } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  answerOf,
  CallError,
  executionComputed,
  faulted,
  runner,
  toolEid,
  toolsDoc,
} from '@yaks/tools'
import { equal } from '@yaks/testing'

const vocab = loadVocab([toolsDoc])
const g = graph({ vocab, storage: ram(vocab, { computed: executionComputed }) })
const write: Tool = {
  name: 'write_text',
  description: 'Write text',
  inputSchema: { type: 'object', properties: { check: { type: 'boolean' } } },
  run: (call) => [{
    entity: { eid: 'text' },
    content: { body: 'hello' },
    output: { source: call.entity.eid },
  }],
}
const read: Tool = {
  name: 'read_text',
  description: 'Read text',
  readOnly: true,
  run: () => [{ entity: { eid: 'read-only' }, content: { body: 'hello' } }],
}
const refuse: Tool = {
  name: 'refuse',
  description: 'Refuse a call',
  run: () => {
    throw new CallError('access', 'Permission required')
  },
}
const r = runner(g, { tools: [write, read, refuse] })
await r.ensure()
const call = (id: string, name: string, args = {}) =>
  r.call({
    entity: { eid: id },
    call: { to: toolEid(name), args },
  })
const proposed = await call('preview', 'write_text', { check: true })
equal(answerOf(proposed, 'preview')[0].content, { body: 'hello' })
equal(await g.get(['text']), [])
await call('read', 'read_text')
equal(await g.get(['read-only']), [])
await call('write', 'write_text')
equal((await g.get(['text']))[0].content, { body: 'hello' })
const failed = await call('refused', 'refuse')
equal(faulted(failed, 'refused'), true)
equal(answerOf(failed, 'refused')[0].refusal, { code: 'access' })
```

## Read an answer

`answerOf(bundles, callId)` removes this call and its result by identity. It
preserves other calls and results when a tool returns them as data.
`faulted(bundles, callId)` checks the named call's execution state, rather than
mistaking failure data in its answer for a failed invocation.

`worded(answer)` says text-only answers as `content.body`, search hits as one
line, and other bundles whole as JSON. It limits text to `WORDS` characters by
default and counts the bundles left unsaid. `most` in runner options limits the
answer's JSON size to `MOST` characters by default; larger answers are refused
with `too_large`.

`structured(tool, answer)` returns `{ result: answer }`, or `output.value` for a
tool declaring `outputSchema`. `valueIn(answer)` reads that data directly.
`display(value)` renders structured data as Markdown fields.

```ts
import { answerOf, display, structured, worded } from '@yaks/tools'
import { valueIn } from '@yaks/tools/value'
import { equal } from '@yaks/testing'

const value = { total: 3 }
const answer = [{
  entity: { eid: 'total' },
  content: { body: 'Three items' },
  output: { source: 'count', value },
}]
const bundles = [...answer, {
  entity: { eid: 'result' },
  result: { call: 'count', ms: 1 },
}]
equal(answerOf(bundles, 'count'), answer)
equal(worded(answer), 'Three items')
equal(valueIn(answer), value)
equal(structured({ outputSchema: { type: 'object' } }, answer), value)
equal(structured({}, answer), { result: answer })
equal(display(value).includes('**total**: `3`'), true)
equal(display([]), 'No rows.')
```

## Pending calls and scheduling

`run(callId)` executes a stored call, awaits an invocation already running in
this process, or recalls its recorded answer. A read-only answer is not stored
as bundles; recalling it returns its result with the answer's text.
`due(callId)` runs a call a rule selected and leaves a held call alone.
`drive()` runs one pass over eligible calls. `reconcile(r)` calls
`drive({ redrive: true })` for startup recovery.

The runner's [rules](../graph/README.md#data-model) select an unclaimed call
without a result or wake (`call_ready`), or a call whose
[@yaks/wake](../wake/README.md) has fired without a result (`call_woken`). Their
matches derive result eids, so rerunning a call addresses the same result.
Importing this package starts no timer and registers no effects. A host can
register each rule with [@yaks/effects](../effects/README.md):

```ts
import { graph } from '@yaks/graph'
import { effects } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, until } from '@yaks/testing'
import { executionComputed, runner, toolEid, toolsDoc } from '@yaks/tools'

const vocab = loadVocab([toolsDoc])
const fx = effects(vocab, {
  report: (error) => {
    throw error
  },
})
const g = graph({
  vocab,
  storage: ram(vocab, { computed: executionComputed }),
  plugins: [fx],
})
const r = runner(g, {
  tools: [{
    name: 'echo',
    description: 'Say hello',
    run: (call) => [{
      entity: { eid: '$hello' },
      content: { body: 'hello' },
      output: { source: call.entity.eid },
    }],
  }],
})
await r.ensure()
for (const rule of r.rules) fx.on(rule.plan, (event) => r.due(event.entity.eid))
await g.apply([{
  entity: { eid: 'pending' },
  call: { to: toolEid('echo'), args: {} },
}])
await until(async () => (await g.read('.result.call=pending')).length == 1)
equal((await g.read('.output.source=pending&*'))[0].content, { body: 'hello' })
```

A one-shot call with `wake.at` runs in place after firing. A recurring call with
`wake.every` or `wake.while` creates one call per firing, with `call.source`
pointing to the schedule. The generated eid is derived from the schedule eid and
`fired.at`, so repeating a firing does not create a second call. Keep one
scheduling owner per graph. [@yaks/session](../session/README.md) runs its
transcript's calls in order rather than registering these effects.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { wakeDoc } from '@yaks/wake'
import { runner, toolEid, toolsDoc } from '@yaks/tools'
import { equal } from '@yaks/testing'

const vocab = loadVocab([toolsDoc, wakeDoc])
const g = graph({ vocab, storage: ram(vocab) })
let ran = 0
const r = runner(g, {
  tools: [{
    name: 'daily',
    description: 'Do daily work',
    run: () => {
      ran++
      return []
    },
  }],
})
await r.ensure()
await g.apply([{
  entity: { eid: 'schedule' },
  call: { to: toolEid('daily'), args: {} },
  wake: { at: '2030-01-01T00:00:00.000Z', every: '1d' },
}])
await r.drive()
equal(ran, 0)
for (const at of ['2030-01-01T00:00:00.000Z', '2030-01-02T00:00:00.000Z']) {
  await g.apply([{ entity: { eid: 'schedule' }, fired: { at } }])
  await r.drive()
}
await r.drive()
equal(ran, 2)
equal((await g.read('.call.source=schedule')).length, 2)
equal(await g.read('.result.call=schedule'), [])
```

## Call claims, recovery, and interruption

A [precondition](../graph/README.md#writes-and-reads) on `execution.by` prevents
two runners from claiming the same call. Runners over the same graph object
share in-process invocations. The runner leaves call claims held by active
owners alone, including call claims held by its own owner in another runner. An
owner whose entity carries `exit` has abandoned its call claims, so another
runner can take them. Without an explicit `owner`, the runner generates an owner
eid.

`run()` throws `UnfinishedCall` for an unfinished, anonymously claimed call.
`reconcile()` may run it again. Recovery can repeat an external side effect if
the process stopped after the side effect and before persisting the result;
claiming does not guarantee exactly-once execution.

`interrupt(why)` ends calls this runner is running; `interrupt(why, holder)`
ends a holder's unanswered call claims. `interruptCall(callId, why, answer?)`
ends an unstarted or anonymously claimed call without invoking its tool. A named
call claim is refused with `UnfinishedCall`. An `Interrupted(message, code)`
thrown by a tool records interruption rather than a refusal or defect.
Interruption marks are supplied by [@yaks/kernel](../kernel/README.md).

```ts
import { graph } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  executionComputed,
  executionState,
  faulted,
  runner,
  toolEid,
  toolsDoc,
} from '@yaks/tools'
import { equal } from '@yaks/testing'

const vocab = loadVocab([toolsDoc, kernelDoc], [kernelKeywords])
const g = graph({ vocab, storage: ram(vocab, { computed: executionComputed }) })
let ran = 0
const r = runner(g, {
  tools: [{
    name: 'work',
    description: 'Do work',
    run: () => {
      ran++
      return []
    },
  }],
})
await r.ensure()
await g.apply([{
  entity: { eid: 'cancelled' },
  call: { to: toolEid('work'), args: {} },
}])
const interrupted = await r.interruptCall('cancelled', 'Caller cancelled')
equal(faulted(interrupted, 'cancelled'), true)
equal(executionState((await g.get(['cancelled']))[0]), 'interrupted')
await r.drive()
equal(ran, 0)
```

## Runner options

`host` is the graph passed to tool functions; it defaults to the graph storing
calls. `owner` identifies the call claim holder. `process` supplies
`{pid, command, cwd}` on the call handed to the tool and is never stored by the
runner. `otherwise` answers calls naming tools the runner lacks; without it,
those calls are left for another runner. `takes(call)` can restrict which calls
the runner accepts. `now` supplies the clock measuring `result.ms`.

The runner uses the caller's identity from `created.by` or `$actor` when
applying tool answers. It does not invent a caller identity when neither is
present. `report` receives unexpected errors, including failed persistence and
replies.

A **reply** is extra answer bundles owed to a direct caller (`Reply`).
`reply(call, answer, wrote)` runs after `call()`, never after a deferred
invocation. `wrote` contains the tool's applied answer for a kept write and is
empty for reads, rehearsals, and refusals. Replies are appended and not written;
a failed reply is reported and the tool's answer still returns.

```ts
import { graph, type Tool } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { answerOf, runner, toolEid, toolsDoc, worded } from '@yaks/tools'
import { equal } from '@yaks/testing'

const vocab = loadVocab([toolsDoc])
const records = graph({ vocab, storage: ram(vocab) })
const host = graph({ vocab, storage: ram(vocab) })
await host.apply([{ entity: { eid: 'source' }, content: { body: 'hello' } }])
const read: Tool = {
  name: 'read',
  description: 'Read host text',
  readOnly: true,
  run: (_call, graph) => graph.get(['source']),
}
const r = runner(records, {
  tools: [read],
  host,
  owner: 'server',
  reply: async (_call, _answer, wrote) => {
    equal(wrote, [])
    return [{ entity: { eid: 'extra' }, content: { body: 'reply' } }]
  },
})
await r.ensure()
const bundles = await r.call({
  entity: { eid: 'read-host' },
  call: { to: toolEid('read'), args: {} },
})
equal(worded(answerOf(bundles, 'read-host')), 'hello\nreply')
equal(await records.get(['source', 'extra']), [])
```

## Health checks

A **check** is a tool whose `verb` is `check`; `checks(tools)` selects those
tools. A **finding** is `{ level, text }` describing something a check found
(`Finding`). A finding's **level** is `fail` for a measured contract violation
or `warn` for a leak or a verdict the check could not establish (`Level`).

`checked(callId, about, findings)` builds one answer bundle, even with no
findings. `finding.level` carries the most severe level. `ailing(answer)` tests
for `fail`; reporting a violation does not itself make the invocation fail.

```ts
import { ailing, checked, checks, worded } from '@yaks/tools'
import { equal } from '@yaks/testing'

const tools = [{ noun: 'queue', verb: 'check' }, {
  noun: 'queue',
  verb: 'list',
}]
equal(checks(tools), [tools[0]])
const clear = checked('check-queue', 'No calls are stuck', [])
equal(worded(clear), 'No calls are stuck — nothing to report')
equal(ailing(clear), false)
const failed = checked('check-queue', 'No calls are stuck', [
  { level: 'warn', text: 'A holder cannot be inspected' },
  { level: 'fail', text: 'A call has no active holder or result' },
])
equal(failed[0].finding, { level: 'fail' })
equal(ailing(failed), true)
```

## App-declared commands

A **command** is an app's `tool: true` declaration with exactly one act:
`apply`, `query`, or `worker` (`ToolDef`). A **command template** is that
command's `apply` bundles or `query` text with `$name` variables filled from
arguments. `parseTools(source, componentNames)` reads and checks these
declarations from a JSON string or object. `filled(command, args)` fills its
command template without performing the act; `invoke(command, args, acts)` hands
it to the supplied boundary. `commands(definitions, worker?)` converts
declarations to tools a runner can execute.

```ts
import { filled, invoke, parseTools, schemaOf } from '@yaks/tools/declared'
import { equal } from '@yaks/testing'

const definitions = parseTools({
  $defs: {
    log_run: {
      tool: true,
      description: 'Log a run',
      input: { miles: { type: 'number' }, note: { type: 'string' } },
      required: ['miles'],
      apply: {
        entity: { eid: '$run' },
        run: { miles: '$miles', note: '$note' },
      },
    },
    runs: {
      tool: true,
      description: 'Read runs',
      input: { since: { type: 'number' } },
      query: '.run&.run.miles>=$since',
    },
    tick: {
      tool: true,
      description: 'Advance a counter',
      worker: '/tick',
      input: { count: { type: 'integer' } },
      required: ['count'],
    },
  },
}, ['run'])
equal(filled(definitions.log_run, { miles: '5' }), {
  apply: { entity: { eid: '$run' }, run: { miles: 5 } },
})
equal(filled(definitions.runs, {}), { query: '.run' })
equal(filled(definitions.runs, { since: 5 }), { query: '.run&.run.miles>=5' })
equal(schemaOf(definitions.log_run).required, ['miles'])
const acts = {
  apply: (bundles: unknown[]) => bundles,
  query: (query: string) => query,
  worker: (path: string, args: Record<string, unknown>) => ({ path, args }),
}
equal(await invoke(definitions.tick, { count: '2' }, acts), {
  path: '/tick',
  args: { count: 2 },
})
```

A whole `$name` retains the argument's type; within text it becomes text. `$$`
is a literal dollar sign. Omitted optional arguments remove their containing
keys or `&`-separated query clauses. Unbound eids in `apply` remain graph
aliases; unknown variables and undeclared component names are refused. Query
argument values are percent-encoded; an entire query supplied through one
argument is passed through. See [query syntax](../query/README.md#query-model).

`model: true` offers a command to an app's models. A command template's
`$session`, when not declared as an input, must come from the invocation's
`Context.session`. `view` names a relative HTML file in the app;
`viewsOf(source)` lists the files for the host to check. `discoverable: false`
is metadata for hosts to hide internal commands. A worker command can declare
`readOnly: true`; a query command is read-only by its act.

A **floor** is the least caller authority a command requires: `person`,
`editor`, or `owner` (`Floor`). `mayCall(floor, person, role)` checks this
floor; the host still authorizes each act.

```ts
import { mayCall } from '@yaks/tools/access'
import { commands, filled, parseTools, viewsOf } from '@yaks/tools/declared'
import { equal } from '@yaks/testing'

const source = {
  $defs: {
    own_calls: {
      tool: true,
      description: 'Read this session’s calls',
      model: true,
      input: {},
      query: '.call.source=$session',
      view: 'calls.html',
      floor: 'person',
    },
  },
}
const definitions = parseTools(source)
equal(viewsOf(source), ['calls.html'])
equal(filled(definitions.own_calls, {}, { session: 's1' }), {
  query: '.call.source=s1',
})
equal(commands(definitions)[0].readOnly, true)
equal(mayCall('editor', 'ada', 'editor'), true)
equal(mayCall('owner', 'ada', 'editor'), false)
equal(mayCall('person', null, null), false)
```

## HTTP route and views

`routes(host)` contributes `POST /command` if `host.command` exists. It accepts
`{name,args}`, returns the host's answer with `ok: true`, and converts expected
refusals to HTTP error responses. Unexpected errors propagate to the host. The
host resolves the app and caller and authorizes invocation;
[@yaks/api](../api/README.md) serves the route.

```ts
import { routes } from '@yaks/tools/routes'
import { CallError } from '@yaks/tools'
import { equal } from '@yaks/testing'

const [route] = routes({
  command: async (name, args) => {
    if (name != 'echo') throw new CallError('missing', 'Unknown command')
    return { answer: args.text }
  },
})
const request = (name: string) =>
  new Request('https://example.test/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args: { text: 'hello' } }),
  })
equal(await (await route.handle(request('echo'))).json(), {
  answer: 'hello',
  ok: true,
})
equal((await route.handle(request('unknown'))).status, 404)
equal(routes({}), [])
```

`views` supplies `Tile` and `Page` [renderers](../render/README.md#use) for
`content.body`, preserving line breaks through the rendering backend.

```ts
import { views } from '@yaks/tools/views'
import { render } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab([toolsDoc])
const bundle = { entity: { eid: 'message' }, content: { body: 'one\ntwo' } }
equal(render(views, bundle, 'Tile', vocab).includes('one'), true)
equal(render(views, bundle, 'Page', vocab).includes('two'), true)
```

## Limits

The runner does not discover tools, start a polling loop, or fire wakes. Hosts
load tools through
[@yaks/graph/tools](../graph/README.md#built-in-tool-declarations), register
effects through [@yaks/effects](../effects/README.md), and drive time through
[@yaks/wake](../wake/README.md). Durable storage, stamping, and query
capabilities depend on the graph's installed packages and adapter.
