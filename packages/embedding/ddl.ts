// Where the vectors live: one table, one row per entity that has text; beside
// it the one-row dirty flag a persisted index reads to know the vectors have
// changed; and the queue of entities owed a look (./owed.ts).
//
// The layout is deliberately the plainest thing that works — the entity's own
// integer id as the primary key, so a vector joins to the graph the way every
// component table does; the model and a content hash, so the sweep knows which
// rows are stale and a search never mixes two vector spaces; the vector itself
// as a blob; and when it was written.
//
// It is derived data. Nothing here is a source of truth: drop the table and the
// next sweep rebuilds it from the text it was made from. That is why it carries
// no history, no journal, and is never sent to a client — and why a graph with
// no embedder at all is a graph that simply has no vectors, not a broken one.
//
// The dirty flag is what protects an approximate index built from these rows
// against a crash (see mark.ts): any write to the vector table sets it in the
// same SQLite statement, by trigger, and only a finished rebuild clears it. An
// exact scan never reads it.

import {
  col,
  type CreateTrigger,
  eq,
  lit,
  NOW,
  type Stmt,
  type Update,
} from '@yaks/sql'

/** The vector table's name. */
export let TABLE = 'embedding'

/** The flag table's name: one row, `dirty` 1 while an index needs a rebuild. */
export let MARK = 'embedding_index'

/** The queue's name: one row per entity owed a look, and how many writes have
 * queued it since it was last settled. */
export let OWED = 'embedding_owed'

/** The flag set to `dirty`. */
export let flag = (dirty: number): Update => ({
  t: 'update',
  table: MARK,
  set: { dirty: lit(dirty) },
  where: eq(col('id'), lit(1)),
})

// One trigger per kind of write; an index rebuilt after a write that set no
// flag would answer from vectors that no longer exist.
let triggers = (['insert', 'update', 'delete'] as const).map((
  event,
): CreateTrigger => ({
  t: 'create trigger',
  name: `${MARK}_a${event[0]}`,
  ifNot: true,
  timing: 'after',
  event,
  on: TABLE,
  body: [flag(1)],
}))

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
        name: 'entity',
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
    name: MARK,
    ifNot: true,
    cols: [
      { name: 'id', type: 'integer', pk: true, check: eq(col('id'), lit(1)) },
      { name: 'dirty', type: 'integer', notNull: true },
    ],
  },
  // A fresh flag starts dirty: an index that has never been built needs one.
  {
    t: 'insert',
    or: 'ignore',
    into: MARK,
    cols: ['id', 'dirty'],
    rows: [[lit(1), lit(1)]],
  },
  ...triggers,
  {
    t: 'create table',
    name: OWED,
    ifNot: true,
    cols: [
      { name: 'entity', type: 'integer', pk: true },
      { name: 'n', type: 'integer', notNull: true },
    ],
  },
]
