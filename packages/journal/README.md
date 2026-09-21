# @yaks/journal

A [@yaks/graph](../graph) plugin that records every committed transaction in
three append-only SQL tables beside the graph's own. From that record it serves
an entity's history, an undo, and a cursor-based feed of changes. The rows are
written inside the same transaction as the write they describe.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

Two terms are used throughout this README:

- A **transaction** is one call to `graph.apply()`: a list of bundles — one
  per-entity patch each — that all commit or none do. The package's type for a
  recorded one is `Batch`, and its `seq` is its position in the total order.
- The **server** is whichever process opened the database and loaded this
  plugin: usually a long-running `yak serve`, sometimes just the CLI.

## Install

```sh
deno add jsr:@yaks/journal
# or: npx jsr add @yaks/journal
```

## What it is for

Use the journal to find out who changed an entity and what the values were
before, to reverse a transaction, or to consume changes incrementally. History
starts when the plugin is enabled; it does not reconstruct changes made before
that.

## What it records

The plugin registers one hook, on the `journal` phase of `apply()`. That phase
runs inside the transaction that has just written, and the hook records the
transaction as applied.

| table            | one row per                                       |
| ---------------- | ------------------------------------------------- |
| `journal_tx`     | committed transaction — its id is the total order |
| `journal_change` | component that transaction patched or removed     |
| `journal_field`  | column that change wrote — its after-image        |

For one write, then: one `journal_tx` row holding the timestamp, the identity
the write was for (`by`), the instrument it came through (`via`), and an
optional note; one `journal_change` row per component the transaction patched or
removed — plus one naming the entity itself when the transaction deleted it —
numbered in the order they were applied and marked `upsert` or `remove`; and,
under each of those, one `journal_field` row per column, holding the value that
column was left with. An empty component writes no field rows — its change row
alone records that it is present. Removing a component writes one tombstone
field row per column it still held, so a column's history stays self-contained
across a removal and a later recreation.

These tables hold no entities: no eid of their own, no minted id, and they never
appear in a bundle or in a client's cache. They are the record of what was
applied, not part of the data a client reads back.

They store after-images only — what a write left, never both sides of it. The
before-value that a history read needs is rebuilt from that entity's own rows in
the log, a read bounded to one entity and never a table scan. That is what keeps
the log about a third of the size of one that stores both sides.

Because the rows go in inside the transaction, a transaction that was refused
leaves no trace, and one that committed always has a row.

Nothing is read in order to write, so this plugin registers no `precondition`
hook and passes nothing forward to a later phase. It asks its caller for one
function — `rows(sql, params)` — and opens no transaction of its own; the caller
owns the transaction.

## Who a recorded write is attributed to

Each `journal_tx` row is stamped with the transaction's `$actor`: `by`, the
identity the write acts for, and `via`, the instrument it came through — a
session, a run, a connector. Both are stored as references into the entity
table, so an actor has to be an entity before anything can be attributed to it,
and both are read back as eids. A transaction that named neither records nulls
for both.

`$actor` is set by whatever received the write — @yaks/api's `/apply` handler
after it has authenticated the request, the tool runner when it applies what a
tool returned, the CLI when it knows who is at the keyboard — and `apply()`
stamps what reached it, never what a client claimed for itself. The journal
records that same resolved pair, so a history line and the entity's own
`created`/`updated` components always agree.

The fourth column, `trace`, is a free-text note. The plugin never sets one; it
is there for a caller writing to the log directly through `log.write()`.

## In a server

`@yaks/journal/rules` exports `rules(host)`. It creates the three tables over
the server's own database connection and returns the plugin that writes them.
`@yaks/journal/tools` exports the function behind the `history` tool, which
reads the tables `rules` writes. `@yaks/journal/vocab` declares no component:
the journal is the record of what was applied rather than part of it, so it
appears in no snapshot. The only name it declares is that one tool.

```json
{ "plugins": ["@yaks/kernel", "@yaks/journal"] }
```

```sh
yak history T-5 -n 10
```

That prints every transaction that touched the entity, newest first, each as the
patch it applied — the components it wrote, or `$delete` for a deletion —
stamped with `updated{at, by, via}`: when it committed, the identity it was
written for, and the instrument it came through. The tool returns bundles, so
the CLI and the MCP server report the same thing.

## What it returns

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

undo(g, j)(2) // the title is 'Kickoff' again — and that undo is transaction 3
j.since(0) // every transaction after the cursor, oldest first
```

- **`j.history(eid)`** — every transaction that touched one entity, oldest
  first, each with the identity that wrote it, when it committed, and the deltas
  about that entity. A delta names one column and both of its values; a delta
  with no column is the component as a whole appearing or going.
- **`undo(g, j)(seq)`** — the inverse of a transaction, applied through the
  graph. See below.
- **`j.since(cursor)`** — the transactions after a cursor, oldest first, with
  `j.at` and `applied(batch)` turning one back into the bundles it committed,
  which a server can push to its subscribers. A consumer that stores the cursor
  BEFORE it does the work runs effects at most once.
- **`j.before(eid, seq)`**, **`j.wrote(comp, column)`**, **`j.seek(text)`** —
  the state an entity was in just before a transaction, every value one column
  has ever held on any entity, and every recorded value containing some text
  (where a redaction starts; `j.scrubValue` and `j.scrubRef` rewrite one
  recorded value in place).

A column whose text the graph already stores once under a content address is
recorded by that address (`cas`), so the log points at the graph's bytes instead
of keeping every revision of every document twice.

## Undo

`undo(g, j)(seq)` reads the recorded transaction back out of the log, builds the
change that reverses it, and applies that change through `graph.apply()`. The
inverse puts every column back to the value it held, restores every component
the transaction removed with the columns it had, and removes every component the
transaction created. Because it goes through `apply()`, the undo is admitted,
stamped and journaled like any other write, which makes undoing an undo a redo.
It is applied as trusted, since restoring a column the server owns is the
graph's own reconstruction rather than a client's write.

Every restored column carries a `$was` precondition, hashed from the value the
original transaction left in that column. If somebody else has changed that
column since, the graph refuses the whole reversal rather than overwriting their
work.

Two things it cannot reverse:

- **A deletion.** `undone()` and `undo()` throw `Final` when the transaction
  deleted an entity. A deleted entity is tombstoned, never erased, and its id
  can never be reused, so there is nothing to restore it into.
- **Anything the log does not hold.** Changes made before the plugin was
  enabled, and the `created`/`updated` stamps it skips, are not in the record
  and so are not restored — the undo is stamped fresh, with its own actor and
  timestamp.

`undo()` throws a plain `Error` if no transaction has that `seq`, and returns an
empty array if the recorded transaction moved nothing.

## Limitations and recording rules

- **The provenance stamps are not recorded twice.** `created` and `updated`
  repeat, column for column, what the `journal_tx` row already holds, so they
  are skipped by default; the `skip` option sets which components are skipped.
- **A deletion reads back whole.** What is stored is one removal of the entity
  row, and a history read expands it, out of that entity's own rows in the log,
  into every component the entity had with the values it held, followed by the
  `tombstone` that marks it dead. History outlives the entity — a change row
  keeps its reference to the entity row after the entity itself is gone.
- **It is not a backup.** It records what moved, not the whole entity, so a
  graph journaled from its first write can answer anything about its past, and
  one that started journaling later answers only from there on.
- **It needs a SQL store.** The rows are tables, not bundles, so the caller has
  to hand in a database — the same one the graph is stored in, or another. The
  journal only ever asks it to run a statement.

## Compatibility

Browser-compatible: no platform API, no Deno or Node namespace — the caller
hands in `rows(sql, params)` and the journal calls nothing else. Synchronous
throughout, like the embedded databases it is written against.
