// Where the vectors live: one table, one row per entity that has text; beside
// it the record of the quantized index built from them (./native.ts) — which
// build it is, and the vectors written since; and the queue of entities owed a
// look (./owed.ts).
//
// The layout is deliberately the plainest thing that works — the entity's own
// integer id as the primary key, named `owner` as @yaks/fts names its rows' (a
// table keyed by `entity` is a component table to @yaks/sqlite, physical.ts
// `componentTables`, and a vector is no component); the model and a content
// hash, so the sweep knows which rows are stale and a search never mixes two
// vector spaces; the vector itself as a blob; and when it was written.
//
// It is derived data. Nothing here is a source of truth: drop the table and the
// next sweep rebuilds it from the text it was made from. That is why it carries
// no history, no journal, and is never sent to a client — and why a graph with
// no embedder at all is a graph that simply has no vectors, not a broken one.
//
// The dirty set is what keeps the index exact between builds: a trigger notes
// every vector written or deleted, in the same statement as the write, and a
// build clears the set in the same transaction as it quantizes. So whatever the
// index has not seen is in the set, which a search scores directly, and a
// crash between a write and a build leaves it there.

import {
  col,
  type CreateTrigger,
  type Driver,
  eq,
  lit,
  NOW,
  type Stmt,
} from '@yaks/sql'

/** The vector table's name. */
export let TABLE = 'embedding'

/** The build's name: one row saying which build of the quantized index is
 * current (0 before the first), and the model, dimension and count of the
 * vectors it was built from. */
export let BUILD = 'embedding_build'

/** The dirty set's name: one row per entity whose vector was written or
 * deleted since the current build. */
export let DIRTY = 'embedding_dirty'

/** The queue's name: one row per entity owed a look, and how many writes have
 * queued it since it was last settled. */
export let OWED = 'embedding_owed'

// One trigger per kind of write: an index that missed a write would answer
// from a vector that no longer exists, or without one that does. An entity
// already in the set stays as it is, said as an upsert: a trigger's `insert or
// ignore` takes the conflict policy of the statement that fired it instead.
let triggers = (['insert', 'update', 'delete'] as const).map((
  event,
): CreateTrigger => ({
  t: 'create trigger',
  name: `${DIRTY}_a${event[0]}`,
  ifNot: true,
  timing: 'after',
  event,
  on: TABLE,
  body: [{
    t: 'insert',
    into: DIRTY,
    cols: ['owner'],
    rows: [[col('owner', event == 'delete' ? 'old' : 'new')]],
    upsert: [{ on: [col('owner')] }],
  }],
}))

/**
 * Heal a store whose vector tables were made while their key was named
 * `entity`: each such table has the column renamed to `owner`, which SQLite
 * carries into every trigger and index that names it. Run it before
 * {@link schema}. It can be deleted once every store has opened with it.
 */
export let rekey = (db: Driver): void => {
  for (let name of [TABLE, DIRTY, OWED]) {
    let cols = db.query({ t: 'pragma', name: 'table_info', arg: name })
    if (!cols.some((c) => c.name == 'entity')) continue
    db.query({
      t: 'alter table',
      table: name,
      rename: { column: 'entity', to: 'owner' },
    })
  }
}

/**
 * The schema the vectors need, as ordered statements. Run them after the
 * component tables exist — the table references the entity spine. Every
 * statement is idempotent, so a table that already exists is left as it is.
 */
export let schema = (): Stmt[] => [
  {
    t: 'create table',
    name: TABLE,
    ifNot: true,
    cols: [
      {
        name: 'owner',
        type: 'integer',
        pk: true,
        ref: { table: 'entity', cols: ['id'] },
      },
      { name: 'model', type: 'text', notNull: true },
      { name: 'hash', type: 'text', notNull: true },
      { name: 'vec', type: 'blob', notNull: true },
      { name: 'at', type: 'text', notNull: true, default: NOW },
    ],
  },
  {
    t: 'create index',
    name: `${TABLE}_model`,
    on: TABLE,
    cols: [col('model')],
    ifNot: true,
  },
  {
    t: 'create table',
    name: BUILD,
    ifNot: true,
    cols: [
      { name: 'id', type: 'integer', pk: true, check: eq(col('id'), lit(1)) },
      { name: 'n', type: 'integer', notNull: true },
      { name: 'model', type: 'text' },
      { name: 'dim', type: 'integer' },
      { name: 'rows', type: 'integer' },
    ],
  },
  // No build yet: every search scores every vector until the first.
  {
    t: 'insert',
    or: 'ignore',
    into: BUILD,
    cols: ['id', 'n'],
    rows: [[lit(1), lit(0)]],
  },
  {
    t: 'create table',
    name: DIRTY,
    ifNot: true,
    cols: [{ name: 'owner', type: 'integer', pk: true }],
  },
  ...triggers,
  {
    t: 'create table',
    name: OWED,
    ifNot: true,
    cols: [
      { name: 'owner', type: 'integer', pk: true },
      { name: 'n', type: 'integer', notNull: true },
    ],
  },
]
