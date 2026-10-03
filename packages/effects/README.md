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

Without the `effect` component, a handled effect runs in the process that
committed. A handler failure goes to `report` and cannot roll back the committed
[batch](../graph/README.md#data-model).

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    post: {
      component: true,
      properties: {
        title: { type: 'string' },
        published: { type: 'boolean' },
      },
    },
    post_announce: {
      effect: true,
      created: ['post'],
      changed: ['post.published'],
      description: 'tell subscribers about a post',
    },
  },
})
let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let announced: string[] = []
fx.handle({ post_announce: (event) => announced.push(event.kind) })

await g.apply([{ entity: { eid: 'p1' }, post: { title: 'First post' } }])
await g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
equal(announced, ['created', 'changed'])
```

`handle` throws for a name the vocabulary does not declare. Registrations can be
added before or after graph construction.

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## Exports

| Import                | Exports                                                                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/effects`       | `effects`; registry, handler, registration and event types; `before`, `wanting`, `events`, `strip`, `BEFORE`; `generation`, `marked`, `unmark`, `ORIGIN`, `Write`; `pool`, `working`, `effectDoc`, pool types and retry settings; lease operations and types; `PROVISIONAL`, `provisionalDoc` |
| `@yaks/effects/vocab` | `docs`, `description`, `effectDoc`, `provisionalDoc`                                                                                                                                                                                                                                          |
| `@yaks/effects/tools` | `runs`, `Options`: implementation and configuration of `effect_check`                                                                                                                                                                                                                         |

`effectDoc` declares `effect`, `lease`, `provisional`, and `effect_check`.
`docs` contains `effectDoc`; loading it alone does not install a registry or
work the pool. `provisionalDoc` declares only `provisional`; load one document
or the other.

## Observers and events

An **event** describes what triggered a handler (`Event`), with `kind`,
`entity`, and the component's `name`. The registry reads component presence
before applying bundles, including entities a cascade will delete, and derives
events from the applied [patches](../graph/README.md#data-model).

| Observer                       | Effect declaration       | Trigger                                                  |
| ------------------------------ | ------------------------ | -------------------------------------------------------- |
| `created(comp, handler)`       | `created: [comp]`        | An entity gains the component                            |
| `changed(comp, prop, handler)` | `changed: ['comp.prop']` | An applied patch includes that property                  |
| `changed(comp, handler)`       | `changed: [comp]`        | An applied patch updates that component                  |
| `removed(comp, handler)`       | `removed: [comp]`        | The component is removed, directly or by entity deletion |
| `on(pattern, handler)`         | `match: pattern`         | A pattern matches an entity touched by the batch         |

A `changed` event describes the applied patch, not a comparison of old and new
values. `comp` holds the component on creation, the applied properties on
change, and is absent on removal. `touched` lists every component the same
commit moved on that entity, including removals. A pooled run keeps that list.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    post: { component: true, properties: { published: { type: 'boolean' } } },
  },
})
let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let seen: unknown[] = []
fx.on('post', {
  doc: 'refresh the post view',
  created: (e) => seen.push([e.kind, e.comp]),
  changed: { published: (e) => seen.push([e.kind, e.comp]) },
  removed: (e) => seen.push([e.kind, e.comp]),
})
await g.apply([{ entity: { eid: 'p1' }, post: {} }])
await g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
await g.apply([{ entity: { eid: 'p1' }, $delete: true }])
equal(seen, [
  ['created', {}],
  ['changed', { published: true }],
  ['removed', undefined],
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
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    post: { component: true, properties: { published: { type: 'boolean' } } },
  },
})
let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let matched: string[] = []
let removed: string[] = []
fx.on('.post !post.published', (e) => matched.push(e.entity.eid))
fx.on('-post', (e) => removed.push(e.kind))
await g.apply([{ entity: { eid: 'p1' }, post: {} }])
await g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
await g.apply([{ entity: { eid: 'p1' }, post: null }])
equal(matched, ['p1'])
equal(removed, ['removed'])
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

`before(vocab)` reads the component presence needed by `events`; `wanting`
declares those reads for graph gathering. `strip` removes the temporary
`$before` request from the applied bundles.

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
transaction as the batch that owes them. A crash after commit cannot lose the
recorded run. `work(g)` claims due runs and continues until none can start;
`work(g, signal)` with a live signal keeps working until the signal aborts.

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
equal((await g.read('.effect'))[0].effect?.state, 'done')
await fx.stop()
equal(fx.running(), [])
```

A worker joining the pool claims runs its own commits owe and starts them after
commit. `defer: true` leaves those runs for `work`; `max` limits simultaneous
handlers. Other processes' runs are picked up on the next pass, normally at most
a second away. `wake` starts that pass sooner; `nudge` can notify another worker
after a commit leaves runs unclaimed. `pool(ctx, options)` exposes the same
operations for a caller supplying registry slots, a writer, and a reporter.

A worker with an `owner` entity and handlers for every effect holds a presence
lease while its live `work` runs. `working(g)` checks these leases. A one-shot
`work` leaves the pool to a worker with a presence lease. A worker handling only
some effects holds no presence lease. Signal abort or `stop` stops further
claims; `idle` and `stop` wait for started runs while renewing their claims.
Abort the live `work` signal to end its loop.

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
let now = 0
let reports: string[] = []
let fx = effects(vocab, {
  now: () => now,
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
await fx.work(g)
equal(last, [false])
now = 1000
await fx.work(g)
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
equal((await g.read('.effect'))[0].effect?.state, 'done')
await fx.stop()
```

An interrupted run is tried again unless its declaration says
`idempotent: false`; then it is left failed because replay could repeat an
external action. A pooled run rebuilds its event from the target's current
state, so a handler needing a historical value must store it itself.

### Sweeps, startup, and active effects

A **sweep** is an effect's query selecting targets owed a `created` run when a
worker first joins. It requires a `created` trigger. Each effect-target pair
uses one derived eid, so workers sweeping together owe one run. A sweep can find
work no commit recorded.

`start: true` owes each joining worker one `started` run, targeting its `owner`.
Commit-triggered runs can be gated with `active`, a query that must match an
entity; sweeps use their own query. Writes to pool entities owe no effects,
preventing pool bookkeeping from producing more runs.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effectDoc, effects, working } from '@yaks/effects'
import { equal, until } from '@yaks/testing'

let vocab = loadVocab([effectDoc, {
  $defs: {
    worker: { component: true },
    enabled: { component: true },
    order: { component: true },
    send_receipt: {
      effect: true,
      created: ['order'],
      sweep: '.order',
      active: '.enabled',
    },
    prepare: { effect: true, start: true },
  },
}])
let fx = effects(vocab, { owner: 'w1' })
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
let seen: string[] = []
fx.handle({
  send_receipt: (e) => seen.push(`receipt:${e.entity.eid}`),
  prepare: (e) => seen.push(`${e.kind}:${e.entity.eid}`),
})
await g.apply([
  { entity: { eid: 'w1' }, worker: {} },
  { entity: { eid: 'o1' }, order: {} },
])
equal(await g.read('.effect'), [])
let stopping = new AbortController()
let serving = fx.work(g, stopping.signal)
try {
  await until(() => working(g))
  await fx.idle()
  equal(seen.sort(), ['receipt:o1', 'started:w1'])
} finally {
  stopping.abort()
  await serving
  await fx.stop()
}
equal(await working(g), false)
```

## Duties and leases

## Expiration

A component's [`expire` declaration](../vocab/README.md#expiration) selects
component rows to remove. The effects worker runs one generic sweep of the
composed vocabulary on startup and daily. The expiration duty's lease is shared
by workers; a successful pass leaves it standing for a day, and a failed or
interrupted pass leaves only a short hold for recovery. A worker checks the
lease again while it stays up, so no restart is needed for the next pass.

`expire(g)` runs a pass explicitly and returns the number of matching component
rows removed. Each transaction removes at most 100 rows by default. Removal
uses the graph's `apply()` with guards against values changed since selection,
so its reference consequences, tombstones, journal and subscribers follow the
ordinary write path. The graph removes owners left with only provenance stamps.
The `effect` component expires settled `done` and `failed` runs recorded at
least seven days ago; pending runs are not selected.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { expire } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab({ $defs: {
  cache: { component: true, expire: '.cache.old=true',
    properties: { old: { type: 'boolean' } } },
  item: { component: true },
} })
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
import { drop, effectDoc, held, holding, take, until } from '@yaks/effects'
import { equal } from '@yaks/testing'

let vocab = loadVocab([effectDoc, { $defs: { worker: { component: true } } }])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([
  { entity: { eid: 'w1' }, worker: {} },
  { entity: { eid: 'w2' }, worker: {} },
])
equal(await take(g, 'refresh-index', { holder: 'w1' }), true)
equal(await take(g, 'refresh-index', { holder: 'w2' }), false)
equal((await held(g, 'refresh-index'))?.holder, 'w1')
await drop(g, 'refresh-index', { holder: 'w1' })
let stopping = new AbortController()
let refreshed = await holding(g, 'refresh-index', {
  holder: 'w2',
  signal: stopping.signal,
}, async (signal) => {
  equal((await held(g, 'refresh-index'))?.holder, 'w2')
  stopping.abort()
  await until(signal)
  return 'refreshed'
})
equal(refreshed, 'refreshed')
equal((await held(g, 'refresh-index'))?.holder, null)
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

## Check recorded runs

`runs(host, options)` supplies `effect_check`. The check reports failed runs and
runs pending past their due time by more than `minutes` (default ten), showing
up to `sample` examples (default five). It does not retry runs or repair them.
Without an `effect` component it reports no findings.

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
