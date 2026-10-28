# @yaks/effects

Runs application code after [graph](../graph/README.md#data-model) changes
commit, with isolated failures, an optional pool for persisted runs, and leases
for work held by one process. Use it to send mail, update an index, or call an
external API without making that work part of the transaction that triggered it.

An **effect** is work declared in a [vocabulary](../vocab/README.md#vocabulary)
with `effect: true`, such as
`send_receipt: { effect: true, changed: ['order.paid'] }`. Every process loading
that vocabulary knows what a commit owes. A **handler** is the function
registered to do that work (`Handler`).

An **observer** is a handler registered at runtime with `created`, `changed`,
`removed`, or `on`. Only its own process knows it; it runs after that process's
commits, at most once. A view refreshing what it shows is an observer.

The **registry** is the [plugin](../graph/README.md#data-model) returned by
`effects(vocab)`, holding effect declarations and observer registrations
(`Effects`). The optional **pool** stores runs as `effect`
[components](../graph/README.md#data-model), so processes can claim and run work
another process committed. A **run** is one invocation owed to an effect for a
target entity; its pool component records its state and attempts.

## Declare an effect and handle it

These introductory examples use the small [post vocabularies](./testing.ts):
`announceExample` declares `post` (`title`, `published`) and `post_announce`
(`created: ['post']`, `changed: ['post.published']`); `observerExample` declares
only `post.published`. Load these declarations with `loadVocab` in an
application.

Without the `effect` component, a handled effect runs in the process that
committed. A handler failure goes to `report` and cannot roll back the committed
[batch](../graph/README.md#data-model).

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
const vocab = loadVocab({
  $defs: {
    post: { component: true },
    post_announce: {
      effect: true,
      created: ['post'],
      description: 'tell subscribers about a post',
    },
  },
})
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let announced: string[] = []
fx.handle({ post_announce: (event) => announced.push(event.kind) })

await g.apply([{ entity: { eid: 'p1' }, post: {} }])
equal(announced, ['created'])
```

`handle` throws for a name the vocabulary does not declare. Registrations can be
added before or after graph construction.

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## Exports

| Import                | Exports                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/effects`       | `effects`; registry, handler, registration and event types; `before`, `wanting`, `events`, `strip`, `BEFORE`; `generation`, `marked`, `unmark`, `ORIGIN`, `Write`; `pool`, `working`, `effectDoc`, pool types and retry settings; lease operations and types; `expire`, `expireDaily`, `expiration`; `PROVISIONAL`, `provisionalDoc`; `WORKER` and the `Worker` it says |
| `@yaks/effects/vocab` | `docs`, `description`, `effectDoc`, `provisionalDoc`                                                                                                                                                                                                                                                                                                                    |
| `@yaks/effects/tools` | `runs`, `Options`: implementation and configuration of `effect_check`                                                                                                                                                                                                                                                                                                   |
| `@yaks/effects/views` | `destinations`, `inspectViews`, `icons`: the Effects page a browsing app offers                                                                                                                                                                                                                                                                                         |

`effectDoc` declares `effect`, `lease`, `worker`, `provisional`, and
`effect_check`. `docs` contains `effectDoc`; loading it alone does not install a
registry or work the pool. `provisionalDoc` declares only `provisional`; load
one document or the other.

## Observers and events

An **event** describes what triggered a handler (`Event`), with `kind`,
`entity`, and the component's `name`. The registry reads what each entity
carries before applying bundles, including entities a cascade will delete, and
derives events from the applied [patches](../graph/README.md#data-model).

| Observer                       | Effect declaration       | Trigger                                                  |
| ------------------------------ | ------------------------ | -------------------------------------------------------- |
| `created(comp, handler)`       | `created: [comp]`        | An entity gains the component                            |
| `changed(comp, prop, handler)` | `changed: ['comp.prop']` | An applied patch includes that property                  |
| `changed(comp, handler)`       | `changed: [comp]`        | An applied patch updates that component                  |
| `removed(comp, handler)`       | `removed: [comp]`        | The component is removed, directly or by entity deletion |
| `on(pattern, handler)`         | `match: pattern`         | A pattern matches an entity touched by the batch         |

A `changed` event describes the applied patch, not a comparison of old and new
values. `comp` holds the component on creation, the applied properties on
change, and is absent on removal. A removal carries `before` instead: the entity
holding the component that went, as it was before the commit, and nothing else
it lost. A handler that needs what a deleted link pointed at watches `edge`
going, narrowed by a `target`, and reads `before.edge`. `touched` lists every
component the same commit moved on that entity, including removals. A pooled run
keeps both, so a removal's row is never larger than the component it is about.

```ts
import { graph } from '@yaks/graph'
import { observerExample as vocab } from './testing.ts'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let seen: unknown[] = []
fx.on('post', {
  doc: 'refresh the post view',
  created: (e) => seen.push([e.kind, e.comp]),
  changed: { published: (e) => seen.push([e.kind, e.comp]) },
  removed: (e) => seen.push([e.kind, e.before?.post]),
})
await g.apply([{ entity: { eid: 'p1' }, post: {} }])
await g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
await g.apply([{ entity: { eid: 'p1' }, $delete: true }])
equal(seen, [
  ['created', {}],
  ['changed', { published: true }],
  ['removed', { published: true }],
])
equal(fx.docs(), [{
  comp: 'post',
  hooks: ['created', 'changed(published)', 'removed'],
  doc: 'refresh the post view',
}])
equal(fx.slots().length, 3)
```

`on(comp, registration)` groups related observers and their documentation.
`slots()` returns registrations, effects first; `docs()` derives grouped
observer documentation from them. A registration's `wants` supplies additional
reads for the graph to gather before commit.

Every handler receives `(event, tx, write)`: the event, a `ReadTx` for reading
committed state, and a callback for new graph writes when configured. A pooled
handler also receives its attempt as a fourth argument. The pool accepts the
graph's `Access` interface, including `outside` for detached reads, so the graph
may be owned by another thread.

### Patterns

An observer's [pattern](../query/README.md#multi-entity-matches) is evaluated
against the committed graph to find handler targets. It is checked only when a
batch moves a component it reads. A match triggers a handler only if the batch
touched an entity that the pattern bound. An entity that already matched can
trigger again when touched; this is not a false-to-true transition test.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
const vocab = loadVocab({
  $defs: {
    post: { component: true, properties: { published: { type: 'boolean' } } },
  },
})
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let matched: string[] = []
fx.on('.post !post.published', (e) => matched.push(e.entity.eid))
await g.apply([
  { entity: { eid: 'p1' }, post: {} },
  { entity: { eid: 'p2' }, post: { published: true } },
])
equal(matched, ['p1'])
```

A lone `-post` registers the same event as `removed('post', handler)`, including
cascaded deletions. Mixed patterns such as `.product, -shelf` need a storage
adapter that can query the batch's removal overlay. Queries joining multiple
entities need `bindings`, as provided by [@yaks/sqlite](../sqlite/README.md) and
[@yaks/durable-object](../durable-object/README.md). Matched events can carry
`vars` and `binding` for these results.

Required components absent from the vocabulary make a pattern inactive. An
absence condition on an undeclared component is dropped. Unsupported observer
pattern execution is reported after commit. Pool match evaluation happens in the
commit transaction. An observer is never replayed after a crash. An effect's
`match` is recorded with the commit when a pool is present.

### Event derivation helpers

`before(vocab)` reads what the batch's entities carry, which `events` needs;
`wanting` declares those reads for graph gathering. `strip` removes the
temporary `$before` request from the applied bundles.

```ts
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { before, events, strip } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({ $defs: { post: { component: true } } })
let storage = ram(vocab)
let g = graph({ storage, vocab })
await g.apply([{ entity: { eid: 'p1' }, post: {} }])
let bundles: Bundle[] = [{ entity: { eid: 'p1' }, post: null }]
await storage.tx(async (tx) => {
  let prepared = await before(vocab)(bundles, tx)
  equal(events(prepared).map((e) => [e.kind, e.name, e.touched]), [
    ['removed', 'post', ['post']],
  ])
  equal(strip(prepared), bundles)
})
```

## Failure isolation

Refused batches trigger no handlers. After commit, thrown errors and rejected
promises go to `report` while other handlers continue. The default reporter uses
`console.warn`. Synchronous handlers preserve a synchronous `apply()` result;
returning a promise makes that call asynchronous. Work started without returning
its promise must handle its own later failures.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({ $defs: { post: { component: true } } })
let reported: string[] = []
let seen: string[] = []
let fx = effects(vocab, {
  report: (error, { handler }) => reported.push(`${handler}: ${error}`),
})
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
fx.created('post', () => {
  throw new Error('mail unavailable')
})
fx.created('post', (e) => seen.push(e.entity.eid))
await g.apply([{ entity: { eid: 'p1' }, post: {} }])
equal(reported, ['post.created: Error: mail unavailable'])
equal(seen, ['p1'])
equal((await g.get(['p1']))[0].post, {})
```

## Writing back

Configure `write` to apply a new batch through the graph. Return its result when
callers should await it. Use `{ trusted: true }` if the handler writes
server-owned properties. The new batch receives the graph's admission, rules,
stamps, journal and notifications; direct storage writes bypass that pipeline.

A **generation** counts how many handler writes preceded a batch: zero for an
initial write, one for its handler's write, and one more for each further
handler write. The `$effect` request carries it. Batches past `depth` (default
2) still commit but trigger no more handlers; `depth: 0` disables handlers for
all handler writes.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects, generation, marked, unmark } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    post: { component: true, properties: { count: { type: 'number' } } },
  },
})
let fx = effects(vocab, { depth: 0, write: (b) => g.apply(b) })
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let calls = 0
fx.changed('post', 'count', (e, _tx, write) => {
  calls++
  return write([{
    entity: e.entity,
    post: { count: Number(e.comp?.count) + 1 },
  }])
})
await g.apply([{ entity: { eid: 'p1' }, post: { count: 0 } }])
await g.apply([{ entity: { eid: 'p1' }, post: { count: 1 } }])
equal(calls, 1)
equal((await g.get(['p1']))[0].post, { count: 2 })
let bundles = [{ entity: { eid: 'p1' }, post: { count: 3 } }]
let tagged = marked(bundles, 1)
equal(generation(tagged), 1)
equal(generation(bundles), 0)
equal(unmark(tagged), bundles)
```

<a id="the-durable-tier-optional"></a>

## The pool (optional)

Load `effectDoc` beside your own vocabulary to record runs in the same
transaction as the batch that owes them. By default a process owes runs only for
the effects it handles (`owes: 'handled'`), so a declared effect without a
handler owes no run there; a process that writes for another to run passes
`owes: 'declared'` and owes a run for every declared effect. A crash after
commit cannot lose the recorded run. `work(g)` claims due runs and continues
until none can start; `work(g, signal)` with a live signal keeps working until
the signal aborts.

The first pass and every later pass use the same indexed selection of recorded
runs. A worker joining or replacing another worker resumes this queue; it does
not scan application entities to discover targets. The write that creates work
records its run in the same transaction, and unfinished runs remain available
after a process stops.

A run is the pool's bookkeeping rather than anyone's data, so `effect` is
declared `journal: false` ([@yaks/vocab](../vocab/README.md#the-format)): a
[journal](../journal/README.md) records nothing of a run, from the commit that
owes it to its deletion once done.

A **claim** assigns a run to one worker until an expiry, using the run's
`lease_owner`, `lease_token`, and `lease_expiry` properties. Claims use graph
[preconditions](../graph/README.md#writes-and-reads), so rival workers cannot
claim the same run together. Workers renew their claims; expired claims are
available again, or available immediately when `gone` reports that the worker
ended.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    order: { component: true },
    send_receipt: { effect: true, created: ['order'] },
  },
}])
let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let receipts: string[] = []
fx.handle({ send_receipt: (e) => receipts.push(e.entity.eid) })
await g.apply([{ entity: { eid: 'o1' }, order: {} }])
equal(receipts, [])
equal((await g.read('.effect'))[0].effect?.state, 'pending')
await fx.work(g)
equal(receipts, ['o1'])
equal(await g.read('.effect'), [])
await fx.stop()
equal(fx.running(), [])
```

A worker joining the pool claims runs its own commits owe and starts them after
commit. `defer: true` leaves those runs for `work`; `max` limits simultaneous
handlers (`MAX`, 64, unless told), so a backlog starts a slot at a time, and a
run ending while every slot is taken wakes the worker to fill it. Other
processes' runs are heard as they land when the host gives `watch`, a
subscription calling back on each new `effect` row (@yaks/sqlite's
`Store.watch`, about 5 ms behind the other process's commit); without it they
are picked up on the next pass, at most a second (`CAP`) away. `wake` starts
that pass sooner. `nudge` notifies the host once after a commit owes declared
work, whether claimed here or left pending. A host can keep its `work` promise
alive through handler completion and wake another worker to drain the remaining
runs.

Each pass examines a bounded page of candidate runs, 32 by default, read for
every handler at once. A candidate starts only when it is due, claimable and has
a local slot. Selection shares turns among handled and explicitly disabled
effects, so one handler's backlog does not crowd out the others: where the page
comes back full, a handler it holds no run of reads a window of its own on its
turn. Disabled runs settle without spending attempts. The page bounds candidate
reads; `max` separately limits concurrent handlers.

`pool(ctx, options)` exposes the same operations for a caller supplying registry
slots, a writer, and a reporter.

A worker with an `owner` entity and handlers for every enabled effect holds a
presence lease while its live `work` runs. `working(g)` checks these leases. A
one-shot `work` leaves the pool to a worker with a presence lease. A worker
handling only some effects holds no presence lease. Signal abort or `stop` stops
further claims; `idle` and `stop` wait for started runs while renewing their
claims. Abort the live `work` signal to end its loop.

### What a worker says

A worker with an `owner` entity says what it is doing while its live `work`
runs, about once a second, as a `worker` component on that entity:
`worker{at, running, runs, ran, errors, history, cpu, lag}`. `running` counts
its runs going and `runs` lists the oldest twenty, each with its handler, target
and when it started; `ran` and `errors` count the runs it finished since it
started and how many of those threw; `history` holds how many it finished in
each of the last sixty whole seconds, oldest first. How busy it is holds however
many runs it takes at once: `cpu` is the share of a core its process used since
it last said (from the `cpu` option, the process's CPU time in ms; absent
without one), and `lag` the most its thread ran a timer late, in ms, which
climbs as its event loop fills. A row whose `at` stops moving is a worker that
stopped saying; a worker leaving the pool removes its row.

### Single-owner stores

**Single-owner mode** means exactly one process exclusively owns the store,
including its effect execution. Set `singleOwner: true` only for such a store,
for example a Durable Object. Shared box workers leave this option unset.

`work` drains recorded runs without claims or presence leases. By default it
owes no start-up effects and runs no expiration duty. A host calls `work` on
writes and alarms, not on reads; it calls `startup` when a deployment owes
start-up runs. Attempts are persisted before handler invocation and outcomes
afterwards, so crash recovery, retry backoff, attempt limits and non-idempotent
interruption handling still apply. `max`, `defer`, and `Attempt.progressed` keep
their meaning. Overlapping calls to `work` on the same registry share its
running set.

To owe and deliver start-up runs together, call
`work(g, undefined, {startup: true, passes: 1})`. A run given a free slot starts
at once and keeps no row unless it fails: the host owes the pass again until it
has ended, which is the run's crash recovery, and a failure is written as the
row its retry reads. Overflow is recorded pending for a later pass. Start-up
admission shares the first pass's bounded window. `startup(g)` records runs
without invoking handlers. A numeric third argument to `work` still bounds its
queue passes.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    store: { component: true },
    order: { component: true },
    send_receipt: { effect: true, created: ['order'] },
    prepare: { effect: true, start: true },
  },
}])
let fx = effects(vocab, { singleOwner: true, defer: true, owner: 'store-1' })
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let sent = 0, prepared = 0
fx.handle({
  send_receipt: () => void sent++,
  prepare: () => void prepared++,
})
await g.apply([
  { entity: { eid: 'store-1' }, store: {} },
  { entity: { eid: 'order-1' }, order: {} },
])
await fx.startup(g) // The host's deployment pass owes these runs.
equal(prepared, 0)
await fx.work(g)
equal(sent, 1)
equal(prepared, 1)
await fx.work(g) // An empty alarm owes nothing and writes nothing.
equal(sent, 1)
equal(prepared, 1)
equal(await g.read('.lease'), [])
await fx.work(g, undefined, { startup: true, passes: 1 })
equal(prepared, 2)
equal(sent, 1)
```

### Attempts and retries

An **attempt** is one start of a pooled handler (`Attempt`). A failure is due
again after a backoff: one second, doubling, capped at five minutes. After
`tries` attempts (default three) the run stays `failed` with its error. An error
carrying `retry: { after: milliseconds }` delays the next attempt by at least
that amount and is reported only on its last attempt.

`attempt.last()` says whether a failure would be final. `progressed()` resets
its attempt count after progress, giving a subsequent failure its full retry
allowance. `attempt.retry(body)` retries a local completion while keeping the
claim, so the handler need not repeat its external work.

A pooled handler waiting for a dependency calls `await attempt.defer(delayMs)`
and returns normally. The positive, finite delay leaves the same run pending
until it is due again, releases its claim and slot, and spends no retry attempt.
It is waiting work, so no failure is reported. The next invocation comes through
the pool's ordinary queue selection.

The complete waiting and retry lifecycle is covered by the
[deferral tests](./defer_test.ts).

```ts ignore
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects } from '@yaks/effects'
import { clock, equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    order: { component: true },
    send_receipt: { effect: true, created: ['order'] },
  },
}])
let time = clock(), calls = 0
let fx = effects(vocab, { clock: time })
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
fx.handle({
  send_receipt: async (_event, _tx, _write, attempt) => {
    if (++calls == 1) {
      await attempt!.defer!(1000)
      return
    }
  },
})
await g.apply([{ entity: { eid: 'order-1' }, order: {} }])
await fx.work(g, undefined, 1)
await time.advance(999)
await fx.work(g, undefined, 1)
equal(calls, 1)
await time.advance(1)
await fx.work(g, undefined, 1)
equal(calls, 2)
equal(await g.read('.effect'), [])
await fx.stop()
```

Failures follow the declaration's attempt limit and backoff:

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects } from '@yaks/effects'
import { clock, equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    order: { component: true },
    send_receipt: { effect: true, created: ['order'], tries: 2 },
  },
}])
let time = clock()
let reports: string[] = []
let fx = effects(vocab, {
  clock: time,
  report: (_e, job) => reports.push(job.handler),
})
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let last: boolean[] = []
fx.handle({
  send_receipt: (_e, _tx, _write, attempt) => {
    last.push(attempt!.last())
    throw new Error('mail unavailable')
  },
})
await g.apply([{ entity: { eid: 'o1' }, order: {} }])
await fx.work(g, undefined, 1)
equal(last, [false])
await time.advance(1000)
await fx.work(g, undefined, 1)
equal(last, [false, true])
equal((await g.read('.effect'))[0].effect?.state, 'failed')
equal(reports, ['send_receipt', 'send_receipt'])
await fx.stop()
```

For a completion with several local steps, retain external work and retry only
the step that failed:

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    order: { component: true },
    send_receipt: { effect: true, created: ['order'], tries: 2 },
  },
}])
let fx = effects(vocab, { backoff: () => 0, report: () => {} })
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let sent = 0
let saved = 0
let last: boolean[] = []
fx.handle({
  send_receipt: async (_e, _tx, _write, attempt) => {
    sent++
    await attempt!.retry!(async () => {
      last.push(attempt!.last())
      if (++saved == 1) throw new Error('storage unavailable')
    })
    await attempt!.progressed()
    last.push(attempt!.last())
  },
})
await g.apply([{ entity: { eid: 'o1' }, order: {} }])
await fx.work(g)
equal(sent, 1)
equal(saved, 2)
equal(last, [false, true, false])
equal(await g.read('.effect'), [])
await fx.stop()
```

An interrupted run is tried again unless its declaration says
`idempotent: false`; then it is left failed because replay could repeat an
external action. A pooled run rebuilds its event from the target's current
state, so a handler needing a historical value must store it itself.

### Startup and active effects

`start: true` owes each joining shared worker one `started` run, targeting its
`owner`. `startup: 'manual'` leaves that timing to the host; it is the default
with `singleOwner: true`. `startup: 'join'` chooses joining explicitly. Each
`fx.startup(g)` call persists a fresh run for every handled start-up effect,
without joining or executing handlers. A persistence failure rejects the call;
after it succeeds, `work` executes those runs with ordinary attempts and
retries. The host keeps track of which deployments owe the call. Without the
`effect` component, `startup` awaits the handled start-up effects inline. A
handler failure is reported and rejects the call, so the host can retry the
start-up work.

Commit-triggered runs can be gated with `active`, a query that must match an
entity. A `target` query limits triggers to subjects matching before or after
the write, including removals, moves out of scope and what a cascade deletes. An
`option` names the declaring plugin's boolean opt-in; the composing host passes
disabled names to the registry so every writer agrees with its workers. Writes
to pool entities owe no effects, preventing pool bookkeeping from producing more
runs.

Startup delivery and active gates are exercised in the
[startup tests](./startup_test.ts) and [declaration tests](./registry_test.ts).

```ts ignore
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    enabled: { component: true },
    order: { component: true },
    send_receipt: {
      effect: true,
      created: ['order'],
      active: '.enabled',
    },
    prepare: { effect: true, start: true },
  },
}])
let fx = effects(vocab, { owner: 'w1', startup: 'manual' })
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let seen: string[] = []
fx.handle({
  send_receipt: (e) => seen.push(`receipt:${e.entity.eid}`),
  prepare: (e) => seen.push(`${e.kind}:${e.entity.eid}`),
})
await g.apply([{ entity: { eid: 'w1' }, worker: {}, enabled: {} }])
await g.apply([{ entity: { eid: 'o1' }, order: {} }])
equal((await g.read('.effect'))[0].effect?.state, 'pending')
await fx.startup(g)
await fx.work(g, undefined, 1)
equal(seen.sort(), ['receipt:o1', 'started:w1'])
equal(await g.read('.effect'), [])
await fx.stop()
```

### Settling stale runs

`fx.settle(g, handler)` completes unclaimed pending runs that the current
configuration disables or the declaration no longer owes. It uses guarded
successful-run cleanup, leaving failures, active claims and needed runs intact.
Workers also settle unclaimed runs for explicitly disabled names, including runs
an older writer leaves during a rolling restart. A removal's old scope is
unavailable after commit, so its run is preserved unless the effect is disabled.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    post: { component: true },
    publish: { effect: true, created: ['post'] },
  },
}])
let fx = effects(vocab, { disabled: ['publish'], owes: 'declared' })
let g = graph({ vocab, storage: ram(vocab), plugins: [fx] })
await g.apply([{ entity: { eid: 'p1' }, post: {} }])
equal(await g.read('.effect'), [])
await g.apply([{
  entity: { eid: 'old-run' },
  effect: {
    handler: 'publish',
    target: 'p1',
    comp: 'post',
    kind: 'created',
    state: 'pending',
  },
}], { trusted: true })
equal(await fx.settle(g, 'publish'), 1)
equal(await fx.settle(g, 'publish'), 0)
```

## Duties and leases

## Expiration

A component's [`expire` declaration](../vocab/README.md#expiration) selects
component rows to remove. The CLI's effects role serves expiration as a separate
upkeep duty named `@yaks/effects`, alongside the effect pool. The pool's startup
and work selection do not invoke it.

`expiration(g, {owner, signal, report})` keeps that duty running until its
signal aborts. It checks the persisted daily lease through `expireDaily`, with a
30-second cadence when leases are available. A successful pass keeps the
`@yaks/effects/expire` lease for a day; failure or interruption leaves a short
hold for recovery. Replacing a worker preserves that daily schedule, and a
failure is reported before the duty tries again.

`expire(g)` runs a pass explicitly and returns the number of matching component
rows removed and tombstones pruned. Each transaction removes at most 100 rows by
default, and before the next one the pass rests as long as the last held the
write lock, so other writers waiting on the file get in between. Removal uses
the graph's `apply()` with guards against values changed since selection, and as
an expiring write (`expiring: true`), so its reference consequences, tombstones,
journal and subscribers follow the ordinary write path and a removed body's
bytes go (@yaks/blob). The graph removes owners left with only provenance
stamps. Successful effect runs are deleted when they settle. Failed runs stay
readable until a person removes them.

Then the pass prunes tombstones laid more than `TOMBSTONES` (30 days) ago: a
tombstone swallows a write that raced its delete, and none arrives that late. It
walks the store's graves (`g.outside.buried`) a page at a time and prunes each
page with `$prune`, which erases an identity only while nothing names it, so a
tombstone the journal or a `keep` reference still names stays. A page refused
because something reached a grave meanwhile waits for the next pass; a store
that keeps no deletion time has no graves.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { expire } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    cache: {
      component: true,
      expire: '.cache.old=true',
      properties: { old: { type: 'boolean' } },
    },
    item: { component: true },
  },
})
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([{ entity: { eid: 'one' }, cache: { old: true }, item: {} }])
equal(await expire(g, { batch: 10 }), 1)
equal((await g.get(['one']))[0].item, {})
equal(await expire(g), 0)
```

A **duty** is named work that one process should run at a time. A **lease** is
the `lease: { name, holder, until }` component recording who holds a duty and
when the hold expires. `leaseEid(name)` derives its eid from the duty name. The
holder is an entity reference and must name an existing entity.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, held, take } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([
  { entity: { eid: 'w1' }, worker: {} },
])
equal(await take(g, 'refresh-index', { holder: 'w1' }), true)
equal((await held(g, 'refresh-index'))?.holder, 'w1')
```

`take` uses preconditions on holder and expiry, and taking your own lease renews
it. `drop` releases only your own lease. `released(g, holder)` returns release
patches to apply with the batch recording that holder's ending. The default hold
lasts 30 seconds; `gone` permits immediate takeover of a lease whose holder
ended.

`holding` takes a lease, renews it while its callback runs, and releases it when
the callback finishes. Its callback signal also aborts when renewal finds
another holder; the callback must honor that signal. Renewals use timers, so the
callback must yield more often than a third of the hold. After losing the lease,
`holding` waits to take it again and returns the callback's last result. A store
failure while waiting is reported (`report`, default `console.error`) and
retried. With no signal, an already aborted signal, or `wait: false`, it makes
one attempt; store failures then throw. `until(signal)` lets finished startup
work keep the lease until shutdown.

Without a `lease` declaration, taking a lease succeeds without storing anything
and provides no coordination between processes.

## Provisional entities

The **provisional** component marks an entity whose write committed before an
asynchronous step finished: `provisional: { note: 'saving the key' }`. The
handler finishing the step removes it. `note` explains the unfinished step to a
reader. The component does not start a handler or clear itself.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { PROVISIONAL, provisionalDoc } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([provisionalDoc, {
  $defs: { post: { component: true } },
}])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([{
  entity: { eid: 'p1' },
  post: {},
  [PROVISIONAL]: { note: 'updating the index' },
}])
equal((await g.get(['p1']))[0].provisional, { note: 'updating the index' })
await g.apply([{ entity: { eid: 'p1' }, [PROVISIONAL]: null }])
equal((await g.get(['p1']))[0].provisional, undefined)
```

## The Effects page

`@yaks/effects/views` offers a browsing app (@yaks/browse) the page its sidebar
lists as Effects, at `/?effects`: how many workers are up, the runs going every
second over the last minute, what is waiting and what failed; a row for each
worker with how busy it is, its loop delay, its runs a second and how long it
has been up, or how long it has been silent; every run going, the longest first;
and every declared effect with the runs it is owed, running, waiting, retrying
and failed, each count a link to those runs. The workers' numbers are their
`worker` rows; the runs owed are the `effect` rows, tallied by handler. Both are
subscriptions, so the page moves as they do.

## Check recorded runs

`runs(host, options)` supplies `effect_check`. The check reports failed runs,
runs waiting for a handler no plugin declares (an orphan, which nothing will
ever work), and runs pending past their due time by more than `minutes` (default
ten), showing up to `sample` examples (default five). It does not retry runs or
repair them. Without an `effect` component it reports no findings.

Those runs are left for a person, and two tools act on them, each taking a
handler name (all its runs of that kind) or one run's id.
`yak effect retry
<of>` puts failed runs of a declared handler back to `pending`
with a fresh attempt allowance, so the pool claims them as it does a new run
(attempts, backoff, leases); if the cause is fixed they finish, if not they fail
again and the check names them again. `yak effect drop <of>` deletes failed runs
and orphans, whose work no one owes any more. Both refuse a name that matches
none and say how many runs they changed.

```ts
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc } from '@yaks/effects/vocab'
import { runs } from '@yaks/effects/tools'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([{
  entity: { eid: 'r1' },
  effect: { state: 'failed', error: 'mail unavailable' },
}], { trusted: true })
let result = await runs({ vocab }).effect_check({
  entity: { eid: 'check1' },
  call: { args: {} },
}, g) as Bundle[]
equal(result[0].finding?.level, 'fail')
```

## Limits and composition

The registry uses TypeScript and standard web APIs and runs in Deno, Node,
Workers, or browsers with compatible graph storage. The pool and leases survive
process restarts only with persistent storage; RAM is suitable for tests.
Pattern features depend on the adapter's query support.

Effects run after commit and cannot refuse a write. Use
[graph rules and hooks](../graph/README.md#data-model) for transactional work.
Without the pool, a crash after commit can lose an effect or observer run. The
pool coordinates claims and retries; handlers remain responsible for the
semantics of repeating their external actions.

`enqueue(graph, handler, target)` owes one invocation explicitly, for a resume
or work left during draining. Ordinary component transitions owe their runs
through declarations. The handler must be declared and the graph must keep a
durable effect pool. A run written this way, or put back to pending by a retry,
wakes this process's worker as its commit lands, since a store's `watch` hears
only other processes.
