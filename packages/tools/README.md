# @yaks/tools

A tool is a function from BUNDLES to BUNDLES. A CALL is the record of having
asked one. This package runs the function and keeps the record.

```ts
let tool = (bundles, ctx) => [{
  entity: { eid: '$said' },
  content: { body: `hello ${ctx.args.name}` },
  output: { source: ctx.call },
}]
```

What it is handed is the call's own bundle and whatever the caller attached to
it; what it answers is the bundles that ARE the answer — entities it found,
entities it wants made, prose as `content{body}`. Its arguments ride on the
context, parsed out of `call.args` and checked against the declaration. It never
writes: the runner lands what it answered, signed as whoever wrote the call.

## Vocabulary

`toolsDoc` declares:

- `tool{name, description}`: a registered tool's graph identity — what a call
  points at. `toolEid(name)` derives it, so the rows are the same rows every
  time a host writes them.
- `call{to, args, id?, source?}`: a tool and its arguments as JSON. `id` is an
  optional transport correlation id; `source` is optional provenance.
- `execution{state}`: `running` while the runner holds the call, `done` or
  `failed` when the answer lands.
- `result{call, ms}`: what answered a call, and how long it took. It carries a
  `content{body}` copy of the answer's prose, so a transcript reads one line per
  answer.
- `content{body}`, `output{source}`, `error{code}` and `exception`: prose, what
  produced it, and diagnostics.

`callDoc` omits `tool`, and `toolDoc` contains only `tool`, for applications
that compose existing vocabularies. Import `@yaks/tools/vocab` when only
declarations are needed; it loads no runner and no JSON Schema validator.

## The rules

Two rules the vocabulary declares, in the ordinary query grammar, name the calls
that still want running:

```
call_ready  $call .call, !results, !wake;         +result.call=$call
call_woken  $call .call, .wake, .fired, !results; +result.call=$call
```

A call with no result and no wake is due now; one wearing a wake is due once it
has fired. In a graph that knows no wakes the first clause says nothing and the
second rule is inert — one text, right in both.

The result entity is the rule's own emit, so its id is DERIVED from the firing:
answering the same call twice patches one entity instead of making two.

These rules are not machinery this package hides. They are what a host
REGISTERS, one effect each, when it wants the calls nobody is waiting on:

```ts
for (let rule of r.rules) fx.on(rule.plan, (e) => r.run(e.entity.eid))
```

## Run it

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

`call()` writes the call — the transcript comes first, because what was asked
stands whether or not an answer ever does — then runs the function here, for
this caller, and lands what it answered beside a result. `run(call)` runs one
that is already in the graph; `drive()` runs every call the rules select, which
is what a boot sweep is; `answerOf(landed)` is the answer without the runner's
bookkeeping, `worded(bundles)` is the prose it carries, and `faulted(landed)` is
whether the CALL failed — not whether the answer mentions a failure.

## Who a tool writes as

Whoever wrote the call, read off the call's `created.by` provenance stamp — not
the process running it. So a tool's writes are decided about the person asking,
and a ledger's vocabulary has to declare `created` for the actor to reach one.

## At most once, and what a crash leaves

`execution{state}` is the claim: `running` under a `$was` that the column was
absent, so a second host loses the race rather than running the tool twice, and
`done` or `failed` when the answer lands. A call left `running` by a process
that died has no result, so the same rule still selects it — `reconcile(runner)`
at boot re-drives it, claiming over `running` this time. That is the whole
sweep: one query, the rule's own.

There is no exactly-once. A process can fail after an external action succeeded
and before its result commits; `run()` on a claimed call throws `UnfinishedCall`
rather than repeating it, and the boot pass gives it one more attempt.

A tool that throws lands an `error{code}` (a `CallError`, which is an expected
refusal) or a bare `exception` (a defect, also reported), with the prose as
`content{body}` and `output{source}` naming the call — and a result beside it,
so whoever is waiting always hears something.

## Scheduling

Importing this package starts no observer and registers no hook. A host that
wants the calls nobody here is waiting on — one another process wrote, one
wearing a wake that has now fired — registers the two rules as effects
(@yaks/effects `on`), one registration each, and that is the whole of the
asynchronous case. `reconcile(runner)` at boot finishes what a crash left
claimed, by asking the same queries once.

A call wearing `wake{at}` alone is one invocation, waiting: it runs where it
stands once its `fired` stamp is there. A call wearing `wake{every}` is a
STANDING ask, and it is never answered itself — each firing writes its own call,
derived from the schedule and the instant it went off (`call{to, args, source}`,
the source naming the schedule), and that one runs. So a result is never re-run,
two firings are two results, and the same instant twice is the same call.

Keep a single scheduling owner per graph. `@yaks/session`'s daemon drives its
own transcript's calls in order, through `run()`, and registers nothing.
