# @yaks/ram

An in-memory [@yaks/graph](../graph/README.md) storage adapter backed by a Map.
It evaluates queries with [@yaks/match](../match/README.md) and requires no
database. State is lost when the store is discarded; use a persistent adapter or
client persistence when data must survive a restart.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/ram
# or: npx jsr add @yaks/ram
```

## Use

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'

let vocab = loadVocab({
  $defs: {
    entity: { type: 'object', wire: false, properties: {} },
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    book: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        pages: { type: 'number' },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})

let g = graph({ storage: ram(vocab), vocab })

g.apply([
  { entity: { eid: 'a1' }, doc: { title: 'Ursula Vale' } },
  {
    entity: { eid: 'b1' },
    doc: { title: 'Dune' },
    book: { pages: 412, author: 'a1' },
  },
])

g.read('.pages>300') // → the bundles, no await
```

Nothing here returns a promise, so a browser page can run a query during a
render and a test can write a whole corpus in one line.

You can also use the store on its own, without a graph — but then you are
patching rows rather than applying changes, and none of the rules `apply()` owns
(admitting columns, checking `$was`, cascading deletes, recording provenance)
are applied:

```ts
import { ram } from '@yaks/ram'

let store = ram(vocab)
store.tx((tx) => tx.patch([{ entity: { eid: 'b1' }, book: { pages: 412 } }]))
store.read('.kind=book')
```

## API

```ts
ram(vocab, base?) // bind a store to a vocabulary
```

returns a `Store` — @yaks/graph's `Storage`, implemented synchronously:

- `ddl(): string[]` — `[]`. A Map has no schema.
- `install(): void` — a no-op, for the same reason. Both are here so a caller
  can swap this adapter for a database one without changing a line.
- `read(query, opts?): Bundle[]` — a query → the matching entities as bundles,
  ordered and windowed as the query asks.
- `rows(query, opts?): Row[]` — one raw `{ eid }` row per match, the same shape
  a database adapter returns; `.count!` returns the single `{ value: '', n }`
  row @yaks/sql returns.
- `tx(body): R` — run `body` against a transaction, committing when it returns
  and rolling back if it throws. Transactions nest: an inner one rolls back to
  where it opened, and an outer rollback still undoes what it committed. The
  transaction offers:
  - `read(query, opts?): Bundle[]` — as above.
  - `get(eids): Bundle[]` — lookup by id, not search: these entities, whole. A
    deleted one comes back with a `tombstone` component; an unknown one is
    absent.
  - `patch(bundles): Entity[]` — apply these patches → the entities they
    CREATED, each with the `num` it was given.
  - `remove(entities): void` — drop their components and tombstone them.

`base` (and a per-call `opts`) carries `now`, the moment a relative time phrase
in a query resolves against, and `adopt`.

### Writes are patches

- **omitted columns are untouched** — a patch names only what changes,
- **a column set to `null` is cleared**,
- **a component set to `null` is dropped** — the entity stays,
- **a tombstoned entity takes no patch** — death is final; ids never recycle.

### Identity, and `num`

Identity belongs to storage. `patch` creates a record for every eid the write
touches **or points at** — so a reference may name a target the same write
creates, in any order — and numbers each new one in the order it was first
touched, starting at 1. `num` is therefore always present, which is what makes
`.limit`/`.after` paging and `.order` mean the same thing here as against a
database. A rolled-back write releases the numbers it took.

`ram(vocab, { adopt: true })` reverses that: a patch whose identity already
carries a `num` keeps it, and an entity this store numbered itself accepts the
correction when one arrives. That is what a store MIRRORING another graph needs
— a page using [@yaks/sync](https://jsr.io/@yaks/sync) is told its identities by
the server rather than assigning them — so a recipe has the same number in the
browser as it has in the database. Off by default: a store that mirrors nothing
owns its own numbering.

### Rollback

A record is never mutated in place: a patch builds the next record and puts it
in the map. So the transaction keeps an **undo log** — one entry per entity it
is about to change, holding that entity's previous record — and rolls back by
replaying it backwards (and restoring the number counter). Nothing the write did
not touch is copied, so a rollback costs what the write changed, not what the
map holds.

## Differences from a database adapter

There are two, and both come from the map being simpler than a database rather
than the adapter being lax:

- **A read returns the columns that were written.** A database reads back every
  declared column, with `null` for the ones never written; the map holds what it
  was given. A missing column and a `null` one mean the same thing in this model
  — including to `@yaks/match`, which is what answers the queries — so no query
  can tell them apart.
- **A value keeps its type.** A boolean stays `true`, where a database column
  with integer affinity reads back as `1`.

A query these reads cannot answer exactly — an aggregate other than a count
(`.tally`, `.distinct`), a nearest-neighbour search (`.near`), the `.edges!`
clause, a computed column — throws `@yaks/match`'s `Unsupported`, the same error
`@yaks/sql` throws; that package's README lists every case. There is no
full-text index either: a bare word is matched token by token over the text the
bundles hold, which selects what an index over the same words would select,
without the ranking.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno`, no Node built-in, no
DOM global — and type-checks under `lib: ["dom", "esnext"]`, so it runs
unchanged in a **browser**, on **Deno**, and on **Node** (via JSR / npm). Its
only dependencies are the sibling packages: `@yaks/graph`'s `Storage` interface
and bundle types, `@yaks/match` for the reads, and a `@yaks/vocab` schema.

## License

Apache-2.0
