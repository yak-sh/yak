# @yaks/effects

Runs application code after graph changes commit, for work such as sending mail,
updating an index or calling an external API. A failure is reported and cannot
roll back the committed change.

A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction, such as the array passed to
`graph.apply()`. See the [graph architecture](../graph/ARCHITECTURE.md) for the
write phases.

Two kinds of registration meet in one registry, and the difference is who knows
about them:

- An **effect** is declared in a vocabulary (`effect: true`), so every process
  that loads the vocabulary knows what a write owes, whatever code it imported.
  The code that runs one is registered under its name (`handle`). With the
  optional `effect` component loaded, a commit writes each run it owes into the
  graph in its own transaction, whichever process wrote it, and any number of
  processes working the **pool** claim those runs and run each once.
- An **observer** is registered at runtime (`created`, `changed`, `removed`,
  `on`), so only its own process knows it: it runs there, after that process's
  own commits, at most once. A view refreshing what it shows is an observer.

The `lease` component coordinates a duty only one process should run, and
`provisional` marks an entity whose asynchronous step has not finished.

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## Declare an effect, and handle it

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
    post_announce: {
      effect: true,
      created: ['post'],
      changed: ['post.published'],
      description: 'tell the subscribers about a post',
    },
  },
}])
let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })

fx.handle({
  post_announce: (event) => console.log(event.kind, event.entity.eid),
})

g.apply([{ entity: { eid: 'p1' }, post: { title: 'First post' } }])
g.apply([{ entity: { eid: 'p1' }, post: { published: true } }])
```

A declaration names its triggers: `created`, `changed` (a component, or
`comp.prop` for one property), `removed`, and `match`, a pattern (below). It can
also say how many attempts a run gets (`tries`), that a run interrupted mid-way
must not run again (`idempotent: false`), and a `sweep`, a query whose matches
are owed a `created` run again whenever a worker starts. `handle` throws for a
name the vocabulary does not declare, so a typo never goes quietly unrun.
Without the `effect` component there is no pool, and a handled effect runs in
the process that committed, like an observer.

## Observe

```ts
fx.created('post', (event) => console.log('created', event.entity.eid))
fx.changed('post', 'published', (event) => console.log(event.comp?.published))
fx.removed('post', (event) => console.log('removed', event.entity.eid))
```

`effects()` returns a graph plugin with registration methods. Code can be
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

An observer's pattern is never replayed: a run a crash lost is lost. A declared
effect's `match` is written down with the commit, and its `sweep` finds what
nobody wrote down.

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

| Observer                   | Declared            | Trigger                                                  |
| -------------------------- | ------------------- | -------------------------------------------------------- |
| `created(comp, run)`       | `created: [comp]`   | An entity gains the component                            |
| `changed(comp, prop, run)` | `changed: [c.prop]` | An applied patch includes that property                  |
| `changed(comp, run)`       | `changed: [comp]`   | An applied patch updates that component                  |
| `removed(comp, run)`       | `removed: [comp]`   | The component is removed, directly or by entity deletion |
| `on(pattern, run)`         | `match: pattern`    | A query matches an entity touched by the batch           |

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
- **Written with the commit, where there is a pool:** a declared effect's runs
  commit with the write that owes them, so a crash cannot lose one. Without a
  pool, and for every observer, a crash after commit can lose the run.
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

## The pool (optional)

Load `effectDoc` beside your own vocabulary and a commit writes down the runs it
owes; `work` claims and runs them:

```ts
import { effectDoc, effects } from '@yaks/effects'

// appDocs declares the application's components and effects.
let vocab = loadVocab([...appDocs, effectDoc])
let fx = effects(vocab, {
  owner: me,
  write: (b) => g.apply(b, { trusted: true }),
})
let g = graph({ storage, vocab, plugins: [fx] })
fx.handle({ send_receipt: receipt })

await fx.work(g, signal) // until `signal` aborts
await fx.work(g) // or one pass, on the way through
```

An `effect` row records the effect's name (`handler`), the target, the
component, the event kind, the state, the attempt count, the error, the next
attempt time, the generation and the claim. A claim is the row's own lease —
owner, token, expiry — taken with the graph's precondition, so two workers
reaching for one row settle it in one transaction and the loser moves on. A
worker renews the claims it is running; one that dies leaves claims that expire,
and the next pass takes them.

A process working the pool claims the runs its own commits owe as it writes
them, and starts them once the commit is done. What another process wrote is
picked up by the next pass, at most a second away. A worker that stays up with
code for every declared effect holds a presence lease, one per process, and a
one-shot `work` leaves the pool to it: a command passing through does not race a
server for the same rows. A worker handling only some of them holds none, since
it would leave the rest owed to nobody. `stop` leaves the pool, so what the
process commits afterwards is left for the others.

A run that throws is due again after a backoff (a second, doubling, capped at
five minutes) until it spends its attempts (`tries`, default three) and stays
`failed` with its error. A run interrupted mid-way is run again, unless its
declaration says `idempotent: false`, where it is left failed: a second run
could repeat something that already reached an external system. A run rebuilds
its event from the target's current state, so a handler needing a historical
value stores it itself. The `effect_check` tool reports failed and overdue runs.

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
declares the mark alone, for a vocabulary that keeps no pool; `effectDoc`
carries it too.

## Composition

The plugin works with `@yaks/ram` or database adapters. The pool and leases are
graph components stored by the chosen adapter; they survive process restarts
only when that storage is persistent. Pattern features depend on the adapter's
query support.

## Exports

The root exports `effects`, registry/event/registration types, event derivation
helpers, effect-write generation helpers, `pool`, `effectDoc`, retry settings,
lease operations, `PROVISIONAL` and `provisionalDoc`. `@yaks/effects/vocab`
exports `docs`, `effectDoc`, which declares `effect`, `lease`, `provisional` and
`effect_check`, and `provisionalDoc`. `@yaks/effects/tools` exports the tool
implementations. Loading declarations alone does not install a registry or work
the pool.

## Compatibility

The registry uses TypeScript and standard web APIs. It can run in Deno, Node,
Workers or browsers with a compatible graph storage adapter.
