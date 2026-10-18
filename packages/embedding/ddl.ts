// Canonical vectors, exclusive-reader cache generations, and the embedding
// queue. Shared readers scan canonical vectors directly; only exclusive stores
// track changes for their process-local HELD cache.

import {
  col,
  type CreateTrigger,
  eq,
  lit,
  NOW,
  type Statements,
  type Stmt,
} from '@yaks/sql'

/** The vector table's name. */
export let TABLE = 'embedding'

/** The exclusive cache generation, with legacy native build metadata retained
 * until the one-time quantization cleanup has run. */
export let BUILD = 'embedding_build'

/** Vectors changed since the exclusive reader refreshed its cache. */
export let DIRTY = 'embedding_dirty'

/** The queue's name: one row per entity owed a look, and how many writes have
 * queued it since it was last settled. */
export let OWED = 'embedding_owed'

// An upsert keeps one notice per owner even when the outer write replaces
// rows: a trigger's `insert or ignore` inherits the outer conflict policy.
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
export let rekey = (db: Statements): void => {
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
export let schema = (
  ownership: Statements['ownership'] = 'exclusive',
): Stmt[] => [
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
  // The exclusive cache has not loaded a generation yet.
  {
    t: 'insert',
    or: 'ignore',
    into: BUILD,
    cols: ['id', 'n'],
    rows: [[lit(1), lit(0)]],
  },
  ...(ownership == 'exclusive' ? tracked() : []),
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

let tracked = (): Stmt[] => [{
  t: 'create table',
  name: DIRTY,
  ifNot: true,
  cols: [{ name: 'owner', type: 'integer', pk: true }],
}, ...triggers]

/** Retire shared-store change tracking after every old reader has stopped. */
export let untrack = (): Stmt[] => [
  ...triggers.map(({ name }): Stmt => ({
    t: 'drop',
    kind: 'trigger',
    name,
    ifExists: true,
  })),
  { t: 'drop', kind: 'table', name: DIRTY, ifExists: true },
]
