# @yaks/effects

Runs application handlers after graph changes commit, for work such as updating
an index, notifying subscribers or calling an external API. Handler failures are
reported separately and cannot roll back the committed change.

A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction, such as the array passed to
`graph.apply()`. See the [graph architecture](../graph/ARCHITECTURE.md) for the
write phases.

The default registry is in memory and stores no graph data. Optional `effect`
and `lease` components support retry records and coordination of duties, and
`provisional` marks an entity whose effect has not finished yet. Applications
supply the handlers and their domain components.

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## Register handlers

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'

let vocab = loadVocab([{
  $defs: {
    entity: {
      component: true,
      type: 'object',
      properties: { num: { type: 'number', stamped: true } },
    },
    post: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        published: { type: 'boolean' },
      },
    },
  },
}])
let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })

fx.created('post', (event) => console.log('created', event.entity.eid))
fx.changed('post', 'published', (event) => console.log(event.comp?.published))
fx.removed('post', (event) => console.log('removed', event.entity.eid))

g.apply([{ entity: { eid: 'p1' }, post: { title: 'First post' } }])
g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
```

`effects()` returns a graph plugin with registration methods. Handlers can be
registered before or after graph construction. Every handler receives
`(event, tx, write)`: the event, a detached transaction interface for reading
committed state, and a callback for new graph writes when configured.

## Or a pattern — any query over what committed

```ts
fx.on('.post, !post.published', (event) => console.log(event.entity.eid))
```

A pattern is a query evaluated against the committed graph. It is checked only
when a batch changes a component the query reads, and a result triggers a
handler only if the batch touched the entity bound by its first pattern. This
does not guarantee a false-to-true transition: an entity that already matched
can trigger again when touched.

Required components absent from the vocabulary make a pattern inactive. An
absence condition on an undeclared component is dropped. Queries joining
multiple entities require a storage adapter with `bindings`, such as
`@yaks/sqlite` or `@yaks/durable-object`. Unsupported query execution is
reported as an effect failure after commit.

Rows missed during a process failure need application-driven reconciliation,
such as running the query at startup; registering a pattern alone does not
replay them.

## A removal is a clause too

```ts
fx.on('-post', (event) => console.log('removed', event.entity.eid))
```

`-post` means the current batch removed that component. Alone, it registers the
same event as `removed('post', handler)` and works with every supported adapter,
including cascaded deletions. A mixed pattern such as `.product, -shelf` also
needs an adapter that can query the batch's removal overlay; ordinary committed
rows cannot show which removed components were present before the write.

## Three things happen to a component

| Registration               | Trigger                                                  |
| -------------------------- | -------------------------------------------------------- |
| `created(comp, run)`       | An entity gains the component                            |
| `changed(comp, prop, run)` | An applied patch includes that property                  |
| `changed(comp, run)`       | An applied patch updates that component                  |
| `removed(comp, run)`       | The component is removed, directly or by entity deletion |
| `on(pattern, run)`         | A query matches an entity touched by the batch           |

The plugin reads component presence before applying changes, including
components on entities about to be deleted by a cascade. After commit it
interprets the applied patches in order to distinguish creation, change and
removal. A changed event describes the applied patch, not a comparison of old
and new values.

```ts
let event = {
  kind: 'changed',
  entity: { eid: 'p1', num: 7 },
  name: 'post',
  comp: { published: true },
}
```

`comp` holds the new component on creation, the applied properties on change,
and is absent on removal. Pattern events have `kind: 'matched'` and can carry
`vars` with query variable bindings.

## The four promises

- **After commit:** refused batches trigger no handlers. Handlers cannot reject
  a write that already committed.
- **Isolated failures:** thrown errors and rejected promises go to `report`;
  other handlers still run. The default reporter uses `console.warn`.
- **No automatic replay:** ordinary dispatch attempts handlers for that
  invocation. A crash after commit can lose work. Repeated dispatch can repeat
  work; there is no durable deduplication in the basic registry.
- **Synchronous return when possible:** synchronous handlers preserve a
  synchronous `apply()` result. Returning a promise makes that call
  asynchronous. Work started without returning its promise does not delay the
  caller, but the handler must then handle its own later failures.

```ts
let reported = effects(vocab, {
  report: (error, { handler, event }) => {
    console.warn(handler, event.kind, error)
  },
})
```

## Writing back

Configure `write` to apply a new batch through the graph. Use this setup instead
of the previous registry construction:

```ts
let fx = effects(vocab, { write: (changes) => g.apply(changes) })
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
fx.created(
  'post',
  (event, _tx, write) =>
    write([{ entity: event.entity, post: { published: false } }]),
)
```

Use `{ trusted: true }` in the configured `g.apply()` call if a handler must
write server-owned properties. Return the callback's result when callers should
await the write. It receives the usual graph validation, stamps, journal and
notifications configured on that graph. Direct transaction patches do not run
that pipeline.

Writes carry a generation number under `$effect`: initial writes are generation
0, handler writes are generation 1, and each further handler write increments
it. Batches beyond `depth` (default 1) still commit but do not trigger more
handlers. `depth: 0` disables handlers for all effect-generated writes.

<a id="the-durable-tier-optional"></a>

## Durable execution records (optional)

Load `effectDoc` and wrap handler runs with `ledger().around` to persist
attempts:

```ts
import { detached, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { effectDoc, effects, ledger } from '@yaks/effects'

// appDocs includes the graph and application component declarations.
let vocab = loadVocab([...appDocs, effectDoc])
let log = ledger({ owner: 'worker-1' })
let fx = effects(vocab, { around: log.around })
let g = graph({ storage, vocab, plugins: [fx] })

fx.created('order', receipt, { tries: 5 })
await log.reconcile(fx, detached(storage))
```

Supply storage created for this vocabulary and application handler `receipt`.
Register the same handlers before reconciling persisted attempts. Run
`reconcile()` at startup and subsequently when retries are due; the ledger
starts no scheduler. `due(tx)` reports the earliest scheduled retry time.

An `effect` row records the handler ID, target, component, event kind, state,
attempt count, error, next attempt time and lease information. The default is
three attempts, with exponential backoff starting at one second and capped at
five minutes. An exhausted run stays `failed`; the `effect_check` tool reports
failed or overdue runs.

The ledger records an attempt **after the original graph commit**, before
calling the handler, and marks it afterward. A crash between graph commit and
creation of that record can still lose the event. A recorded attempt may be
retried after a crash, so external operations need their own idempotency or
reconciliation.

A handler that throws is eligible for a scheduled retry until it exhausts its
attempts. Set `{ idempotent: false }` to prevent retrying an interrupted attempt
whose outcome is unknown. This setting does not prevent retries of reported
failures, and throwing does not prove an external operation had no effect.

A recorded attempt holds its process's lease from the moment it is written, and
reconciliation claims pending rows with expiring leases, skipping unexpired
claims belonging to other owners. A run still going in one process is therefore
left to it by every other process's sweep, and an interrupted one is taken once
its lease lapses. Retry records do not preserve the original property patch:
reconciliation rebuilds the event using current target state. Handlers needing
historical values must store or obtain those values separately.

## Duties, and the one process running each

The optional `lease` component records `{ name, holder, until }`. Its ID is
derived from the duty name, so contenders address the same entity. `take()` uses
`$was` preconditions on holder and expiry to decide ownership atomically. The
holder is an entity reference and must name an existing entity.

```ts
import { holding, until } from '@yaks/effects'

// g includes effectDoc; me is an existing holder entity.
await holding(g, 'refresh-index', { holder: me, signal }, async (stopping) => {
  await refreshIndex()
  await until(stopping)
})
```

`holding()` waits for a lease, renews it while work runs, and releases it when
the callback finishes. The callback should honor its signal. With no signal, or
an already aborted signal, it makes one attempt and returns if another process
owns the duty. `until(signal)` lets completed startup work retain the lease
until shutdown. A terminated holder's lease eventually expires.

`take`, `drop`, `held`, `released` and `leaseEid` expose the individual
operations. The default hold duration is 30 seconds. Without a `lease`
declaration, taking a lease succeeds without storing anything; that mode
provides no coordination between processes.

## Provisional entities

An entity whose write commits before an asynchronous step about it has finished
wears `provisional{note}` beside its other components: `note` is a line for the
person reading it, such as "saving the key". The effect that finishes the step
removes the mark. A write that waits for its effects never shows its own writer
the mark; another reader in between sees it, and can say so. `provisionalDoc`
declares the mark alone, for a vocabulary that does not load the ledger;
`effectDoc` carries it too.

## Composition

The basic plugin works with `@yaks/ram` or database adapters. Durable attempts
and leases are graph components stored by the chosen adapter; they survive
process restarts only when that storage is persistent. Pattern features depend
on the adapter's query support.

## External journals and split processes

`fx.dispatch(events, tx?)` accepts committed `Event[]` from an external journal.
The consumer owns its cursor and process coordination. Dispatch starts handlers
eagerly and isolates their failures. Without `tx`, event-only handlers work, but
attempts to read through the transaction are reported as errors. The configured
`write` callback remains available.

Grouped registrations can select a process class and declare startup work:

```ts
let fx = effects(vocab, { want: (where) => where == 'do', write })
fx.on('order', {
  where: 'do',
  created: ship,
  changed: { address: reroute },
  sweep: { pending: 'shipped_at is null' },
  doc: 'Ship pending orders',
  wants: (bundles) => [{ eids: bundles.map((b) => b.entity.eid) }],
})
await fx.dispatch(events, tx)
await fx.relay((comp, pending) => pendingRows(comp, pending), tx)
```

Here `ship`, `reroute`, `write` and `pendingRows` are application functions, and
`events`/`tx` come from the consumer. The application interprets `pending`; SQL
is one choice. `relay()` fetches once per sweep declaration and invokes only the
created handler for each returned row, which must include `eid`. Declaring a
sweep requires an idempotent handler because reconciliation can repeat work.

`want` filters graph-plugin dispatch, external dispatch, `attempt` and `relay`.
The default process class is `do`; without a filter all classes run. The third
argument to `dispatch` or `relay` can override `want` and `report` for that
pass. `wants` declares reads gathered for graph-plugin execution; external
consumers supply their own transaction. `docs()` describes grouped hooks and
`slots()` lists individual registrations.

## Exports

The root exports `effects`, registry/event/registration types, event derivation
helpers, effect-write generation helpers, `ledger`, `effectDoc`, retry settings,
lease operations, `PROVISIONAL` and `provisionalDoc`. `@yaks/effects/vocab`
exports `docs`, `effectDoc`, which declares `effect`, `lease`, `provisional` and
`effect_check`, and `provisionalDoc`. `@yaks/effects/tools` exports the tool
implementations. Loading declarations alone does not install a registry or start
reconciliation.

## Compatibility

The registry uses TypeScript and standard web APIs. It can run in Deno, Node,
Workers or browsers with a compatible graph storage adapter.
