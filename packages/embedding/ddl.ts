// Where the vectors live: one table, one row per entity that has text, and
// beside it the one-row mark a persisted index reads to know the vectors moved.
//
// The layout is deliberately the plainest thing that works — the entity's own
// integer id as the primary key, so a vector joins to the graph the way every
// component table does; the model and a content hash, so the sweep knows which
// rows are stale and a search never mixes two vector spaces; the vector itself
// as a blob; and when it was written.
//
// It is DERIVED data. Nothing here is a source of truth: drop the table and the
// next sweep rebuilds it from the text it was made from. That is why it carries
// no history, no journal and no wire presence — and why a graph with no
// embedder at all is a graph that simply has no vectors, not a broken one.
//
// The mark is the crash fence for an approximate index built from these rows
// (see mark.ts): any write to the vector table sets it in the same SQLite
// statement, by trigger, and only a finished rebuild clears it. An exact scan
// never reads it.

/** The vector table's name. */
export let TABLE = 'embedding'

/** The mark table's name: one row, `dirty` 1 while an index is owed a rebuild. */
export let MARK = 'embedding_index'

// One trigger per write kind; a rebuild that missed any of them would answer
// from vectors that no longer exist.
let triggers = ['insert', 'update', 'delete'].map((on) =>
  `create trigger if not exists "${MARK}_a${on[0]}" after ${on} on "${TABLE}"` +
  ` begin update "${MARK}" set dirty = 1 where id = 1; end`
)

/**
 * The schema the vectors need, as ordered statements. Run them after the
 * component tables exist — the table references the entity spine. Every
 * statement is idempotent, so a table that already exists is left as it is.
 */
export let schema = (): string[] => [
  `create table if not exists "${TABLE}" (
    entity integer primary key references entity(id),
    model text not null,
    hash text not null,
    vec blob not null,
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `create index if not exists "${TABLE}_model" on "${TABLE}" (model)`,
  `create table if not exists "${MARK}" (
    id integer primary key check (id = 1),
    dirty integer not null
  )`,
  // A fresh mark starts dirty: an index that has never been built is owed one.
  `insert or ignore into "${MARK}" (id, dirty) values (1, 1)`,
  ...triggers,
]
