# @yaks/effects

Post-commit handlers for graph changes, such as notifications or external API
calls. Handlers run outside the storage transaction, so a handler failure does
not roll back the committed data. Applications supply the handlers and component
vocabulary.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## Register handlers

This package ships **no effect and no component**. It is the registry, the
phase, and the rules for running a handler safely. The components are your
vocabulary's; the handlers are yours.

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

`effects()` is a [@yaks/graph](https://jsr.io/@yaks/graph) plugin, so it is
registered like any other. Handlers may be registered before or after the graph
is built — after is what lets a handler close over the graph it writes back
through.

## Three things happen to a component

| registration                 | fires when                                      |
| ---------------------------- | ----------------------------------------------- |
| `created(comp, run)`         | an entity gains that component                  |
| `changed(comp, column, run)` | a patch moves that column                       |
| `changed(comp, run)`         | a patch moves any column of it                  |
| `removed(comp, run)`         | it goes — dropped, or with the entity that died |

A batch on the wire does not say which of these it is: the same bundle patches a
component that existed and creates one that did not, and a cascade's casualty
comes back as a bare tombstone carrying nothing. So the plugin reads what each
entity carries **before** the patches go in — including everything the batch is
about to kill — and reads the committed batch against it afterwards. That is the
whole derivation, and it is why `removed` fires for a cascade's casualties and
not only for the entity you named.

An event carries what happened, to whom, and the patch as applied:

```ts
{ kind: 'changed', entity: { eid: 'p1', num: 7 }, name: 'post',
  comp: { published: true } }
```

On a `created` event `comp` is the whole birth row; on a `changed` event it is
**only the columns that moved**; on a `removed` event there is nothing left to
carry.

## The four promises

**Post-commit only.** A handler runs after the transaction returned. It cannot
veto a write, and a batch that was refused fires nothing at all — the effect
phase is never reached. Rejecting a write is the precondition phase's job,
upstream in `apply()`.

**Isolated.** Every handler runs in its own try. A throw, or a rejected promise,
goes to `report` and the next handler still runs:

```ts
let fx = effects(vocab, {
  report: (err, { handler, event }) => log.warn(handler, event.kind, err),
})
```

**At most once.** A crash between the commit and the handler loses the run. That
is the honest default for a re-render or a cache eviction; where it is not
acceptable, see the ledger below.

**Sync stays sync.** Synchronous handlers keep a synchronous `apply()`. The
first handler that returns a promise makes that one call's answer a promise —
@yaks/graph's sync pass-through, unchanged. A handler that must not delay its
caller starts its own work and returns nothing.

## Writing back

Effects write through the graph’s `apply()` method.

```ts
let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })

fx.changed('order', 'paid', (e, tx, write) => {
  write([{ entity: { eid: receipt }, receipt: { order: e.entity.eid } }])
})
```

So the write-back is admitted, stamped, cascaded, journaled, cast to
subscribers, and seen by the other effects — none of which a write straight
through `tx.patch` is. It is a **new batch**, after the commit that woke the
handler, never a row smuggled into a transaction that has already finished.
`trusted` is what lets an effect stamp a server-owned column, which is most of
what effects write.

The `tx` a handler also receives stays the detached transaction it always was:
each call its own unit of work, for **reading** the settled state.

Effect writes can trigger more effects. Each batch carries a generation under
`$effect`: `0` for an initial write, `1` for an effect’s write, incrementing for
each subsequent handler write. Batches beyond `depth` (default `1`) still
commit, are journaled, and are broadcast, but do not trigger handlers.

```ts
let fx = effects(vocab, { write, depth: 0 }) // an effect's write wakes no one
```

## The durable tier (optional)

Load the `effect` component and wrap the runs, and every run is written down
before it happens and marked after. A row still `pending` when a process starts
is a run a crash interrupted; `reconcile()` gives it **one** more attempt.

```ts
import { loadVocab } from '@yaks/vocab'
import { detached, graph } from '@yaks/graph'
import { effectDoc, effects, ledger } from '@yaks/effects'

let vocab = loadVocab([effectDoc, blog])
let log = ledger({ owner: 'worker-1' })
let fx = effects(vocab, { around: log.around })
let g = graph({ storage, vocab, plugins: [fx] })

fx.created('order', receipt) // …and the rest of the handlers

await log.reconcile(fx, detached(storage)) // at boot
```

```
effect{handler, target, comp, kind, state, attempts, lease_owner, …}
```

One more attempt, not a retry loop: a handler that ran, reached the world, and
died before its row was marked must not reach it twice, so a row that has spent
its retry is marked `failed` and left for a person. The lease keeps two
processes off the same row — a reconciler claims a row before running it and
skips one whose claim is somebody else's and has not expired.

An application that wants none of this loads no `effect` component and stores
nothing; the in-memory tier needs no component at all.

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

A sweep re-drives only the created slot, one fetch per declaration. The reader
interprets `pending` (SQL above is an application choice), and returns rows with
`eid`. Sync readers start handlers synchronously; async readers do not block
other declarations. Fetch failures and individual handler failures are isolated.
Declaring a sweep promises an **idempotent** handler: this is at-least-once boot
reconciliation, not an exactly-once delivery guarantee or the optional durable
ledger. `fx.docs()` lists the actual grouped hooks, pending predicates, and
descriptions; `fx.slots()` exposes individual slots.
