# @yaks/ram

An in-memory storage adapter for [@yaks/graph](../graph/README.md). It keeps
entities in a JavaScript `Map` and evaluates queries with
[@yaks/match](../match/README.md), without a database or index. Use it for
tests, browser state, or a local copy of server data. Discarding the store loses
its contents; persistence must be supplied separately.

A **bundle** is one entity's components as a JSON object, including its identity
under `entity`, for example `{ entity: { eid: 'b1' }, book: { pages: 412 } }`. A
**batch** is a list of changes applied in one transaction. The graph accepts a
batch of bundle patches through `apply()`; this adapter provides their storage.
See the [graph architecture](../graph/ARCHITECTURE.md) for the write phases.

## Install

```sh
deno add jsr:@yaks/ram jsr:@yaks/graph jsr:@yaks/vocab
# Node projects can use: npx jsr add @yaks/ram @yaks/graph @yaks/vocab
```

## Use

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'

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
await g.apply([
  { entity: { eid: 'b1' }, book: { title: 'Dune', pages: 412 } },
])
console.log(await g.read('.book.pages>300'))
```

The adapter's reads and writes are synchronous. A graph using it also runs
synchronously when its plugins do; `await` works with either return form.

You can use the adapter directly, but `tx.patch()` bypasses graph validation,
`$was` preconditions, reference-deletion rules, plugins, and provenance stamps:

```ts
const store = ram(vocab)
store.tx((tx) => tx.patch([{ entity: { eid: 'b1' }, book: { pages: 412 } }]))
console.log(store.read('.book'))
```

## API

The root export provides `ram` and the types `Store`, `Tx`, `RamOpts`, and
`Query`. There are no sub-module exports.

`ram(vocab, options?)` returns a `Store` implementing the graph's `Storage`
interface:

| Method               | Result                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `ddl()`              | An empty array; there is no database schema to create.                                   |
| `install()`          | Does nothing.                                                                            |
| `read(query, opts?)` | Matching bundles, ordered and paginated as requested.                                    |
| `rows(query, opts?)` | One `{ eid }` row per match, or a single `{ value: '', n }` row for `.count!`.           |
| `tx(body)`           | The callback's result; commits on success and rolls back on a throw or rejected promise. |

A transaction provides `read`, `get(eids)`, `patch(bundles)`, `evict(eids)`, and
`remove(entities)`. `get` returns complete stored bundles, includes tombstones,
and omits unknown ids. `patch` returns the identities it created. `evict`
removes live component data while reserving the identity for later reuse;
`remove` permanently tombstones the entity. Eviction does not remove tombstones.

Options are:

- `now`: reference time for relative time expressions in queries. A read's
  `opts.now` overrides it.
- `number`: enable automatic numbering with `true`, or exclude specified
  components with `{ except: ['componentName'] }`. Numbering is off by default.
- `adopt`: accept numbers supplied by another store. Off by default. See below
  for how this interacts with `number`.

### Writes are patches

- An omitted column keeps its value.
- A column set to `null` is cleared.
- A component set to `null` is removed, leaving the entity's identity.
- Undeclared and computed columns are not stored.
- A tombstoned entity cannot receive component patches or be recreated.

### Identity, and `num`

`entity.eid` is the identity. `entity.num` is an optional display number.
`patch` creates an identity for every eid the write names or references,
allowing references to entities created later in the same batch.

With `number: true`, new identities receive sequential numbers starting at 1, in
first-reference order. Rollback restores the counter. With
`number: { except: [...] }`, entities carrying an excluded component remain
unnumbered; adding that component also removes an existing number.

`adopt: true` accepts a supplied number as a correction to an existing identity.
For a new identity, it adopts the supplied number only when numbering is
enabled; without `number`, that new identity initially contains only its eid. A
client that needs server numbers on the first incoming patch can use
`ram(vocab, { number: true, adopt: true })`. Locally created entities then
receive provisional numbers that later server responses can correct.

### Rollback

Transactions record previous entity records and restore them on failure, along
with the number counter and any evicted identity reservations. Nested
transactions act as savepoints: an inner rollback undoes only its changes, and
an outer rollback also undoes successful inner transactions. The undo log covers
only changed records, without copying the entire store.

## Differences from a database adapter

RAM returns the columns that were written, whereas a SQL adapter can return
`null` for declared columns that have never been written. Missing and `null`
values have the same meaning in query matching. RAM also preserves JavaScript
value types; a SQL adapter may return an integer for a stored boolean.

Unsupported queries throw `Unsupported` from `@yaks/match`. Examples include
`.tally`, `.distinct`, `.near`, `.edges!`, and computed columns. Count is
available through `rows()`, not `read()`. See the
[matcher documentation](../match/README.md) for the supported subset. Text
search matches tokens in stored text without a full-text index or relevance
ranking; it does not promise the tokenization of every database's full-text
engine.

RAM does not implement `Tx.bindings`, so the graph's multi-entity declarative
rules are skipped with this adapter. Ordinary graph hooks and per-entity rules
still run.

## Compatibility

Pure TypeScript, with no Deno, Node, or DOM-specific imports. The adapter is
checked with `lib: ["dom", "esnext"]` and can run in browsers and server
JavaScript runtimes. Its runtime dependencies are `@yaks/graph`, `@yaks/match`,
and `@yaks/query`; `@yaks/vocab` supplies schema types.

## License

Apache-2.0
