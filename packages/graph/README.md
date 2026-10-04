# @yaks/graph

The entity-component data model, bundle write format, and phased, pluggable
transaction pipeline shared by the yaks packages. Use it to keep application
data in one representation across storage, local state, and transports.

For an overview of the related packages and how to compose them, read
[Architecture](ARCHITECTURE.md). Each package can also be used independently
where its public interfaces allow it.

## Data model

These terms describe the data passed between the packages.

- An **entity** is a thing with a stable id, `entity.eid`. It has no type of its
  own. An **eid** is the string that identifies an entity, such as `'b1'`.
- A **component** is a named object of properties attached to an entity, such as
  `book: { title: 'Dune' }`. An entity may carry several components; adding one
  does not create a new entity or change its identity. What an entity _is_ is
  decided by which components it carries. A **property** is a named value in a
  component, such as `book.title`. Its type is declared by the
  [vocabulary](../vocab/README.md#vocabulary).
- A **bundle** is one entity's components as a JSON object, including its
  identity:
  `{ entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } }`.
  Bundles are what reads return and what writes are expressed in.
- A **patch** describes a change to one entity: an omitted property is left
  alone, a `null` property is cleared, and a `null` component is removed. A
  bundle sent to `apply()` is a patch.
- A **batch** is an array of bundles sent to `apply()` together.
- A **transaction** is the unit in which storage applies a batch: either all its
  writes commit or none do.
- **Storage** is the adapter that holds bundles, answers
  [queries](../query/README.md#query-model), and opens transactions (`Storage`).
- A **graph** combines a vocabulary, storage, and the contributions that extend
  its reads and writes (`Graph`).
- A **phase** is a named step in the write pipeline (`Phase`).
- A **plugin** is a named contribution registered on one graph (`Plugin`).
- A **hook** takes bundles and a phase's `Tx`, and returns the bundles for the
  next step (`Hook`). Throwing before commit refuses the batch.
- A **rule** matches data and produces component patches. A `Rule` acts on each
  matched entity in a phase; a `Declared` rule's query supplies its writes and
  can match several entities.

The [vocabulary](../vocab/README.md#vocabulary) declares component names and
property types. [Edges](../edge/README.md) are entities too: an application can
declare an `edge` component with `from` and `to`
[references](../vocab/README.md#routing-and-references) and add further
components describing the relationship. The core does not require an
application-specific class hierarchy for entities.

`entity.num`, when a store keeps one, is a short human-facing number, not an
identity. Do not use it in place of an eid. Numbering is [@yaks/id](../id)'s:
that package declares the property and ships the allocator behind `$num: true`,
and a graph that registers neither has no numbers at all.

`mint()` generates an eid — a v4 UUID from `crypto.getRandomValues`, so a page
served over plain HTTP generates ids too — and `minted(id)` says whether an id
was generated rather than chosen by a person.

A **request** is a `$` key on a bundle that asks the write pipeline to act, such
as `$delete: true`. `$delete`, `$was` and `$actor` are the core's own; a plugin
declares its own in `requests`, and a request no plugin answers is refused at
admission rather than ignored, so asking a graph for something it cannot do is
an error you can read.

An **actor** identifies who writes (`by`) and the instrument the write came
through (`via`), carried as `$actor` (`Actor`). Each entity uses the first actor
its bundles name, or the first actor in the batch. `signed(bundles, actor)`
replaces all incoming actors. `graph({ actor })` supplies an actor for unsigned
bundles. The calling program decides which actors it trusts.

## Install

```sh
deno add jsr:@yaks/graph jsr:@yaks/vocab jsr:@yaks/ram
# Node projects can use: npx jsr add @yaks/graph @yaks/vocab @yaks/ram
```

## A complete in-memory example

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      type: 'object',
      component: true,
      properties: {
        title: { type: 'string' },
        pages: { type: 'number' },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
await g.install()

await g.apply([
  { entity: { eid: 'book:dune' }, book: { title: 'Dune', pages: 412 } },
])
await g.apply([{ entity: { eid: 'book:dune' }, book: { pages: 420 } }])
const books = await g.read('.book.pages>400')
equal(books, [{
  entity: { eid: 'book:dune' },
  book: { title: 'Dune', pages: 420 },
}])
```

The same graph interface works with [SQLite](../sqlite/README.md) and other
storage adapters. RAM is useful for tests and local state; it does not persist
across processes and does not implement every SQL query feature.

## Exports

| Import               | Exports                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/graph`        | `graph`; `Bundle`, `Graph`, `Access`, `Storage`, `Tx`, `ReadTx`, `Plugin`, `Rule`, `Tool`; identity, admission, gather, patch, projection, rule, stamp, schema, edit, transient, and error helpers |
| `@yaks/graph/schema` | `admitSchema`, full checks for opted-in property schemas and numeric constraints                                                                                                                   |
| `@yaks/graph/vocab`  | `graphDoc`, `docs`, `description`: built-in tool declarations                                                                                                                                      |
| `@yaks/graph/tools`  | `loadTools`, `runs`, `tier`, `generic`, and their implementation types                                                                                                                             |

## Writes and reads

`apply(bundles)` accepts an array of bundle patches and applies it in one
transaction:

- An omitted property is unchanged.
- A property set to `null` is cleared.
- A component set to `null` is removed.
- `$delete: true` deletes the entity, subject to the vocabulary's
  [death keyword](../vocab/README.md#routing-and-references). A **tombstone** is
  the `tombstone: {}` component that records a deleted entity, keeping its eid
  and number.
- A **precondition** is a requirement on stored state before a write. `$was`
  supplies per-property hashes of the values the caller read (`Was`). A mismatch
  refuses the entire batch rather than overwriting a concurrent edit.
- A write to a tombstoned entity whose `$was` names a value read before the
  delete raced it, and is dropped while the rest of the batch lands. Any other
  write that gives it a component brings it back under the same eid and number,
  holding only what that write gives.

The return value is the applied batch, including whatever plugins and reference
handling added to it. It contains one composed patch per affected entity; it is
not a full snapshot of every affected entity. A deleted entity is represented by
its identity plus `tombstone: {}`.

`read(query)` returns the bundles matching the query. For example, `.book`
selects entities that have that component, and `.book.pages>400` filters on a
property. See [@yaks/query](../query/README.md) for the syntax and which parts
each adapter supports. An empty query does not mean "dump the database".

`apply(bundles, { check: true })` runs the write phases and rolls back instead
of committing; it returns the proposed patches, runs audit hooks, and skips
effects. Trusted server code may correct metadata with
`apply(bundles, { trusted: true, stamp: false })`: core provenance and mark
rules are skipped, preserving stored timestamps and attribution, while plugin
rules and hooks, validation, journaling and effects still run. Disabling
stamping is refused without `trusted: true`. `apply(bundles, { replica: true })`
lands rows another graph already admitted in a partial copy of it, leaving out
the components this vocabulary does not declare instead of refusing them, and
keeping the computed values it was sent, which it has no rule to derive.
`g.rows(query)` returns adapter-specific rows for aggregates and other raw query
results. `g.get(eids)` returns those entities whole, tombstones included, by eid
rather than by query; `g.get(eids, comps)` returns each carrying only the
components `comps` names, and the storage reads nothing else. The storage
interface requires this lookup to avoid its write lock. `g.install()` makes the
adapter ready for the vocabulary (its schema, where it has one).

Graph methods work with synchronous and asynchronous storage. Using `await` is
safe either way; a synchronous adapter can also return values directly.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune', pages: 412 } }])
const proposed = await g.apply([
  { entity: { eid: 'b1' }, book: { pages: null } },
], { check: true })
equal(proposed[0].book, { pages: null })
equal((await g.get(['b1'], ['book']))[0].book, { title: 'Dune', pages: 412 })
await g.apply(proposed)
equal((await g.get(['b1']))[0].book, { title: 'Dune', pages: null })
await g.apply([{ entity: { eid: 'b1' }, book: null }])
equal((await g.get(['b1']))[0].book, undefined)
await g.apply([{ entity: { eid: 'b1' }, $delete: true }])
equal((await g.get(['b1']))[0].tombstone, {})
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Returned' } }])
equal((await g.get(['b1']))[0].book, { title: 'Returned' })
```

### Guarded writes

`token(value)` produces the hash for `$was`, with `null` for an absent value. A
failed precondition throws `Stale`, whose `current` is the committed value.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

const { token, Stale } = await import('@yaks/graph')
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune' } }])
await g.apply([{
  entity: { eid: 'b1' },
  book: { title: 'Edited' },
  $was: { book: { title: token('Dune') } },
}])
let current: unknown
try {
  await g.apply([{
    entity: { eid: 'b1' },
    book: { title: 'Stale edit' },
    $was: { book: { title: token('Dune') } },
  }])
} catch (error) {
  if (!(error instanceof Stale)) throw error
  current = error.current
}
equal(current, 'Edited')
equal((await g.get(['b1']))[0].book, { title: 'Edited' })
```

### Reference deletion

The vocabulary's [death keyword](../vocab/README.md#routing-and-references)
chooses what deleting a reference target does: `cascade` deletes the referring
entity, `detach` clears its property, `release` removes its component, and
`keep` retains the reference. The applied batch includes these patches.

A write that removes an entity's last component other than the provenance stamps
`created` and `updated` deletes the entity in the same transaction. Removing a
component through `release` follows this rule too, including the reference
consequences of that deletion. Marks such as `completed` and `archived` record
an act and are not provenance stamps. Bare identities with no provenance remain
live, including identities reserved by references in an unstamped graph.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true },
    review: {
      component: true,
      properties: {
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
    loan: {
      component: true,
      properties: {
        book: { type: 'string', ref: 'book', death: 'detach' },
      },
    },
    bookmark: {
      component: true,
      properties: {
        book: { type: 'string', ref: 'book', death: 'release' },
      },
    },
    history: {
      component: true,
      properties: {
        book: { type: 'string', ref: 'book', death: 'keep' },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
await g.apply([
  { entity: { eid: 'b1' }, book: {} },
  { entity: { eid: 'r1' }, review: { book: 'b1' } },
  { entity: { eid: 'l1' }, loan: { book: 'b1' } },
  { entity: { eid: 'm1' }, bookmark: { book: 'b1' } },
  { entity: { eid: 'h1' }, history: { book: 'b1' } },
])
await g.apply([{ entity: { eid: 'b1' }, $delete: true }])
equal((await g.get(['r1']))[0].tombstone, {})
equal((await g.get(['l1']))[0].loan, { book: null })
equal((await g.get(['m1']))[0].bookmark, undefined)
equal((await g.get(['h1']))[0].history, { book: 'b1' })
```

## Projections

A **projection** selects the components or properties a read returns.
**Coverage** says which properties a delivered bundle answers for, even when it
has no value: `true` covers the whole bundle, `{book: true}` the whole
component, and `{book: ['title']}` only its title (`Coverage`).

Each bundle carries the components the query names (`*` requests all). A
`.fields` projection returns only the named properties. Each entity reached
through a reference comes back as a separate bundle. `projection(vocab, query)`
plans that read; `project(g, plan)` separates selected and reached bundles and
reports coverage.

```ts
import { graph, project, projection } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
    review: {
      component: true,
      type: 'object',
      properties: {
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book' },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
await g.apply([
  { entity: { eid: 'b1' }, book: { title: 'Dune', pages: 412 } },
  { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
])
const plan = projection(
  vocab,
  '.review&.fields=review.stars,review.book.book.title',
)!
const answer = await project(g, plan)
equal(answer.found, [{
  entity: { eid: 'r1' },
  review: { stars: 5, book: 'b1' },
}])
equal(answer.reached, [{ entity: { eid: 'b1' }, book: { title: 'Dune' } }])
equal(answer.covers.get('b1'), { book: ['title'] })
equal(await g.read(plan.query), [...answer.found, ...answer.reached])
```

### Reductions

`rows(query)` answers storage rows. `aggregate(ast)` identifies a query's
`.count`, `.distinct`, or `.tally` reduction; `reduced(op, rows)` gives its
portable result shape.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

const { aggregate, reduced } = await import('@yaks/graph')
const { parse } = await import('@yaks/query')
await g.apply([
  { entity: { eid: 'b1' }, book: { pages: 412 } },
  { entity: { eid: 'b2' }, book: { pages: 412 } },
])
const q = '.book&.count'
equal(aggregate(parse(q)), 'count')
equal(reduced('count', await g.rows(q)), { count: 2 })
equal(reduced('tally', await g.rows('.book&.tally=book.pages')), {
  tally: { '412': 2 },
})
equal(reduced('distinct', await g.rows('.book&.distinct=book.pages')), {
  distinct: ['412'],
})
```

## IDs and names

Use an explicit eid when the application already has an identity for the thing.
An **alias** is an eid starting with `$` that asks the graph to assign an eid,
local to one batch:

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      type: 'object',
      component: true,
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

const applied = await g.apply([
  { entity: { eid: '$newBook' }, book: { title: 'A new book', pages: 100 } },
])
equal(applied[0].$alias, '$newBook')
equal((await g.get([applied[0].entity.eid]))[0].book, {
  title: 'A new book',
  pages: 100,
})
```

The graph assigns an eid and resolves every reference to the same alias within
that batch. Reusing `$newBook` in a later batch does not refer to the previous
entity. For persistent, idempotent names, compose
[@yaks/alias](../alias/README.md), which builds on
[@yaks/key](../key/README.md). `g.address(ids)` asks the installed plugins to
resolve names to eids, and a write asks it about every id the write names. An id
a plugin recognises as its own form and finds naming nothing (`T-998` where
there is no T-998) is refused rather than taken for an eid. It does not replace
ordinary reference validation. `g.address(ids, kind)` also says which component
the ids are meant to name, so a plugin may answer to a key only that kind has:
@yaks/session resolves a run's own harness id only when a session is meant.

### Derived eids

`derivedEid(text)` derives a version-8 UUID from SHA-256. The vocabulary's
[identity keyword](../vocab/README.md#identity-and-indexes) selects the values
`identityEid(component, values)` uses. Writing them under an alias derives the
eid; writing them onto a different eid is refused. A plugin's `derive` overrides
the vocabulary's derivation for its component.

```ts
import { graph, identityEid, mint, minted } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    guide: {
      component: true,
      type: 'object',
      properties: { slug: { type: 'string', identity: true } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
const first = await g.apply([{
  entity: { eid: '$a' },
  guide: { slug: 'store' },
}])
const again = await g.apply([{
  entity: { eid: '$b' },
  guide: { slug: 'store' },
}])
equal(first[0].entity.eid, identityEid('guide', ['store']))
equal(again[0].entity.eid, first[0].entity.eid)
equal((await g.read('.guide')).length, 1)
equal(minted(mint()), true)
```

`g.address(ids, kind?)` asks plugins to resolve names to eids. An unrecognised
name stays unchanged; a recognised name mapped to `null` is refused unless a
later plugin resolves it. Addressing also runs on writes and on queries that
name an eid or reference. Persistent names belong to
[@yaks/alias](../alias/README.md) and [@yaks/key](../key/README.md).

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

g.use({
  name: 'names',
  address: (_tx, ids) =>
    new Map(ids.filter((id) => id == 'dune').map((id) => [id, 'b1'])),
})
await g.apply([{ entity: { eid: 'dune' }, book: { title: 'Dune' } }])
equal((await g.address(['dune'])).get('dune'), 'b1')
equal((await g.read('.entity.eid=dune'))[0].entity.eid, 'b1')
```

## Plugins and transactions

`graph({ plugins })` registers plugins at construction; `g.use(plugin)` adds one
to that graph. Load `vocabOf(plugins)` into the vocabulary before constructing
storage; `g.use()` does not reload it.

`PHASES` lists the order: `normalize`, `admit`, `mint`, `prepare`,
`precondition`, `rules`, `mutate`, `cascade`, `stamp`, `journal`, `commit`,
`effect`, `audit`. Only `precondition` through `commit` run inside the batch's
transaction.

The write pipeline separates the work done before anything is written, the
writes themselves, and the observers that run after the commit. In particular:

- `normalize` can rewrite incoming data.
- `prepare` finishes idempotent external work after admission and minting,
  before opening the transaction. Prepared content can remain after a refusal or
  dry run; graph preconditions still check current data inside the transaction.
- Admission and preconditions validate it against the vocabulary and the current
  state before any write is accepted. Admission refuses a component or property
  the vocabulary does not declare, naming it, and casts a string property's
  value to a string, so a number written to one is stored and returned as its
  text.
- Reference handling, writing, and journaling all run inside the storage
  transaction.
- `effect` observers run after the commit. One failing cannot undo a committed
  write.
- `audit` handles refusals and dry-run rollbacks.

Use [@yaks/effects](../effects/README.md) when a committed state change should
trigger further work. Do not perform irreversible external operations in a hook
whose transaction could still roll back. An [effect](../effects/README.md) is
not automatically exactly-once: any operation that may be retried needs an
idempotency strategy of its own.

The [rules](#rules) below add patches during a phase. The vocabulary, storage,
and registered plugins determine which features are available.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

const { Checked } = await import('@yaks/graph')
let effects = 0, checks = 0
g.use({
  name: 'uppercase',
  hooks: {
    normalize: (bundles) =>
      bundles.map((b) =>
        b.book ? { ...b, book: { ...b.book as object, title: 'DUNE' } } : b
      ),
    effect: (bundles) => {
      effects++
      return bundles
    },
    audit: (bundles, _tx, error) => {
      if (error instanceof Checked) checks++
      return bundles
    },
  },
})
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune' } }], {
  check: true,
})
equal([effects, checks], [0, 1])
equal(await g.get(['b1']), [])
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune' } }])
equal((await g.get(['b1']))[0].book, { title: 'DUNE' })
equal(effects, 1)
```

### Read hooks

`reads(opts)` selects the callers that need `ask(ctx, ast)` and
`answer(ctx, bundles)` translations. `ReadOpts.speaks` carries their package
versions. `native: true` skips these hooks while retaining core addressing.
`g.ask`, `g.answer`, and `g.rewrites` expose the same behavior to transports;
`get` with components and `rows` with fields also use applicable translations.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

const { map } = await import('@yaks/query')
g.use({
  name: 'reader',
  reads: (opts) => opts.speaks?.shop == 0,
  ask: (_ctx, ast) =>
    map(
      ast,
      (c) =>
        c.kind == 'pred' && c.path.join('.') == 'book.title'
          ? { ...c, path: ['book', 'pages'] }
          : c,
    ),
  answer: (_ctx, bundles) =>
    bundles.map((b) =>
      b.book
        ? { ...b, book: { title: String((b.book as { pages: number }).pages) } }
        : b
    ),
})
await g.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }])
const opts = { speaks: { shop: 0 } }
equal((await g.read('.book.title=412', opts))[0].book, { title: '412' })
equal(g.rewrites(opts), true)
equal(await g.read('.book.title=412', { ...opts, native: true }), [])
```

### Gather and ordered writes

An **ask** declares a read needed before a phase (`Ask`): `eids` names entities,
`select` narrows their components, and `about` names reference targets, narrowed
by `comps`. A **gather** satisfies the core's asks and `Plugin.wants(bundles)`
before preconditions (`gather`). Hooks use `tx.get` and `about(tx, vocab, ids)`
to reuse those reads. Undeclared reads still work through storage. An ask with
`hint: true` predicts a later read; a failed hint retries the gather without
hints, and phases still fetch anything they need.

`beforeWrite(bundles)` returns a hook that checks each operation against earlier
writes in the same transaction, or `undefined` when this batch needs no check
from that plugin. `$was` still checks the state before the batch. Only when
every hook declares `independent: true` are the operations combined.
`preflight(storage, vocab, hook)` rehearses ordered checks in a nested
transaction and always rolls it back; it requires storage with nested rollback
support. Neither mechanism supports external side effects in its checks.

```ts
import {
  type Bundle,
  type Comp,
  detached,
  graph,
  preflight,
  type Tx,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, properties: { pages: { type: 'number' } } },
  },
})
const store = ram(vocab)
const g = graph({ storage: store, vocab })
const bundles = [1, 2].map((pages) => ({
  entity: { eid: 'b1' },
  book: { pages },
}))
const seen: unknown[] = []
const check = async (bundles: Bundle[], tx: Tx) => {
  seen.push(((await tx.get(['b1']))[0]?.book as Comp)?.pages)
  return bundles
}
const rehearsal = preflight(store, vocab, check)
await rehearsal(bundles, detached(store))
equal(seen, [undefined, 1])
equal(await g.get(['b1']), [])
seen.length = 0
g.use({
  name: 'ordered',
  wants: () => [{ eids: ['b1'], select: ['book'] }],
  beforeWrite: () => check,
})
await g.apply(bundles)
equal(seen, [undefined, 1])
equal((await g.get(['b1']))[0].book, { pages: 2 })
```

`track(tx, found)` wraps transaction writes and returns a `Tracker`. Its `flush`
may append derived bundles; the graph flushes before journaling and again after
commit hooks, inside the transaction. Storage metadata belongs here; external
work belongs after commit.

```ts
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, properties: { pages: { type: 'number' } } },
    tracked: { component: true, properties: { pages: { type: 'number' } } },
  },
})
const g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [{
    name: 'tracking',
    track: (tx) => {
      const pending = new Map<string, number>()
      return {
        tx: {
          ...tx,
          patch: (bundles) => {
            for (const b of bundles) {
              const pages = (b.book as Comp | undefined)?.pages
              if (typeof pages == 'number') pending.set(b.entity.eid, pages)
            }
            return tx.patch(bundles)
          },
        },
        flush: async (bundles) => {
          const made: Bundle[] = [...pending].map(([eid, pages]) => ({
            entity: { eid },
            tracked: { pages },
          }))
          pending.clear()
          if (made.length) await tx.patch(made)
          return [...bundles, ...made]
        },
      }
    },
  }],
})
const applied = await g.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }])
equal(applied[0].tracked, { pages: 412 })
equal((await g.get(['b1']))[0].tracked, { pages: 412 })
```

## Tools

A **tool** is a named operation whose `run(call, graph)` returns bundles
(`Tool`). The call is a bundle; `argsOf(call)` reads `call.args`, and
`who(call)` reads its actor from `created` or `$actor`.
[@yaks/tools](../tools/README.md) validates calls and applies results as the
caller.

### Structured tool identity

A `Tool` can declare `noun: 'session'` and `verb: 'list'` instead of a flat
name. `toolName(tool)` derives `session_list` from them; `namedTool(tool)`
returns a copy with that name filled in, ready for a transport to list. Either
field may be declared alone — `noun: 'history'` is the tool `history`, one word
on a command line and the same word when a client lists it. Tools that declare
only `name` continue to work. The core stores this metadata but does not parse
CLI arguments or run a command framework of its own.

`inputSchema` is a JSON Schema for the complete arguments object. The
per-argument `input` object is also accepted; do not supply both. See
[`@yaks/vocab` tool declarations](../vocab/README.md#tools) for the shared
validation and the optional positional and short-flag presentation. A tool's
noun is unrelated to any graph component name.

<a id="the-generic-tiers-own-tool-declarations"></a>

### Built-in tool declarations

`@yaks/graph/vocab` contains the declarations for `graph apply`, `graph query`,
`graph show`, `graph schema`, and `search`. Their implementations live in
`@yaks/graph/tools`; [@yaks/mcp](../mcp/README.md) exposes them through its
`core` helper. `search` is included only when a ranked search function is
supplied. These declarations add no components to the graph.

```ts
import { argsOf, namedTool, offered, who } from '@yaks/graph'
import { graphDoc } from '@yaks/graph/vocab'
import { loadTools, tier } from '@yaks/graph/tools'
import { equal } from '@yaks/testing'

const tool = namedTool({
  noun: 'book',
  verb: 'list',
  description: 'List books',
  run: () => [],
})
equal(tool.name, 'book_list')
equal(offered('mcp')({ surfaces: ['cli'] }), false)
const call = {
  entity: { eid: 'c1' },
  call: { args: { q: '.book' } },
  $actor: { by: 'ada' },
}
equal(argsOf(call).q, '.book')
equal(who(call), { by: 'ada' })
equal(graphDoc.$defs?.graph_query.tool, true)
equal(tier().some((t) => t.name == 'search'), false)
const tools = loadTools({
  $defs: {
    book_list: {
      tool: true,
      noun: 'book',
      verb: 'list',
      description: 'List books',
      inputSchema: { type: 'object' },
    },
  },
}, { book_list: () => [] })
equal(tools[0].name, 'book_list')
```

`loadTools(docs, runs)` joins declarations to implementations and refuses a
missing implementation. Its lazy form fetches implementations on first call.
`runs(seams)` implements built-in operations; `tier(seams)` pairs them with
`graphDoc`. The `graph_apply` implementation returns proposed bundles for the
runner to apply. `search` is included only when `seams.search` is supplied.

## Rules

`Plugin.rules` contains `Rule` values evaluated over the entities a batch names
at a chosen phase. Their `produce` or `run` writes to the matched entity. All
rules in that phase see the same state before their output is written.

A **resource** is a singleton built from the phase context and bound by `#Name`
(`Resource`). A resource is built only when requested; its name must start with
a capital letter. The graph supplies `#Vocab`, `#Now`, and `#Actor`. `stands()`
gives a resource the value it writes into a property. Resources are read-only
and cannot appear on the value side of a match comparison: read them in `run()`.

A rule's `*comp` clauses declare its **write set**, the components its output
may write. A rule with a write set is refused if it writes outside it. In the
`effect` phase, one of these components must also occur in the batch for the
matched entity. A rule without a write set is unchecked.

`Plugin.declared` contains `Declared` values whose query supplies the writes.
These run in the `rules` phase through `Tx.bindings`, over stored data with the
pending patches folded in. They can join multiple entities and react to each
other's output.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

g.use({
  name: 'pages',
  rules: [{
    name: 'default-pages',
    phase: 'rules',
    match: '.book, !book.pages, *book',
    run: () => ({ book: { pages: 1 } }),
  }],
})
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune' } }])
equal((await g.get(['b1']))[0].book, { title: 'Dune', pages: 1 })
```

## Rules over more than one entity

A declared rule can match several entities using
[query patterns](../query/README.md#multi-entity-matches) separated by `;`.
Shared variables join the patterns:

```text
$call .call; .result, result.call=$call
```

`match(source)` parses the rule into a `Match` plan containing patterns,
conditions, and variables. A **binding** is one match result: the eid each
pattern matched and the value each variable took (`Binding`). An adapter's
optional `Tx.bindings` method then evaluates the plan against stored data
together with the pending patches. `[$review .review, review.product=$product]`
attaches a [collection](../query/README.md#multi-entity-matches) of matching
reviews to each product's binding; a product with none keeps an empty
collection. Each member retains its entity ids and variables. Brackets may nest.
The adapter evaluates the match against stored data with pending patches;
`+!comp` requires the component to be absent and adds it. `reads(plan, vocab)`
lists the components that must be included in those sources.

Declared rules require `Tx.bindings`. An adapter without it skips declared
rules. [@yaks/sqlite](../sqlite/README.md) and [@yaks/ram](../ram/README.md)
both implement it, and run the same script of rule scenarios.

`graph({ runs })` chooses which declared rules run on a batch. By default a
graph runs every rule but a page's own: one whose writes are all `sync: none`
components (`own(rule, vocab)`), state only a page holds. A page chooses for
itself ([@yaks/client](../client/README.md#rules)): its own rules, and the
server's rules marked `optimistic`.

```ts
import { graph, invoked, match, reads } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true },
    review: {
      component: true,
      properties: {
        book: { type: 'string', ref: 'book' },
        stars: { type: 'number' },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
await g.apply([{ entity: { eid: 'b1' }, book: {} }])
const made = await invoked(
  g.outside,
  vocab,
  '$b .book; +review.book=$b, +review.stars=$stars',
  { stars: 5 },
)
equal(made[0].review, { book: 'b1', stars: 5 })
equal(await g.read('.review'), [])
await g.apply(made)
const plan = match('$b .book; [$r .review, review.book=$b]')
const [bindings] = await g.outside.bindings!([plan], [], reads(plan, vocab))
equal(bindings[0].vars, { b: 'b1' })
equal(bindings[0].collections?.[0].members[0].vars, {
  b: 'b1',
  r: made[0].entity.eid,
})
```

### A rule with no code at all

A plugin's `declared` list supplies rule names, match queries, and optional
`before` dependencies. Given a graph `g` whose vocabulary declares `product` and
`shelf.aisle`, register:

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    product: { type: 'object', component: true },
    shelf: {
      type: 'object',
      component: true,
      properties: { aisle: { type: 'string' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

g.use({
  name: 'shop',
  declared: [{
    name: 'unshelved',
    match: '.product, +!shelf, +shelf.aisle=Z',
  }],
})
await g.apply([{ entity: { eid: 'p1' }, product: {} }])
equal(await g.read('.shelf'), [{
  entity: { eid: 'p1' },
  shelf: { aisle: 'Z' },
}])
```

This matches a product without a shelf, then adds `shelf: { aisle: 'Z' }`. Rules
are evaluated during the `rules` phase. A `+` or `*` clause can specify a
property and value, such as `+result.call=$call`. Literal values are parsed
using the declared property type, `$name` reads a bound variable, and `#Name`
reads a registered resource.

A pattern containing only write clauses creates an entity. Its id is derived
from the rule name and matched entity ids, so repeated evaluation of the same
match identifies the same created entity.

Generated patches join the pending batch and every rule is evaluated again,
allowing one rule to react to another's output. A rule may fire only once per
`(rule name, matched entities)` in one application. If it matches again, the
transaction is refused with the rule name and binding. Write the match so its
own output makes it stop matching, as `+!shelf` does above.

Declared rules run alphabetically by name, adjusted for `before` dependencies.
Registration order does not determine their order; cyclic dependencies are
rejected. Rules can also come from vocabulary documents. Declarations without a
phase, or with `phase: 'rules'`, run here; other phases need their corresponding
runner.

### Templates

A **template** is a declared rule with its variables supplied by the caller.
`filled(match, args)` binds arguments into its match plan:

```ts
import { filled } from '@yaks/graph'
import { equal } from '@yaks/testing'

equal(filled('+foo.bar=$x', { x: 5 }).patterns[0].sets[0].value, {
  kind: 'scalar',
  raw: '5',
})
equal(filled('$p .product, +!sale', { p: 'p1' }).vars, [])
```

A bound variable in a match clause constrains that property. In a write clause
it supplies the value to write. Arguments can also be a query string containing
bindings.

`invoked(tx, vocab, template, args)` evaluates the bound plan once, with no
pending patches, and returns generated bundle patches for the caller to apply.
It does not write them itself and returns an empty array if `tx.bindings` is
unavailable. Rules running in the graph's pipeline instead add their patches to
the current batch: those patches receive admission checks, mutation, cascading
reference handling, stamps, and journaling alongside the caller's bundles.

## Admission and schema checks

Core admission rejects undeclared components and properties, casts string
properties, and checks vocabulary types and enum values. It drops
[stamped and computed properties](../vocab/README.md#property-types-and-checks)
from ordinary writes. `Refused` reports invalid writes; `status(error)` maps
named errors to HTTP status codes (`Stale` is 409; an unlisted error is 500).

`admitSchema(vocab)` adds full JSON Schema checks for properties with
`validate: true`, required values on affected components, tree constraints, and
numeric constraints. Register it after any other `beforeWrite` plugins that
could rewrite checked values.

`graph.admit(bundles, opts)` checks a value through the ordinary write pipeline
without retaining it. It normalizes and addresses the submitted patches, checks
requests, `$was`, permission hooks, rules, and complete proposed values through
`beforeWrite`. It returns the checked patches composed by entity, including rule
outputs, rewrites and stamps. A host forwards values from this result, so its
peers receive what the pipeline checked. Effects do not run.

The optional `overlay` contains canonical peer values the host already admitted.
Partial patches are checked against those complete values. On a stored entity,
precondition hooks see its held peer values alongside committed ownership;
`$was` checks the committed values before the overlay. An overlay does not make
an unstored entity exist for permission checks.

```ts
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    point: {
      component: true,
      sync: 'peers',
      type: 'object',
      required: ['x', 'y'],
      properties: {
        x: { type: 'number', minimum: 0, validate: true },
        y: { type: 'number', validate: true },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab, plugins: [admitSchema(vocab)] })
const patch = { entity: { eid: 'p1' }, point: { x: 2 } }
equal(
  await g.admit([patch], {
    overlay: [{ entity: { eid: 'p1' }, point: { x: 1, y: 3 } }],
  }),
  [{ entity: { eid: 'p1' }, point: { x: 2, y: 3 } }],
)
equal(await g.get(['p1']), [])
```

A plugin's `admission(bundles)` certifies that its hooks, rules and tracker
through stamping can run against temporary rows without lasting state or
external side effects, and that its journal and commit work add no refusal.
Admission runs those same checks against a temporary transaction whose `get`
sees preceding patches. Plugins with mutation-dependent checks that need the
adapter's queries, and plugins without the relevant certification, use the
adapter's ordinary dry run instead. Every hook receives
`context.admission: true` on both paths, including audit hooks, so admission
bookkeeping can stay temporary. Ordinary writes and `apply({check: true})`
receive `false`.

```ts
import { graph, Refused, status } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string', validate: true, minLength: 2 },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab, plugins: [admitSchema(vocab)] })
let refusal = 0
try {
  await g.apply([{ entity: { eid: 'b1' }, book: { title: 'D' } }])
} catch (error) {
  if (!(error instanceof Refused)) throw error
  refusal = status(error)
}
equal(refusal, 400)
equal(await g.get(['b1']), [])
await g.apply([{ entity: { eid: 'b1' }, book: { title: 42 } }])
equal((await g.get(['b1']))[0].book, { title: '42' })
```

`schemaOf(vocab, about?)` returns a vocabulary document, and
`proseOf(vocab, about?, guide?)` describes the same declarations as Markdown.
Omit `about` for the component index, pass `{comps: ['book']}` for complete
entries, or `{kind: 'book'}` for a kind and the components it is shown with.

```ts
import { proseOf, schemaOf } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      kind: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
    },
  },
})
equal(schemaOf(vocab, { comps: ['book'] }).$defs.book.examples, [{
  title: '…',
}])
equal(proseOf(vocab, { kind: 'book' }).startsWith('# book'), true)
```

## Stamps and actors

The `stamp` phase fills `created` once, `updated` on subsequent writes, and
[marks](../vocab/README.md#vocabulary) when first written. These components must
be declared in the vocabulary. `now` or `clock` supplies the timestamp;
`graph({ provenance })` can choose per-entity attribution while retaining the
stamp mechanism. Trusted writes with `stamp: false` skip core stamps and marks,
while plugin rules, hooks, validation, journaling, and effects still run.

```ts
import { graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, type: 'object' },
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', stamped: true },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
await g.apply(signed([{ entity: { eid: 'b1' }, book: {} }], { by: 'ada' }), {
  now: '2026-01-01T00:00:00.000Z',
})
equal((await g.get(['b1']))[0].created, {
  at: '2026-01-01T00:00:00.000Z',
  by: 'ada',
})
```

## Patch helpers and field edits

`comps`, `dead`, `gives`, and `tombstoned` inspect or construct bundles.
`composed` combines patches into one bundle per entity for an applied result,
stripping request keys except `$alias`. `coalesced` and `coalescer` combine
unsent component patches while retaining a clear before a later partial patch.

```ts
import { coalesced, composed } from '@yaks/graph'
import { equal } from '@yaks/testing'

const bundles = [
  { entity: { eid: 'b1' }, book: { title: 'Dune' }, $actor: { by: 'ada' } },
  { entity: { eid: 'b1' }, book: { pages: 412 } },
]
equal(composed(bundles), [{
  entity: { eid: 'b1' },
  book: { title: 'Dune', pages: 412 },
}])
equal(
  coalesced([
    ...bundles,
    { entity: { eid: 'b1' }, book: null },
    { entity: { eid: 'b1' }, book: { pages: 1 } },
  ]),
  [
    { entity: { eid: 'b1' }, book: null },
    { entity: { eid: 'b1' }, book: { pages: 1 } },
  ],
)
```

An **edit hunk** replaces `old` text with `new` text, requiring one match unless
`all: true` (`EditHunk`). `patchText` applies hunks and refuses missing,
ambiguous, or unchanged text. A **field operator** is a property value with a
`$` key, such as `{ $edit: { old: 'Dune', new: 'DUNE' } }`.
`resolveEdits(bundles, host)` resolves field operators and adds `$was` for the
stored value; `edits(host)` registers it as a normalize hook. The host must keep
its reads stable through commit, using an enclosing write transaction when
backed by a database.

```ts
import { patchText, resolveEdits, token } from '@yaks/graph'
import { equal } from '@yaks/testing'

equal(patchText('Dune', [{ old: 'Dune', new: 'DUNE' }], 'book.title'), 'DUNE')
equal(
  resolveEdits([{
    entity: { eid: 'b1' },
    book: { title: { $edit: { old: 'Dune', new: 'DUNE' } } },
  }], {
    component: () => ({ title: 'Dune' }),
    text: (comp, prop) => comp == 'book' && prop == 'title',
    known: (comp) => comp == 'book',
  }),
  [{
    entity: { eid: 'b1' },
    book: { title: 'DUNE' },
    $was: { book: { title: token('Dune') } },
  }],
)
```

## Transient text

A **transient frame** is an ordered `begin`, `append`, or `end` update for an
existing text property (`TransientFrame`). `transient(g)` keeps one registry per
graph and substitutes live text after durable queries select their bundles.
Appends write no storage; `checkpoint()` writes with `$was`, `commit()` also
ends the projection, and `discard()` returns to the durable value.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })

const { transient } = await import('@yaks/graph')
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune' } }])
const writer = await transient(g).begin('b1', 'book', 'title', 'w1')
writer.append(' notes')
equal((await g.read('.book'))[0].book, { title: 'Dune notes' })
equal((await g.read('.book', { durable: true }))[0].book, { title: 'Dune' })
await writer.commit()
equal((await g.get(['b1']))[0].book, { title: 'Dune notes' })
equal(transient(g).snapshots(), [])
```

Only one transient writer may own a property. Sequence gaps fail; duplicate
frames are ignored. Finalized writer ids remain reserved for the graph's
lifetime. Text is limited to 16 Mi UTF-16 code units. Query membership,
aggregates, and predicates use durable data. See [TRANSIENT.md](TRANSIENT.md)
for transport and subscription requirements.

## Ownership and composition

`Access` is the data interface (`vocab`, `read`, `rows`, `get`, `apply`,
`outside`) for consumers whose graph may be owned by another thread. `outside`
is a `ReadTx` for committed reads and bindings; writes use `apply`. `WriteOpts`
carries write data options; trace callbacks and deferred effects stay on the
local `Graph`.

The graph chooses no database, declares no domain components, and implements no
authentication or authorization. Compose it with:

- [@yaks/vocab](../vocab/README.md) for vocabulary loading.
- [@yaks/ram](../ram/README.md), [@yaks/sqlite](../sqlite/README.md),
  [@yaks/d1](../d1/README.md), or
  [@yaks/durable-object](../durable-object/README.md) for storage.
- [@yaks/client](../client/README.md) for local state and live queries.
- [@yaks/api](../api/README.md) for HTTP and WebSocket operations.
- [@yaks/render](../render/README.md) for view selection.

The core uses Web APIs available in browsers, workers, and server runtimes.
Storage and plugins may have narrower runtime requirements.
