# @yaks/tools

A tool is a function that reads and writes the graph. A call is the stored
record of having asked for one. This package runs the function and keeps the
record.

```sh
deno add jsr:@yaks/tools
```

```ts
let tool = (bundles, ctx) => [{
  entity: { eid: '$greeting' },
  content: { body: `hello ${ctx.args.name}` },
  output: { source: ctx.call },
}]
```

A bundle — the argument type and the return type above — is
[@yaks/graph](../graph)'s patch for a single entity: an `entity` key holding the
id, and one key per component holding that component's columns. A tool is handed
the bundle of the call entity itself, plus any other bundles the caller attached
to the same transaction. It returns the bundles that make up its answer:
entities it found, entities it wants written, and text as `content{body}`. Its
arguments arrive on the second parameter, the context — `ctx.args`, parsed out
of `call.args` and validated against the tool's declared input schema. A tool
never writes to the graph itself. The runner applies what the tool returned,
stamped with the identity of whoever wrote the call.

Throughout this README, "the server" means whichever process opened the graph
and loaded this package.

## Components

`toolsDoc` declares:

- `tool{name, description}`: a registered tool's identity in the graph — the
  entity a call points at. `toolEid(name)` derives that id from the name, so
  every process writes the same row for the same tool.
- `call{to, args, id?, source?}`: a tool and its arguments, the arguments stored
  as a JSON string. `id` is an optional correlation id from whatever transport
  carried the request; `source` optionally records what led to the call.
- `execution{state}`: `running` while the runner is executing the call, then
  `done` or `failed` once the result is written.
- `result{call, ms}`: the record of a finished call and how long it took. It
  also carries a `content{body}` copy of the answer's text, so a transcript can
  show one line per result.
- `content{body}`, `output{source}`, `error{code}` and `exception`: text, what
  produced that text, and diagnostics.

`callDoc` is the same document without `tool`, and `toolDoc` is `tool` alone,
for applications that already declare one of the two. Import `@yaks/tools/vocab`
when you need only the declarations; it pulls in neither the runner nor the JSON
Schema validator.

## The two rules

The vocabulary declares two rules, written in the ordinary query grammar, that
select the calls still waiting to run:

```
call_ready  $call .call, !results, !wake;         +result.call=$call
call_woken  $call .call, .wake, .fired, !results; +result.call=$call
```

A call with no result and no `wake` component is due immediately. A call that
has a `wake` ([@yaks/wake](../wake)) is due once `fired` records that the wake
went off. In a graph that never loaded the wake components, the `!wake` clause
matches everything and drops out, and `call_woken`, which requires them, never
matches — one rule text that is correct in both graphs.

The result entity is what these rules emit, so its id is derived from the match:
running the same call twice patches one result entity instead of creating two.

The rules are not private machinery. The server registers them, one effect each,
when it wants to pick up calls nobody is already waiting on:

```ts
for (let rule of r.rules) fx.on(rule.plan, (e) => r.run(e.entity.eid))
```

## Running a tool

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { runner, toolEid, toolsDoc } from '@yaks/tools'

let vocab = loadVocab([toolsDoc, mine])
let g = graph({ vocab, storage: ram(vocab) })
let r = runner(g, { tools: [echo] })
await r.ensure()

let answer = await r.call([{
  entity: { eid: '$call' },
  call: { to: toolEid('text_echo'), args: '{"text":"hello"}' },
  $actor: { by: me },
}])
```

`call()` writes the call entity first — the record of what was asked stands
whether or not a result ever does — and then runs the tool function in this
process, for this caller, and applies what it returned together with a result
entity. `run(call)` runs a call that is already in the graph. `drive()` runs
every call the two rules select, which is what a boot sweep does.
`answerOf(landed)` is the tool's own bundles with the runner's bookkeeping
filtered out; `worded(bundles)` is the text they carry; and `faulted(landed)`
reports whether the CALL failed — not whether the answer happens to mention a
failure.

## Whose name a tool writes in

The bundles a tool returns are stamped with whoever wrote the call, read from
the call's `created.by` provenance stamp — not with the process that ran it. So
authorization is decided about the caller. A graph whose vocabulary does not
declare `created` records no such stamp, and the tool then runs without an
identity.

## A check is a tool whose verb is `check`

There is no registry of health checks and no package that owns them. A check is
simply a tool declared with the verb `check`, and the set of checks is whatever
the loaded vocabulary declares:

```ts
import { ailing, checked, checks } from '@yaks/tools'

checks(host.tools) // every `*_check` tool this server loaded
```

A check lives in the package whose invariant it checks. Load
[@yaks/mail](../mail) and a letter that arrived with no sender gets reported;
load [@yaks/sqlite](../sqlite) and the database file's own keys do. Remove the
plugin and its checks go with it, so no list of checks can fall out of date.

`checked(call, about, found)` builds what a check returns: the text on
`content{body}`, `output{source}` naming the call, and `error{code}` carrying
the worst level found — `fail` for a measured violation, `warn` for a leak or
for a verdict the check could not establish. Reporting faults is not itself a
failure, so a check that finds a broken graph still succeeded; `ailing(answer)`
reads that verdict, the way `faulted(landed)` reads whether the call itself
failed.

Two rules carried over from the fleet doctor this replaces: a check that finds
nothing still returns an answer (silence is indistinguishable from a check that
never ran), and a check that cannot run reports `warn` rather than passing
quietly.

## At most once, and what a crash leaves behind

`execution{state}` is the claim. The runner writes `running` with a precondition
that the column was previously absent, so a second server loses the race instead
of running the tool twice, and writes `done` or `failed` when the result is
applied. A call left `running` by a process that died has no result, so the same
rules still select it, and `reconcile(runner)` at boot runs it again, this time
claiming over the stale `running`. That boot sweep is one pass of the rules' own
queries — there is no separate recovery query.

`execution.by` records which process holds the claim, and a runner leaves
another process's claim alone — a transcript imported from elsewhere arrives
with every call already executed. The exception is a holder that has finished: a
process writes its `exit` row in the last transaction it will ever write, so a
call it left `running` belongs to nobody and any sweep may take it. That is what
makes a crash recoverable now that a restarted process is a new entity rather
than a reused name.

There is no exactly-once guarantee. A process can fail after a tool's external
effect succeeded but before its result is committed. `run()` on a call that is
already claimed throws `UnfinishedCall` rather than repeating it, and the boot
pass gives it one more attempt.

A tool that throws produces an `error{code}` bundle (from `CallError`, an
expected refusal) or a bare `exception` bundle (a defect, which is also passed
to the runner's `report` callback), with the message as `content{body}` and
`output{source}` naming the call — plus a result entity, so whoever is waiting
always gets something back.

## Scheduling

Importing this package starts no polling loop and registers no hook. A server
that wants calls it is not itself awaiting — one another process wrote, or one
whose wake has now fired — registers the two rules as effects
([@yaks/effects](../effects) `on`), one registration each. That is the whole of
the asynchronous case. `reconcile(runner)` at boot finishes what a crash left
claimed by running the same queries once.

A call with `wake{at}` is a single invocation, deferred: it runs once its
`fired` stamp is written. A call with `wake{every}` is a recurring schedule, and
it is never executed itself. Each firing writes a new call entity, whose id is
derived from the schedule entity and the instant it fired, carrying
`call{to, args, source}` with `source` naming the schedule — and that new call
is what runs. So a completed call is never re-run, two firings produce two
results, and the same instant twice produces the same call id.

Keep one scheduling owner per graph. [@yaks/session](../session)'s daemon runs
its own transcript's calls in order through `run()`, and registers no effects of
its own.

## What replaced the tool-call log

The server used to keep a separate table beside the graph — one row per call
with the tool's name, who called it, how many milliseconds it took and whether
it worked — served over HTTP at `/telemetry`. Every column of that table is now
a component in the graph, so the log is a query and the table is gone
(`@yaks/telemetry`, retired):

| the log recorded | where it is now                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| which tool       | `call.to` → the `tool{name}` it points at                                                                   |
| who called it    | `created.by` on the call                                                                                    |
| how long         | `result.ms`                                                                                                 |
| did it work      | `execution.state` — `done` or `failed`                                                                      |
| what went wrong  | the `error{code}` or `exception` whose `output.source` is the call, with the message on its `content{body}` |
| when             | `created.at`                                                                                                |

```
.result                       # every call that finished, newest first
.exception                    # only the ones that threw
.call .execution.state=failed # the calls behind them
```

A failure is now queryable next to the work it was about, recorded in the
journal, and pushed to whatever is subscribed — none of which a separate table
could do. Two properties of the old log were deliberately not carried over. It
recorded which transport a call arrived over (MCP, HTTP, the CLI), which would
be a column on `call` if anyone wants it rather than a second log. And it was
written outside the transaction, so it survived a graph that could not be
written to — a property only something outside the graph can have.
