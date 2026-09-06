# @yaks/journal

Who wrote what, when — attribution and history for a
[@yaks/graph](https://jsr.io/@yaks/graph), with undo and a delta feed falling
out of the same record.

## Install

```sh
deno add jsr:@yaks/journal
# or: npx jsr add @yaks/journal
```

## Why

Take a page several people edit. Somebody renames it, somebody else rewrites a
paragraph, somebody deletes a note attached to it. Afterwards the page holds
only where it ENDED UP — which is exactly the question a graph answers well and
exactly the question nobody is asking. Who changed the title? What did it say
before? Put that back.

## What it records

A `journal` plugin hooks two phases of `apply()`. At `precondition` it reads the
state the batch is about to change; at `journal`, inside the same transaction,
it replays the batch as applied against that reading and writes down what moved
— as two components of its own:

| component                                              | one per                                  |
| ------------------------------------------------------ | ---------------------------------------- |
| `batch{seq, at, by, via}`                              | committed batch                          |
| `delta{seq, ord, target, comp, column, before, after}` | column that moved, component that didn't |

They are ordinary components, so the log is queried with the same grammar as
everything else and stored by whatever adapter the graph is bound to — SQLite, a
Durable Object, a Map in a browser tab. Because the writing happens inside the
transaction, a batch that was refused leaves no trace and a batch that committed
always has one.

A delta names its batch by `seq` — the total order and the cursor at once — so a
page of batches and every delta in it are two reads over a range, however many
entities the batches touched. `ord` is the order within a batch, written down
rather than left to whatever order an adapter returns rows in.

## What it answers

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { history, journal, journalDoc, since, undo } from '@yaks/journal'

let vocab = loadVocab([journalDoc, pages])
let g = graph({ storage: ram(vocab), vocab, plugins: [journal(vocab)] })

g.apply([
  { entity: { eid: 'p1' }, page: { title: 'Kickoff' }, $actor: { by: 'ada' } },
])
g.apply([
  { entity: { eid: 'p1' }, page: { title: 'Retro' }, $actor: { by: 'bo' } },
])

history(g)('p1')
// [ { seq: 1, at: '…', by: 'ada', via: null, deltas: [
//       { target: 'p1', comp: 'page', column: null,    before: null, after: {} },
//       { target: 'p1', comp: 'page', column: 'title', before: null,
//         after: 'Kickoff' } ] },
//   { seq: 2, …, by: 'bo', deltas: [ { …, before: 'Kickoff',
//                                      after: 'Retro' } ] } ]

undo(g)(2) // the title is 'Kickoff' again — and that is batch 3
since(g)({ seq: 0 }) // { batches, cursor }
```

- **`history(src)(eid)`** — every batch that touched one entity, oldest first,
  each with its actor, its moment, and the deltas about that entity.
- **`undo(g)(seq)`** — the inverse of a batch, applied through the graph, so an
  undo is admitted, stamped and journaled like any other write and undoing it
  again is a redo. A batch that deleted an entity is refused (`Final`): a
  deleted entity is tombstoned, never erased, and its id can never be reused.
- **`since(src)(cursor)`** — the batches after a cursor and the cursor that
  follows them. `applied(batch)` turns one back into the bundles it committed,
  which is what a server recasts to its subscribers; a consumer that stores the
  cursor BEFORE it does the work drives effects at most once.

`src` is anything that answers a query with bundles — a `Graph`, a `Storage`, a
client cache — so the reading half needs no privileged access to the writing
half.

## The choices worth knowing

- **The provenance stamps are not recorded twice.** `created` and `updated`
  repeat, column for column, what the batch row already holds, so they are
  skipped by default (`skip` says otherwise).
- **A death is recorded whole**: every component the entity carried, with what
  it held, and then the `tombstone` it now wears. History outlives the entity —
  `delta.target` keeps its reference past the target's death.
- **It is not a backup.** It records what moved, not the whole entity, so a
  graph journaled from its first write can answer anything and one that started
  journaling later answers from there on.
- **One reading per batch.** A batch that already carries a `$prior` reading — a
  second journal, a plugin that read first — keeps it.
  [@yaks/effects](https://jsr.io/@yaks/effects) takes a lighter reading of its
  own (component names, no values), which a journal cannot use; the two do not
  disturb each other.

## Compatibility

Browser-compatible: no platform API, no Deno or Node namespace. Synchronous over
a synchronous storage adapter, a promise over an asynchronous one — the same
sync pass-through the rest of the stack has.
