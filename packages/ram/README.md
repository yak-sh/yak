# @yaks/ram

Synchronous in-memory [Storage](../graph/README.md#data-model) for
[@yaks/graph](../graph/README.md). It holds
[bundles](../graph/README.md#data-model) in a JavaScript `Map` and answers
[queries](../query/README.md#query-model) with
[@yaks/match](../match/README.md). Use it for tests, browser state, or a local
copy of server data. Discarding it loses its contents.

A **store** is the synchronous Storage returned by `ram(vocab, options?)`, bound
to one [vocabulary](../vocab/README.md#vocabulary) (`Store`). Its writes run in
[transactions](../graph/README.md#data-model); reads need no `await`.

## Use

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
g.install()
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune', pages: 412 } }])
equal((await g.read('.book.pages>300'))[0].book, { title: 'Dune', pages: 412 })
```

The store's reads and writes are synchronous. A graph using it also runs
synchronously when its plugins do; `await` works with either return form.

## Install

```sh
deno add jsr:@yaks/ram jsr:@yaks/graph jsr:@yaks/vocab
# Node projects can use: npx jsr add @yaks/ram @yaks/graph @yaks/vocab
```

## Exports

| Export    | Purpose                                                     |
| --------- | ----------------------------------------------------------- |
| `ram`     | Construct a store over an empty Map.                        |
| `Store`   | Synchronous Storage interface.                              |
| `Tx`      | Store transaction interface.                                |
| `RamOpts` | Construction options: `now`, `number`, `adopt`, `computed`. |
| `Query`   | Query input type from @yaks/match.                          |

The root module is the only export path.

## Reads

| Method                       | Result                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `install()`                  | Does nothing; a Map has no schema to install.                                          |
| `read(query, opts?, comps?)` | Matching bundles, with ordering and pagination; `comps` restricts returned components. |
| `rows(query, opts?)`         | One `{ eid }` per match, or aggregate results for `.count`, `.distinct`, `.tally`.     |
| `get(eids, comps?)`          | Stored bundles for those eids; unknown eids omitted, tombstones included.              |
| `worn(comp, prop)`           | Whether a property's value implies that its entity carries the component.              |
| `tx(body)`                   | Callback result; commits on success, rolls back on throw or rejected promise.          |

`worn` returns false for undeclared properties, computed properties, and
properties overridden by `computed`. `read` and `get` add computed values before
restricting returned components. Stored bundles are replaced rather than mutated
by writes, and a write that changes nothing keeps the bundle it found; callers
must not mutate returned bundles.

```ts
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
const store = ram(vocab)
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'b1' }, book: { title: 'Dune', pages: 412 } },
    { entity: { eid: 'b2' }, book: { title: 'Dune Messiah', pages: 256 } },
  ])
)
equal(store.read('.book .order=-book.pages .limit=1')[0].entity.eid, 'b1')
equal(store.rows('.book .count'), [{ value: '', n: 2 }])
equal(store.rows('.book.title=Dune'), [{ eid: 'b1' }])
equal(store.rows('.book .distinct=book.pages'), [{ value: 256 }, {
  value: 412,
}])
equal(store.rows('.book .tally=book.pages'), [
  { value: 256, n: 1 },
  { value: 412, n: 1 },
])
equal(store.get(['b1', 'missing'], ['book']).map((b) => b.book), [
  { title: 'Dune', pages: 412 },
])
equal(store.worn('book', 'pages'), true)
```

The store selects candidates by component and builds value indexes when a query
first asks for equality on text, enum, or reference properties. A **band**
groups numeric values by their floor, such as `10.2` and `10.9` in band `10`.
Numeric range queries build band indexes on demand. Writes and rollback keep
these indexes current; the matcher still checks candidates against the full
query.

`now` supplies the reference time for relative time expressions. Per-read
`opts.now` overrides the construction option:

```ts
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    release: {
      type: 'object',
      component: true,
      properties: { at: { type: 'string', format: 'date-time' } },
    },
  },
})
const store = ram(vocab, { now: Date.parse('2026-01-01T12:00:00Z') })
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'r1' }, release: { at: '2026-01-01T10:00:00Z' } },
  ])
)
equal(store.read('.release.at=today').length, 1)
equal(
  store.read('.release.at=today', {
    now: Date.parse('2026-01-02T12:00:00Z'),
  }).length,
  0,
)
```

## Patches and transactions

Use the graph's `apply` for application writes. Direct `tx.patch` bypasses
validation, [preconditions](../graph/README.md#writes-and-reads),
reference-deletion rules, plugins, and provenance stamps. It follows the
[patch](../graph/README.md#data-model) semantics; undeclared properties are
never stored. Computed properties are stored only when `adopt` is enabled.

A transaction offers `read`, `get`, `patch`, `evict`, `remove`, `revive`, and
`bindings`. `patch` returns identities it creates, including reference targets;
it also returns an existing empty identity when it receives a number.

```ts
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, throws } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      type: 'object',
      component: true,
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
  },
})
const store = ram(vocab)
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'b1' }, book: { title: 'Dune', pages: 412 } },
  ])
)
await throws(() =>
  store.tx((tx) => {
    tx.patch([{ entity: { eid: 'b1' }, book: { pages: 1 } }])
    store.tx((inner) => inner.patch([{ entity: { eid: 'b2' }, book: {} }]))
    throw new Error('cancel')
  })
)
equal(store.get(['b1'])[0].book, { title: 'Dune', pages: 412 })
equal(store.get(['b2']), [])
store.tx((tx) => tx.patch([{ entity: { eid: 'b1' }, book: { title: null } }]))
equal(store.get(['b1'])[0].book, { title: null, pages: 412 })
store.tx((tx) => tx.patch([{ entity: { eid: 'b1' }, book: null }]))
equal(store.get(['b1']), [{ entity: { eid: 'b1' } }])
```

Nested transactions roll back only their own writes on failure; an outer
rollback also undoes successful inner transactions. The undo log keeps previous
bundles for changed entities and restores numbering and identity reservations,
without copying the entire Map. Declared
[unique indexes](../vocab/README.md#identity-and-indexes) are enforced during
writes and restored by rollback.

```ts
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, throws } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      type: 'object',
      component: true,
      properties: { isbn: { type: 'string', unique: true } },
    },
  },
})
const store = ram(vocab)
store.tx((tx) => tx.patch([{ entity: { eid: 'b1' }, book: { isbn: '123' } }]))
await throws(() =>
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'b2' }, book: { isbn: '123' } },
    ])
  )
)
equal(store.read('.book').map((b) => b.entity.eid), ['b1'])
```

### Eviction and deletion

**eviction** (`tx.evict`) removes a live entity's components from the Map and
reserves its identity, including its number, for a later patch. Evicted entities
are absent from `get` and queries. Eviction leaves
[tombstones](../graph/README.md#writes-and-reads) alone.

`tx.remove` replaces an entity's components with a tombstone, keeping its eid
and number. Patches to a tombstoned entity do nothing. `tx.revive` clears the
tombstone, leaving only the identity ready for further patches. The graph
decides when application writes revive entities.

```ts
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: { book: { type: 'object', component: true, properties: {} } },
})
const store = ram(vocab, { number: true })
const write = () =>
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'b1' }, book: {} },
    ])
  )
write()
store.tx((tx) => tx.evict(['b1']))
equal(store.get(['b1']), [])
write()
equal(store.get(['b1'])[0].entity.num, 1)
store.tx((tx) => tx.remove([{ eid: 'b1' }]))
write()
equal(store.get(['b1'])[0].tombstone, {})
store.tx((tx) => tx.revive(['b1']))
equal(store.get(['b1']), [{ entity: { eid: 'b1', num: 1 } }])
write()
equal(store.read('.book').length, 1)
```

## Numbering and adoption

Numbers are off by default. With `number: true`, entities receiving their own
components receive sequential numbers starting at 1; reference-only identities
remain unnumbered until their own components arrive. Rollback restores the
counter. `number: { except: ['componentName'] }` leaves entities carrying those
components unnumbered; adding an excluded component removes an existing number.

`adopt: true` accepts supplied `entity.num` values and stores incoming computed
values. It never generates numbers. For a new identity, adoption requires
`number` to be enabled; an existing identity can receive a supplied number
without `number`.

```ts
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { type: 'object', component: true, properties: {} },
    cache: { type: 'object', component: true, properties: {} },
  },
})
const store = ram(vocab, { number: { except: ['cache'] } })
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'b1' }, book: {} },
    { entity: { eid: 'c1' }, cache: {} },
  ])
)
equal(store.get(['b1', 'c1']).map((b) => b.entity.num), [1, undefined])
store.tx((tx) => tx.patch([{ entity: { eid: 'b1' }, cache: {} }]))
equal(store.get(['b1'])[0].entity.num, undefined)
const copy = ram(vocab, { number: true, adopt: true })
copy.tx((tx) =>
  tx.patch([
    { entity: { eid: 'b1', num: 42 }, book: {} },
    { entity: { eid: 'b2' }, book: {} },
  ])
)
equal(copy.get(['b1', 'b2']).map((b) => b.entity.num), [42, undefined])
```

## Computed properties

`computed` maps `comp.prop` to a function of a bundle and the matcher
[Index](../match/README.md). These functions supply
[computed properties](../vocab/README.md#the-format) for filtering and returned
bundles. The vocabulary's [status ladders](../vocab/README.md#kinds-and-status)
need no function. A query on another computed property without a function throws
`Unsupported`.

```ts
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    lamp: {
      type: 'object',
      component: true,
      properties: {
        watts: { type: 'number' },
        glow: { type: 'string', computed: true },
      },
    },
  },
})
const store = ram(vocab, {
  computed: {
    'lamp.glow': (b) => Number(b.lamp?.watts) > 40 ? 'bright' : 'dim',
  },
})
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'l1' }, lamp: { watts: 60, glow: 'dim' } },
  ])
)
equal(store.read('.lamp.glow=bright')[0].lamp, { watts: 60, glow: 'bright' })
equal(store.worn('lamp', 'glow'), false)
```

The store materializes status both in query results and in `get`:

```ts
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    task: { component: true, status: { completed: 'done', default: 'open' } },
    completed: { component: true },
  },
})
const store = ram(vocab)
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 't1' }, task: {} },
    { entity: { eid: 't2' }, task: {}, completed: {} },
  ])
)
equal(store.get(['t1'])[0].task, { status: 'open' })
equal(store.read('.task.status=done')[0].entity.eid, 't2')
```

## Declared rules

`Tx.bindings` evaluates
[declared rules](../graph/README.md#rules-over-more-than-one-entity) with a
proposed batch temporarily patched into the Map, then rewinds it. Patterns join
on their variables in memory. At least one pattern must match an entity in a
nonempty batch; evaluation uses component and value indexes to find the other
matches.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { type: 'object', component: true, properties: {} },
    shelf: {
      type: 'object',
      component: true,
      properties: { aisle: { type: 'string' } },
    },
  },
})
const g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [{
    name: 'shelving',
    declared: [{ name: 'unshelved', match: '.book, +!shelf, +shelf.aisle=Z' }],
  }],
})
await g.apply([{ entity: { eid: 'b1' }, book: {} }])
equal((await g.get(['b1']))[0].shelf, { aisle: 'Z' })
```

## Limits

There is no persistence or process boundary; use
[@yaks/sqlite](../sqlite/README.md) for SQLite storage. RAM returns properties
that were written, whereas SQL storage can return `null` for unwritten
properties. Missing and `null` values match the same way. RAM preserves
JavaScript value types; SQL storage may return an integer for a stored boolean.

Unsupported queries throw `Unsupported` from @yaks/match: examples include
`.near`, `.edges`, and computed properties without a function. Aggregates use
`rows`, rather than `read`. See the [matcher](../match/README.md) for the
supported subset. Text search matches tokens in stored text without a full-text
index or relevance ranking; tokenization can differ from a database's full-text
engine.

The package is pure TypeScript with no Deno, Node, or DOM-specific imports and
can run in browsers and server JavaScript runtimes. Its runtime dependencies
include @yaks/graph, @yaks/match, and @yaks/fp; @yaks/vocab supplies schema
types.

## License

Apache-2.0
