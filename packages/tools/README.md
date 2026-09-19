# @yaks/tools

A tool is a function from BUNDLES to BUNDLES. A CALL is an entity. This package
is the runner between them — and it is the only thing anywhere that calls a tool
function.

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

The work is found by two rules the vocabulary declares, in the ordinary query
grammar, under the `effect` phase — so `apply()` never runs them and the runner
asks them after the commit, because a tool may take a minute and a transaction
may not:

```
call_ready    $call .call, results=; +result.call=$call
call_waiting  $call .call, .wake, .fired=
```

The first says what a call with no answer is and what to attach to it; the
second holds back a call whose wake has not fired, and is INERT in a graph that
knows no wakes. Nothing wires a tool to the `call` and `result` components: the
rule is the wiring.

The result entity is `call_ready`'s own emit, so its id is DERIVED from the
firing — answering the same call twice patches one entity instead of making two.

## Run it

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { runner, toolEid, toolsDoc } from '@yaks/tools'

let vocab = loadVocab([toolsDoc, mine])
let g = graph({ vocab, storage: ram(vocab) })
let r = runner(g, { tools: [echo] })
g.use(r.plugin)
await r.ensure()

let answer = await r.call([{
  entity: { eid: '$call' },
  call: { to: toolEid('text_echo'), args: '{"text":"hello"}' },
  $actor: { by: me },
}])
```

`call()` writes the call and answers what answered it. `run(call)` runs one that
is already in the graph; `drive()` runs every call the rules select, which is
what the effect does on a batch that wrote one; `answerOf(landed)` is the answer
without the runner's bookkeeping, and `worded(bundles)` is the prose it carries.

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

The host decides when a call is eligible; importing this package starts no
observer. Registering the runner's plugin on a graph is what wakes it, and it
wakes only on a batch that wrote a call. Keep a single scheduling owner per
graph: `@yaks/session`'s daemon drives its own transcript's calls in order and
calls `run()` directly rather than registering the plugin.
