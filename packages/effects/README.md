# @yaks/effects

Post-commit handlers for graph changes, such as notifications or external API
calls. A handler is a function registered against a component name, and it runs
after the storage transaction has committed — so it cannot reject the write, and
a handler that throws does not roll the committed data back. Applications supply
both the handlers and the component vocabulary.

Throughout this README, a **batch** is a list of changes applied in one
transaction: the array you pass to `graph.apply()`, which is written in full or
not at all.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## Register handlers

This package ships **no effect and no component**. It is the registry, the write
phase the handlers run in, and the rules for running a handler safely. The
components are your vocabulary's; the handlers are yours.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'

let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })

fx.created('post', (e) => index(e.entity.eid, e.comp?.title))
fx.changed('post', 'published', (e) => notify(e.entity.eid))
fx.removed('post', (e) => unindex(e.entity.eid))
```

`effects()` returns a [@yaks/graph](https://jsr.io/@yaks/graph) plugin, so it is
registered like any other. Handlers may be registered before or after the graph
is built — after is what lets a handler close over the graph it writes back
through.

## Or a pattern — any query over what committed

A component name and one of three things happening to it is the narrow question.
The wide one is a PATTERN: any query, in the ordinary query grammar, run
wherever this batch just made it true.

```ts
fx.on('$call .call, !results', (e) => run(e.entity.eid))
```

Nothing has to be derived into the graph to trigger that. "A call with no
result" is a query the storage can already answer, so the query itself is the
registration — no flag column, no `pending` component, no second write to record
the first.

The query is run once per batch, and only for a batch that moved one of the
components the query reads; a result row is kept only where the batch touched
the entity the query's first pattern bound, so a handler runs for what just
happened rather than for every row that has always matched. Rows a crash left
behind are for a boot sweep to find, by running the same query.

A component the vocabulary does not declare cannot be stored on anything in that
graph, so a clause requiring it to be ABSENT is dropped and a clause requiring
it to be PRESENT makes the whole pattern inert — registered, listed, never run.
One pattern is therefore correct in two graphs: `!wake` is a no-op where nothing
is scheduled and a real condition where something is.

A pattern over more than one entity (a join) needs a storage adapter that
implements `bindings` — @yaks/sqlite and @yaks/durable-object do, an in-memory
map does not — and an adapter that cannot throws when asked, which the registry
reports rather than failing the batch it has already committed.

## A removal is a clause too

```ts
fx.on('-post', (e) => unindex(e.entity.eid))
fx.on('.product, -shelf', (e) => relist(e.entity.eid))
```

`-comp` means **this batch removed the component**, which is the one thing no
committed row can tell you: once the row is gone, "it was deleted" and "it was
never there" read alike. So the batch itself is passed to the query —
@yaks/sqlite's overlay keeps a list of what the batch removed, and the compiled
match reads it.

A pattern with no other clause (`-post`) needs none of that: it is exactly what
a removal event already reports, so it is registered as that event, triggered by
the registry's own reading of the batch like a creation or a change, and
supported by every storage adapter. That is also what keeps a cascade's
casualties firing — they are events, tombstone and all, long after their rows
are unreadable.

## Three things happen to a component

| registration                 | fires when                                      |
| ---------------------------- | ----------------------------------------------- |
| `created(comp, run)`         | an entity gains that component                  |
| `changed(comp, column, run)` | a patch moves that column                       |
| `changed(comp, run)`         | a patch moves any column of it                  |
| `removed(comp, run)`         | it goes — dropped, or with the entity that died |
| `on(pattern, run)`           | a query holds where this batch touched          |

`removed(comp, run)` **is** `on('-comp', run)` — one line of sugar over the
deletion clause (`@yaks/query`), producing the same slot, id and event as
before. `created` and `changed` are not patterns and cannot become any: a
pattern describes what is TRUE once the batch landed, while a creation or a
column move describes what CHANGED, which no reading of the committed rows
recovers. They stay their own registrations.

The changes a client sends do not record which of these it is: the same bundle
patches a component that existed and creates one that did not, and a cascade's
casualty comes back as a bare tombstone carrying nothing. So the plugin reads
what each entity carries **before** the patches go in — including everything the
batch is about to delete — and compares the committed batch against that reading
afterwards. That is the whole derivation, and it is why `removed` fires for a
cascade's casualties and not only for the entity you named.

An event carries what happened, to whom, and the patch as applied:

```ts
{ kind: 'changed', entity: { eid: 'p1', num: 7 }, name: 'post',
  comp: { published: true } }
```

On a `created` event `comp` is the whole new row; on a `changed` event it is
**only the columns that moved**; on a `removed` event there is nothing left to
carry.

## The four promises

**Post-commit only.** A handler runs after the transaction returned. It cannot
reject a write, and a batch that was refused fires nothing at all — the effect
phase is never reached. Rejecting a write is the precondition phase's job,
earlier in `apply()`.

**Isolated.** Every handler runs in its own `try`. A throw, or a rejected
promise, is passed to `report` and the next handler still runs:

```ts
let fx = effects(vocab, {
  report: (err, { handler, event }) => log.warn(handler, event.kind, err),
})
```

**At most once.** A crash between the commit and the handler loses the run. That
is the right default for a re-render or a cache eviction; where it is not
acceptable, see the ledger below.

**Sync stays sync.** Synchronous handlers keep `apply()` synchronous. The first
handler that returns a promise makes that one call's return value a promise —
@yaks/graph's sync pass-through, unchanged. A handler that must not delay its
caller starts its own work and returns nothing.

## Writing back

Effects write through the graph's `apply()` method.

```ts
let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })

fx.changed('order', 'paid', (e, tx, write) => {
  write([{ entity: { eid: receipt }, receipt: { order: e.entity.eid } }])
})
```

So the write-back is admitted, stamped, cascaded, journaled, broadcast to
subscribers, and seen by the other effects — none of which a write straight
through `tx.patch` is. It is a **new batch**, applied after the commit that
triggered the handler, never a row inserted into a transaction that has already
finished. `trusted` is what lets an effect write a server-owned column, which is
most of what effects write.

The `tx` a handler also receives stays the detached transaction it always was:
each call its own unit of work, for **reading** the settled state.

Effect writes can trigger more effects. Each batch carries a generation number
under `$effect`: `0` for an initial write, `1` for an effect's write,
incrementing for each subsequent handler write. Batches beyond `depth` (default
`1`) still commit, are journaled, and are broadcast, but do not trigger
handlers.

```ts
let fx = effects(vocab, { write, depth: 0 }) // an effect's write triggers nothing
```

## The durable tier (optional)

Load the `effect` component and wrap the runs, and every run is written down
before it happens and marked after. A run that did not complete is **tried
again** — `tries` attempts in all, with a backoff between them — and
`reconcile()` is the pass that runs what is outstanding: the runs a crash
interrupted, and the failures whose backoff has elapsed.

```ts
import { loadVocab } from '@yaks/vocab'
import { detached, graph } from '@yaks/graph'
import { effectDoc, effects, ledger } from '@yaks/effects'

let vocab = loadVocab([effectDoc, blog])
let log = ledger({ owner: 'worker-1' })
let fx = effects(vocab, { around: log.around })
let g = graph({ storage, vocab, plugins: [fx] })

fx.created('order', receipt) // …and the rest of the handlers

await log.reconcile(fx, detached(storage)) // at boot, and on a timer after
```

```
effect{handler, target, comp, kind, state, attempts, error, next, lease_*}
```

The retry belongs to the LEDGER, so no handler anywhere carries retry code. How
many attempts a handler gets is declared by the registration, never by one call:

```ts
fx.created('order', receipt, { tries: 5 })
fx.created('agent', launch, { idempotent: false })
```

There are two ways a run does not complete, and they are not the same thing. It
**reported** — the handler threw, so it got to report the failure before doing
anything — and the row keeps the error and `next`, the instant its backoff is
up. Or it was **interrupted**: the process died mid-run, or its lease expired
while it held it, and nothing records how far it got. A row with no `next` is
one of those, and it is tried again too, unless its registration set
`idempotent: false` — a handler that reached an external system and died before
its row was marked must not reach it twice. After the last attempt the row is
left `failed` with the last error beside it, for a person to look at
(`effect_check` is the tool that surfaces those).

The lease keeps two processes off the same row — a reconciler claims a row
before running it and skips one whose claim belongs to somebody else and has not
expired. `due()` returns when the soonest waiting retry falls due, so a sweep
can sleep until then rather than polling.

An application that wants none of this loads no `effect` component and stores
nothing; the in-memory tier needs no component at all.

## Background jobs, and the one process running each

Some work is nobody's request: the sweep above, a clock that fires what has come
due, picking back up the child processes a restart left running. Every process
that opens the graph could do it, and if they all did it would happen twice. So
each such job is a row.

```
lease{name, holder, until}
```

Its eid is derived from the `name`, the way an edge's eid is derived from its
endpoints and relation, so two processes reaching for one job address the same
row. Taking it is a write with a `$was` precondition naming the holder and the
expiry as the taker READ them, so the loser is refused inside the transaction
rather than overwriting the winner a moment later. Nothing here polls a lock
table — the graph's own precondition is the lock — and a graph whose vocabulary
does not declare `lease` has no other process to contend with, so every take
succeeds and nothing is written.

```ts
import { holding, until } from '@yaks/effects'

// a process that stays up: take the lease, renew it, release it at the end
await holding(graph, '@yaks/wake', { holder: me, signal }, (s) => clock(s))

// a process passing through: one pass if nobody holds it, then release
await holding(graph, '@yaks/wake', { holder: me }, (s) => clock(s))
```

The only difference between the two is the state of the signal. `until` is what
a pass that has already finished its work waits on, so the lease stays this
process's while it is up. A holder still working pushes `until` out on a timer;
one that was killed leaves a row that expires and the next process takes over,
so nothing has to clean up after it.

## Composition

[@yaks/graph](../graph/README.md) supplies the write phases and committed
batches. Effects can run with [@yaks/ram](../ram/README.md) or a database
adapter. Application plugins register handlers for their components.

## External journals and split processes

A journal consumer can feed committed `Event[]` to `fx.dispatch(events, tx)`
without installing the graph plugin or adopting the package journal layout. The
consumer owns its cursor and process lease; dispatch does not persist or replay
anything. Handlers start eagerly and failures stay telemetry. Omit `tx` for
event-only handlers; trying to read through it then is a reported error, never a
made-up empty result. The configured `write` callback remains available.

```ts
let fx = effects(vocab, { want: (where) => where == 'do', write })
fx.on('order', {
  where: 'do', // default; applications name their own process classes
  created: ship,
  changed: { address: reroute },
  sweep: { pending: 'shipped_at is null' },
  doc: 'ship each pending order',
  wants: (bundles) => [{ eids: bundles.map((b) => b.entity.eid) }],
})
await fx.dispatch(events, tx)
await fx.relay((comp, pending) => pendingRows(comp, pending), tx)
```

`want` selects slots in plugin dispatch, external dispatch, `attempt`, and
`relay`. A pass may override it (and `report`) with the third argument to
`dispatch` or `relay`. Inline consumers omit it to run every class. `wants` is a
graph-plugin read declaration, gathered once per grouped registration; an
external consumer brings its own detached transaction.

A sweep re-runs only the created slot, one fetch per declaration. The reader
interprets `pending` (SQL above is an application choice), and returns rows with
`eid`. Sync readers start handlers synchronously; async readers do not block
other declarations. Fetch failures and individual handler failures are isolated.
Declaring a sweep promises an **idempotent** handler: this is at-least-once boot
reconciliation, not an exactly-once delivery guarantee or the optional durable
ledger. `fx.docs()` lists the actual grouped hooks, pending predicates, and
descriptions; `fx.slots()` returns individual slots.
