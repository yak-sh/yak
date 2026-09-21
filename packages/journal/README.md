# @yaks/journal

A graph plugin that records every committed batch in three append-only tables
beside the graph's own. It answers entity history, a cursor-based change feed,
and undo. Rows are written inside the graph's own transaction.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/journal
# or: npx jsr add @yaks/journal
```

## Use cases

Use the journal to inspect who changed an entity and its previous values,
reverse a supported batch, or consume changes incrementally. History starts when
the plugin is enabled; it does not reconstruct earlier changes.

## What it records

The plugin hooks one phase of `apply()`: at `journal`, inside the transaction
that just wrote, it records the batch AS APPLIED.

| table            | one row per                                 |
| ---------------- | ------------------------------------------- |
| `journal_tx`     | committed batch — its id is the total order |
| `journal_change` | component the batch patched or removed      |
| `journal_field`  | column that change wrote — its after-image  |

The tables are OFF the spine: no entity, no minted id, never in a bundle or a
client cache. They hold AFTER-IMAGES only — what a write left, never both sides
of it. The before-value a history read wants is derived from the entity's own
slice of the log, bounded to one entity and never a scan, which is what keeps
the log a third of the size of one that stores both sides. Because the writing
happens inside the transaction, a batch that was refused leaves no trace and a
batch that committed always has a row.

Nothing is read in order to write, so there is no precondition phase and nothing
rides forward on the batch. The host is one function wide — `rows(sql, params)`
— and the journal owns no transaction of its own: the caller owns it.

## In a host

`@yaks/journal/rules` is the facet a config-composed host takes: it raises the
three tables through the host's own connection and returns the plugin that
writes them. `./tools` is the other half — the run behind `history`, reading the
tables `./rules` writes. `./vocab` declares no COMPONENT: the journal appears in
no snapshot, it is the record OF the wire, not part of it. The one word it says
is that tool.

```json
{ "plugins": ["@yaks/kernel", "@yaks/journal"] }
```

```sh
yak history T-5 -n 10
```

Every batch that touched the entity, newest first, each as the patch it applied
— the components it wrote, or `$delete` for a death — stamped with
`updated{at, by, via}`. Bundles, so the command line and `/mcp` answer the same
thing.

## What it answers

```ts
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { ddl, journal, log, undo } from '@yaks/journal'

db.exec(ddl())
let j = log({ rows: (sql, p) => db.prepare(sql).all(...p) })
let g = graph({ storage: store, vocab, plugins: [journal(j)] })

g.apply([
  { entity: { eid: 'p1' }, page: { title: 'Kickoff' }, $actor: { by: 'ada' } },
])
g.apply([
  { entity: { eid: 'p1' }, page: { title: 'Retro' }, $actor: { by: 'bo' } },
])

j.history('p1')
// [ { seq: 1, at: '…', by: 'ada', via: null, deltas: [
//       { target: 'p1', comp: 'page', column: null,    before: null, after: {} },
//       { target: 'p1', comp: 'page', column: 'title', before: null,
//         after: 'Kickoff' } ] },
//   { seq: 2, …, by: 'bo', deltas: [ { …, before: 'Kickoff',
//                                      after: 'Retro' } ] } ]

undo(g, j)(2) // the title is 'Kickoff' again — and that is batch 3
j.since(0) // every batch after the cursor, oldest first
```

- **`j.history(eid)`** — every batch that touched one entity, oldest first, each
  with its actor, its moment, and the deltas about that entity.
- **`undo(g, j)(seq)`** — the inverse of a batch, applied through the graph, so
  an undo is admitted, stamped and journaled like any other write and undoing it
  again is a redo. Every restored column carries a `$was` guard, so a column
  somebody else has moved since refuses the reversal. A batch that deleted an
  entity is refused (`Final`): a deleted entity is tombstoned, never erased, and
  its id can never be reused.
- **`j.since(cursor)`** — the batches after a cursor, oldest first, with `j.at`
  and `applied(batch)` turning one back into the bundles it committed, which a
  server can send to its subscribers; a consumer that stores the cursor BEFORE
  it does the work drives effects at most once.
- **`j.before(eid, seq)`**, **`j.wrote(comp, column)`**, **`j.seek(text)`** —
  the state an entity was in before a batch, every value one column ever held
  anywhere, and every recorded value containing some text (what a redaction
  starts from; `j.scrubValue` and `j.scrubRef` rewrite one in place).

A column whose text the graph already stores once under a content address is
recorded by ADDRESS (`cas`), so the log shares the graph's bytes instead of
keeping every revision of every document twice.

## Limitations and recording rules

- **The provenance stamps are not recorded twice.** `created` and `updated`
  repeat, column for column, what the batch row already holds, so they are
  skipped by default (`skip` says otherwise).
- **A death is recorded whole**: every component the entity carried, with what
  it held, and then the `tombstone` the entity now wears. History outlives the
  entity — a change keeps its spine reference past the target's death.
- **It is not a backup.** It records what moved, not the whole entity, so a
  graph journaled from its first write can answer anything and one that started
  journaling later answers from there on.
- **It needs a SQL store.** The rows are tables, not bundles, so the host is a
  database — the same one the graph is stored in, or another; the journal only
  ever asks it to run a statement.

## Compatibility

Browser-compatible: no platform API, no Deno or Node namespace — the host hands
in `rows(sql, params)` and the journal calls nothing else. Synchronous
throughout, like the embedded databases it is written against.
