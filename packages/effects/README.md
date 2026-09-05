# @yaks/effects

**What a graph does about the data it commits** — kept out of the write path.

When a post is published, notify its subscribers. When an order is paid, print
the receipt. When an account is deleted, close its sessions. None of that
belongs inside the transaction that stored the post: it is slow, it can fail,
and failing must not un-store the post.

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## The mechanism, not the effects

This package ships **no effect and no component**. It is the registry, the
phase, and the rules for running a handler safely. The components are your
vocabulary's; the handlers are yours.

```ts
import { graph } from '@yaks/graph'
import { memory } from '@yaks/memory'
import { effects } from '@yaks/effects'

let fx = effects(vocab)
let g = graph({ storage: memory(vocab), vocab, plugins: [fx] })

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

An effect that writes gets one door, and it is the graph's own `apply()`.

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

**The loop is stopped by the door, not by each handler.** A write from an effect
can of course wake an effect. Every batch carries its generation under `$effect`
— `0` at the door, `1` for an effect's write, one more each hop — and a batch
past `depth` (default `1`) commits, journals and casts like any other while
waking nobody.

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

## Where it sits

Below it, [@yaks/graph](https://jsr.io/@yaks/graph) owns the phases and hands
this one the committed batch. Beside it, any storage adapter —
[@yaks/memory](https://jsr.io/@yaks/memory) in a page or a test, a database
adapter on a server. Above it, the plugins that have something to do: this is
the seam a component domain uses to act on its own components without touching
the write path.
