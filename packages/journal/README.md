# @yaks/journal

Records graph transactions in SQL tables and provides entity history, undo, and
a cursor-based change feed. Install the journal plugin on the same database
connection as the graph so its records commit or roll back with the changes they
describe.

A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction, normally one `graph.apply()` call. The
journal represents a recorded transaction as a `Batch`, identified by its
increasing `seq`. The **host** is the process that opened the graph, such as
`yak serve` or a CLI command.

See the [graph architecture](../graph/ARCHITECTURE.md) for the write phases.

## Install

```sh
deno add jsr:@yaks/journal
# or: npx jsr add @yaks/journal
```

## What it is for

Use the journal to inspect who changed an entity and its previous values,
reverse a recorded transaction, or consume committed changes incrementally.
History starts when recording is enabled; earlier state cannot be reconstructed
unless it was imported into the journal.

## What it records

| Table            | Contents                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `journal_tx`     | Transaction sequence, timestamp, actor references and optional note |
| `journal_change` | Ordered component upserts/removals, or an entity deletion           |
| `journal_field`  | Ordered column values after each change                             |

An empty component still has a change row. Component removal records null values
for the fields known to the journal, keeping their history continuous across
removal and recreation. Previous values are reconstructed from the entity's own
indexed history rather than stored alongside each new value.

These tables do not contain graph entities of their own and are not included in
ordinary graph snapshots or client caches. Normal writes append records;
explicit redaction methods can modify stored history.

The plugin skips a transaction with no recorded component changes. Its `journal`
hook runs inside the graph's transaction. It opens no transaction and uses the
synchronous `rows(sql, params)` callback supplied to `log()`. Atomic recording
requires that callback to use the graph's active transaction on the same
connection. A separate unrelated database connection does not provide that
guarantee.

## Who a recorded write is attributed to

The graph passes the resolved `$actor` to the journal: `by` identifies whom the
write acts for, and `via` identifies the session, connector or other entity
through which it was made. Both are stored as references into `entity`, then
read back as public eids. Create those entities before attributing writes to
them. Unspecified actors are recorded as null.

Authentication and actor selection belong to the API, CLI or tool caller; the
journal records what the graph passes to it. `created` and `updated` components
are skipped by default because the transaction already records attribution and
time. `journal(log, { skip })` changes that component list.

The SQL `trace` column is an optional note. The graph plugin leaves it unset;
`log.write({ at, by, via, note }, patches)` can supply it directly.

## In a server

Add the package to a compatible `yak` plugin configuration:

```json
{ "plugins": ["@yaks/kernel", "@yaks/journal"] }
```

`@yaks/journal/rules` creates the SQL tables on the host's connection and
returns the journal plugin. `@yaks/journal/vocab` declares the `history` tool,
and `@yaks/journal/tools` implements it. The package declares no graph
component.

```sh
yak history T-5 -n 10
```

The tool returns the entity's latest transactions first, each as the patch
applied to that entity, with `updated: { at, by, via }` metadata. Entity
deletion appears as `$delete`. A transaction that changed other entities
includes only the requested entity's changes in this response. The low-level
`history()` method instead returns transactions oldest first.

## What it returns

This example assumes `vocab` declares a `page` component with a string `title`,
and `driver` implements `@yaks/sqlite`'s synchronous `query`/`exec` interface.
Both graph storage and journal use that same connection.

```ts
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { ddl, journal, undo } from '@yaks/journal'
import { logFor } from '@yaks/journal/rules'

let store = storage(driver, vocab)
store.install()
driver.exec(ddl())
let j = logFor({ sql: driver })
let g = graph({ storage: store, vocab, plugins: [journal(j)] })

g.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
g.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])

let history = j.history('p1')
let changed = history.at(-1)!
undo(g, j)(changed.seq) // restores 'Kickoff' and records the undo
let entries = j.since(0) // Entry[], oldest first
```

`Batch` carries `seq`, `at`, `by`, `via` and `deltas`. Each `Delta` identifies a
`target` eid, `comp`, optional `column`, and `before`/`after` values. A null
`column` describes a whole component's addition or removal.

`Entry` is the recorded operation format: `seq`, attribution, `note` and
`patches`. Each `Patch` contains `target`, `comp` and `value`, with null meaning
removal. `since()` returns entries, while `at()` and `history()` reconstruct
batches with before/after deltas.

| Method                                                 | Result                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `j.history(eid, n?)`                                   | Latest `n` transactions for an entity, returned oldest first |
| `j.entries(eid, n?)`                                   | Latest entries for an entity, newest first                   |
| `j.by(via, n?)`                                        | Entries written through an instrument, newest first          |
| `j.since(cursor?)`                                     | Entries strictly after the cursor, oldest first              |
| `j.at(seq)`                                            | One reconstructed `Batch`, or `undefined`                    |
| `j.patches(seq, target?)`                              | Recorded operations, optionally restricted to one entity     |
| `j.before(eid, seq)`                                   | Components just before a transaction                         |
| `j.latest(eid)`, `j.tip()`                             | Latest sequence for an entity or the whole log               |
| `j.touchedSince(eid, seq)`                             | Whether the entity changed after a sequence                  |
| `j.wrote(comp, column)`                                | Recorded values for a column across entities                 |
| `j.seek(text)`                                         | Recorded values containing text                              |
| `j.scrubValue(field, value)`, `j.scrubRef(field, ref)` | Explicit history redaction                                   |
| `j.holds(ref)`                                         | Whether history still references stored content              |

To turn a feed entry into graph changes, load its batch with `j.at(entry.seq)`
and pass that to `applied(batch)`. `applied()` reconstructs the changes without
reading current graph state. It does not repeat transaction attribution in the
returned bundles.

The consumer owns its cursor and delivery policy. Saving the cursor before doing
the work can lose work after a crash; saving it afterward can repeat work. The
journal alone does not guarantee exactly-once external effects.

## Undo

`undo(g, j)(seq, actor?)` reconstructs an inverse and applies it through the
graph, with trusted access to server-owned columns. It restores previous column
values and removed components, and removes components created by the original
transaction. The undo is validated, stamped and journaled as another write;
undoing that write provides redo.

Column deltas restored by `undo()` carry `$was` preconditions hashed from the
original transaction's after-values. If those columns changed in the meantime,
the graph rejects the reversal. Whole-component operations do not have the same
per-column guard, so this is not a general conflict check for every possible
intervening edit.

`undone(batch, { guard? })` builds the inverse without applying it; guards are
off by default there. `applied(batch)` reconstructs the forward change.

Entity deletion is permanent. `undone()` and `undo()` throw `Final` if the batch
deleted an entity, including a cascade. A nonexistent sequence makes `undo()`
throw an `Error`; a batch with no reversible changes returns `[]`.

## Limitations and recording rules

- History can reconstruct only recorded state. Enabling the plugin after data
  already exists does not capture that data's earlier values.
- Entity deletion is stored as an entity removal; history expands the known
  components and a tombstone from that entity's journal records. The retained
  entity row keeps references valid after deletion.
- Skipped components, including the default `created` and `updated` stamps, are
  not restored by undo. Undo receives fresh stamps when the graph supplies them.
- An optional `log({ cas })` configuration records selected text by a reference
  to a content store. Supply its lookup layout, selection function and writer;
  this is not enabled automatically by `rules(host)`.
- The journal records changes rather than complete snapshots. Back up its
  tables, the graph and any referenced content together when preserving history.

## Exports

The root exports `ddl`, `log`, `journal`, `applied`, `undone`, `undo`, `Final`,
value encoding helpers, and types including `Log`, `LogOpts`, `Batch`, `Entry`,
`Patch`, `Delta` and `Cas`.

| Sub-module export     | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `@yaks/journal/vocab` | `journalDoc` and `docs`, declaring the history tool              |
| `@yaks/journal/rules` | `rules(host)` installs tables/plugin; `logFor(host)` binds a log |
| `@yaks/journal/tools` | `runs(host)` implements the history tool                         |

## Compatibility

The journal requires synchronous SQLite-compatible SQL over the graph's entity
table. It imports no platform-specific storage API, so a suitable
caller-supplied binding can run it in Deno, Node or a browser.
