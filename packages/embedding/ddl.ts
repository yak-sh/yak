// Where the vectors live: one table, one row per entity that has text.
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

/** The vector table's name. */
export let TABLE = 'embedding'

/**
 * The schema the vectors need, as ordered statements. Run them after the
 * component tables exist — the table references the entity spine.
 */
export let schema = (): string[] => [
  `create table if not exists "${TABLE}" (
    entity integer primary key references entity(id),
    model text not null,
    hash text not null,
    vec blob not null,
    at text not null
  )`,
  `create index if not exists "${TABLE}_model" on "${TABLE}" (model)`,
]
