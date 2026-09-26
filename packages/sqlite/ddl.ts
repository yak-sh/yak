// The schema, derived from a vocabulary. Given a `Vocab` (from @yaks/vocab)
// this emits the ordered `CREATE` statements whose tables the compiled queries
// from @yaks/sql read and the writes in ./write.ts patch. One function, one
// truth: the storage shape is a projection of the vocabulary, never a second
// hand-kept copy that can drift from it.
//
// The layout every statement here builds toward — the same one @yaks/sql's
// SQLite dialect reads:
//   entity        the identity table: an integer `id`, a string `eid`, a `num`.
//                 Every other table keys to `entity(id)` by an integer, so a
//                 reference is an integer compare after one id lookup.
//   tombstone     a deleted entity keeps its `entity` row (its eid, number
//                 and integer id) and gains a tombstone row; reads exclude it,
//                 and a later write that brings it back deletes the row.
//   <component>   one table per component, keyed by an `entity` integer owner.
//                 A scalar column stores its value; a reference stores the
//                 referent's integer id; a component with no properties is a
//                 bare tag whose presence is the fact.
//   <index>       declared indexes plus automatic reference indexes, named after
//                 the columns it covers. A unique one is the constraint a race
//                 is decided by; the vocabulary is where it is declared.
//   doc_value     a view over the `doc` component (when the vocabulary declares
//                 one): its columns read as text, plus a `rowid` alias. It is
//                 what @yaks/sql reads a `doc` row through.
//   server_meta   the store's own key/value, beside the graph: what the store
//                 knows about itself (its epoch, a sweep's mark), never about
//                 an entity. ./meta.ts reads and writes it.
//
// Every statement is a node of @yaks/sql's AST; nothing here writes SQL text.
//
// Columns are nullable by default: a patch may create a row from any subset of
// its properties (that is what PATCH means), so a column requires a value only
// where the vocabulary declares one — a `required` property is NOT NULL, and
// the row that omits it is rejected by the engine unless a `default` fills it.
// An `enum` becomes a check, so a value outside the set is rejected where it is
// written. A reference carries a foreign key so a dangling id is rejected by
// the engine, except a `keep` reference, which outlives the row it points at
// and stays key-free.

import type { Index, Prop, Vocab } from '@yaks/vocab'
import {
  among,
  and,
  as,
  col,
  type Column,
  type CreateIndex,
  type CreateTable,
  type Derived,
  type Driver,
  eq,
  type Expr,
  fn,
  lit,
  notNull,
  NOW,
  select,
  type Stmt,
  table,
} from '@yaks/sql'
import { tables } from './physical.ts'

/**
 * The key/value table's name. Named `server_meta`, not `meta`, because a
 * vocabulary may well declare a `meta` component and the two must never collide
 * — and because that is the name the fleet's live table already carries, so
 * installing over one adopts it instead of creating a second.
 */
export let META = 'server_meta'

// A column that holds an entity's integer id, keyed to the spine.
let ENTITY = { table: 'entity', cols: ['id'] }

// The high-water mark a new number is taken past, raised by whatever wrote one.
let raise: Stmt = {
  t: 'update',
  table: 'entity_sequence',
  set: { high: fn('max', col('high'), col('num', 'new')) },
  where: eq(col('singleton'), lit(1)),
}

// The identity table, the tombstones, and the store's own key/value. Fixed
// shape — every layout has exactly this spine, whatever components sit on
// it.
let SPINE: Stmt[] = [
  {
    t: 'create table',
    name: 'entity',
    ifNot: true,
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'eid', type: 'text', notNull: true, unique: true },
      { name: 'num', type: 'integer', unique: true },
      { name: 'archetype', type: 'integer', ref: ENTITY },
    ],
  },
  {
    t: 'create table',
    name: 'entity_sequence',
    ifNot: true,
    cols: [
      {
        name: 'singleton',
        type: 'integer',
        pk: true,
        check: eq(col('singleton'), lit(1)),
      },
      { name: 'high', type: 'integer', notNull: true },
    ],
  },
  {
    t: 'insert',
    into: 'entity_sequence',
    cols: ['singleton', 'high'],
    q: select({
      cols: [lit(1), fn('coalesce', fn('max', col('num')), lit(0))],
      from: table('entity'),
    }),
    upsert: [{
      on: [col('singleton')],
      set: { high: fn('max', col('high'), col('high', 'excluded')) },
    }],
  },
  {
    t: 'create trigger',
    name: 'entity_number_insert',
    ifNot: true,
    timing: 'after',
    event: 'insert',
    on: 'entity',
    when: notNull(col('num', 'new')),
    body: [raise],
  },
  {
    t: 'create trigger',
    name: 'entity_number_update',
    ifNot: true,
    timing: 'after',
    event: 'update',
    of: ['num'],
    on: 'entity',
    when: notNull(col('num', 'new')),
    body: [raise],
  },
  {
    t: 'create table',
    name: 'tombstone',
    ifNot: true,
    cols: [
      { name: 'entity', type: 'integer', pk: true, ref: ENTITY },
      { name: 'deleted_at', type: 'text', notNull: true },
    ],
  },
  // Keyed by `k`, valued by `v`, and nothing else: whatever an application
  // keeps here it keeps as text under a name it chose (./meta.ts).
  {
    t: 'create table',
    name: META,
    ifNot: true,
    cols: [
      { name: 'k', type: 'text', pk: true },
      { name: 'v', type: 'text', notNull: true },
    ],
  },
]

// A property's default: the current time, or a literal a row takes when the
// writer supplied no value. A boolean stores as the integer it reads back as.
let fallback = (c: Prop): Expr | undefined => {
  let d = c.default
  return !d ? undefined : 'now' in d ? NOW : lit(d.value)
}

// A closed set's check. Every value the vocabulary admits on the way in is
// admitted here too (an alias is an accepted input value), so the engine never
// rejects what the loader accepted.
let closed = (c: Prop): Expr | undefined =>
  c.category == 'enum'
    ? among(
      col(c.prop),
      [...c.values!, ...Object.keys(c.aliases ?? {})].map(lit),
    )
    : undefined

// A stored property's column. Affinity comes straight off the property as the
// vocabulary describes it; a reference carries a foreign key unless it is a
// `keep` reference, which must survive its target's tombstone and so carries
// none. `required` becomes NOT NULL; `default` and `enum` are emitted as above.
let column = (c: Prop): Column => ({
  name: c.prop,
  type: c.affinity || undefined,
  notNull: c.required,
  default: fallback(c),
  check: closed(c),
  ref: c.category == 'ref' && c.fk ? ENTITY : undefined,
})

// The same column added to a standing table. SQLite refuses `add column` a
// NOT NULL without a constant default and any default that is an expression,
// so a grown column keeps its literal default and its CHECK, arrives NOT NULL
// only when a literal fills the rows already there, and takes the clock only
// on rows written from now on (the writer stamps them; NOW is for the row that
// omits it).
let grownColumn = (c: Prop): Column => {
  let d = c.default && 'value' in c.default ? lit(c.default.value) : undefined
  return { ...column(c), notNull: c.required && !!d, default: d }
}

// Which of a component's declared properties are stored: everything the
// vocabulary lists except the computed ones (a computed property is read
// through a supplied expression, never off a row).
let stored = (v: Vocab, comp: string): Prop[] =>
  v.props(comp)
    .map((prop) => v.prop(comp, prop)!)
    .filter((c) => !c.computed)

// One component's table. The `entity` owner is the primary key, so a component
// is stored at most once per entity. A tag component (no stored properties) is
// just the owner column — its row's existence is the whole fact.
let tableDdl = (
  v: Vocab,
  comp: string,
  name = comp,
  extra: Column[] = [],
): CreateTable => ({
  t: 'create table',
  name,
  ifNot: true,
  cols: [
    { name: 'entity', type: 'integer', pk: true, ref: ENTITY },
    ...stored(v, comp).map(column),
    ...extra,
  ],
})

// One declared index, named `<comp>_<props>` — derived from what it covers, so
// the same declaration always names the same index and a second install is a
// no-op. A partial one covers only the rows that hold its `present`
// properties: the rows without them are as many as they like, the rows with
// them are one.
let indexDdl = (comp: string, i: Index): CreateIndex => ({
  t: 'create index',
  name: `${comp}_${i.props.join('_')}`,
  on: comp,
  cols: i.props.map((p) => col(p)),
  unique: i.unique,
  ifNot: true,
  where: i.present ? and(...i.present.map((p) => notNull(col(p)))) : undefined,
})

// The `doc` view: each property read as text — through its registered `text`
// expression where the stored value is not the text itself (@yaks/blob keeps
// an address) — plus a `rowid` alias. Search indexes are composed separately
// by the application using @yaks/fts.
let docDdl = (v: Vocab, derived: Derived): Stmt[] => {
  if (!v.all.includes('doc')) return []
  let read = (prop: string) =>
    derived[`doc.${prop}`]?.text?.(col(prop)) ?? col(prop)
  let props = stored(v, 'doc').map((c) => c.prop)
  // The view names its columns rather than selecting `*`, because `*` cannot
  // replace one with the expression that resolves it. `*` did have one virtue —
  // it followed a table that gained columns — so the view is dropped and
  // recreated rather than left in place: it holds no rows, so recreating it
  // costs nothing, and a view that lags its table is a read that fails at the
  // engine.
  return [
    { t: 'drop', kind: 'view', name: 'doc_value', ifExists: true },
    {
      t: 'create view',
      name: 'doc_value',
      ifNot: true,
      q: select({
        cols: [
          col('entity'),
          ...props.map((p) => as(read(p), p)),
          as(col('entity'), 'rowid'),
        ],
        from: table('doc'),
      }),
    },
  ]
}

// The whole schema as an ordered list of statements: the spine, then one table
// per component (the `entity` spine component is the identity table above, not
// a component table), the doc view, and the indexes those tables declare.
// `install()` in ./mod.ts runs them; a caller may also read them to inspect or
// migrate by hand. `derived` is the store's read overrides: a property whose
// stored value is not its text reads through its `text` expression.
export let schema = (vocab: Vocab, derived: Derived = {}): Stmt[] => [
  ...tabled(vocab, derived),
  // After every table: an index names a column the create above just raised.
  ...indexed(vocab),
]

// The spine and one table per component, with the doc view. Everything an
// index may need to already exist.
export let tabled = (vocab: Vocab, derived: Derived = {}): Stmt[] => [
  ...SPINE,
  ...vocab.all.filter((name) => name != 'entity')
    .map((name) => tableDdl(vocab, name)),
  ...docDdl(vocab, derived),
]

// Declared and automatic reference indexes. Created last, after `grown()`: an
// index may name a column its table only gained on this boot, and SQLite
// rejects one over a column that is not there yet.
export let indexed = (vocab: Vocab): Stmt[] => [
  // Adapters that only replay schema() may still have the old spine. Until
  // they opt into archetypes/migration, do not index a column they lack.
  ...(vocab.comp('archetype')
    ? [
      indexDdl('entity', { props: ['archetype'], unique: false }),
      indexDdl('entity', { props: ['archetype', 'num'], unique: false }),
    ]
    : []),
  ...vocab.all
    .filter((name) => name != 'entity')
    .flatMap((name) => vocab.indexes(name).map((i) => indexDdl(name, i))),
]

// A table's columns and its foreign keys, as the file holds them.
let info = (driver: Driver, name: string) =>
  driver.query({ t: 'pragma', name: 'table_info', arg: name })
let keys = (driver: Driver, name: string) =>
  driver.query({ t: 'pragma', name: 'foreign_key_list', arg: name })

// The reference columns a component's table carries a foreign key for: the
// stored references the vocabulary declares as constrained (a `keep` reference
// outlives its target's tombstone, so it never is), plus the owner column
// every component table is keyed by.
let bound = (v: Vocab, comp: string): Set<string> =>
  new Set([
    'entity',
    ...stored(v, comp).filter((c) => c.category == 'ref' && c.fk).map((c) =>
      c.prop
    ),
  ])

// The component tables `held` names, where `held` is the tables a file stood
// with before this install created any: a table created by this install is
// already the shape its vocabulary says, so only the ones that were there
// before can be wrong. Read off the file when not given (physical.ts `tables`).
let standing = (vocab: Vocab, held: Set<string>): string[] =>
  vocab.all.filter((name) => name != 'entity' && held.has(name))

/**
 * What `grown()` cannot fix either: a reference whose declared death behavior
 * changed after its table was created. That declaration is what decides whether
 * a column is constrained, so changing it changes the table's foreign keys —
 * and SQLite has no `alter table drop constraint`. The table is rebuilt
 * instead: a fresh one beside it, the rows copied across the columns both have,
 * the old one dropped and the new one renamed into its place.
 *
 * Only a table whose keys disagree with the vocabulary is touched, so this is
 * a no-op on every boot but the one after the vocabulary changed. It must run
 * before `indexed()`, which recreates the indexes the drop took with it.
 * `held` is the tables the file had before this install created any (see
 * `standing`): a fresh file has none, and is asked nothing.
 */
export let refit = (
  driver: Driver,
  vocab: Vocab,
  held: Set<string> = new Set(tables(driver)),
): Stmt[] =>
  standing(vocab, held).flatMap((comp): Stmt[] => {
    let want = bound(vocab, comp)
    let has = new Set(keys(driver, comp).map((r) => String(r.from)))
    if (want.size == has.size && [...want].every((c) => has.has(c))) return []
    let held = info(driver, comp)
    if (!held.length) return []
    // Every column the table has comes across, not every property the
    // vocabulary declares: a property the vocabulary has since dropped is still
    // a column this table's rows were written under, and a constraint change is
    // no reason to remove one. It keeps its type and nothing else: nothing
    // writes a column the vocabulary no longer declares, so it is neither
    // required nor filled.
    let said = new Set(stored(vocab, comp).map((c) => c.prop))
    let extra = held.filter((r) =>
      r.name != 'entity' && !said.has(String(r.name))
    )
    let fresh = `${comp}__refit`
    let cols = held.map((r) => String(r.name))
    return [
      tableDdl(
        vocab,
        comp,
        fresh,
        extra.map((r) => ({
          name: String(r.name),
          type: String(r.type ?? '') || undefined,
        })),
      ),
      {
        t: 'insert',
        into: fresh,
        cols,
        q: select({ cols: cols.map((c) => col(c)), from: table(comp) }),
      },
      { t: 'drop', kind: 'table', name: comp },
      { t: 'alter table', table: fresh, rename: comp },
    ]
  })

// What `schema()` alone cannot do: add the columns a component gained after its
// table was already created. `create table if not exists` does nothing to a
// table that exists, so a vocabulary that gained a property leaves the table at
// the shape it was first created with, and every read naming the new column
// fails at the engine ("no such column"). SQLite has no `add column if not
// exists`, so the live shape is inspected and only the missing columns are
// added.
//
// Additive only, and deliberately: nothing is dropped and nothing is retyped,
// because rows are already written under the columns the table has. A column
// is emitted in the form SQLite accepts in an `add column` (grownColumn above).
//
// Only a table that exists can lack a column, so a table that does not is
// asked nothing, and neither is one this install created: `held` is the
// tables the file had before it (see `standing`), which on a fresh file is
// none. The statements are the same read before the creates or after them,
// since `create table if not exists` never touches a table that stands.
export let grown = (
  driver: Driver,
  vocab: Vocab,
  held: Set<string> = new Set(tables(driver)),
): Stmt[] => [
  ...(!held.has('entity') ||
      info(driver, 'entity').some((r) => r.name == 'archetype')
    ? []
    : [{
      t: 'alter table' as const,
      table: 'entity',
      add: { name: 'archetype', type: 'integer', ref: ENTITY },
    }]),
  ...standing(vocab, held)
    .flatMap((comp) => {
      let has = new Set(info(driver, comp).map((r) => String(r.name)))
      return stored(vocab, comp)
        .filter((c) => !has.has(c.prop))
        .map((c) => ({
          t: 'alter table' as const,
          table: comp,
          add: grownColumn(c),
        }))
    }),
]

/**
 * How many rows of each index analyze samples. Bounded, because the numbers the
 * planner needs are orders of magnitude — `call` holds fifty thousand rows and
 * `entity` a million — and a sample of four hundred says that as well as a
 * whole scan does. On a 1 GB graph the bounded pass costs ~110 ms where the
 * unbounded one costs 5.4 s.
 */
export let SAMPLE = 400

/**
 * Keep the statistics the query planner reads this schema with.
 *
 * Every component table is keyed `entity integer primary key` and carries no
 * secondary index, so without `sqlite_stat1` SQLite has nothing to size one by
 * and falls back to its built-in guess of about a million rows for all of them.
 * A query for "the entities that carry `call`" is then planned as a walk of
 * the whole spine probing `call` per row, instead of a scan of the fifty
 * thousand `call` rows — which is how opening an imported graph came to read
 * the archive end to end six times before answering (T-37734).
 *
 * `PRAGMA optimize` is what SQLite offers for exactly this: it re-analyzes a
 * table whose size has drifted from what was recorded and does nothing at all
 * otherwise, so this runs on every install and writes only when the numbers
 * have moved. The mask (0x10002) asks after every table rather than only the
 * ones this connection has already read — at install it has read none — and an
 * older SQLite that does not know that bit ignores it.
 *
 * Only for a driver over a file: an engine that hands out storage rather than a
 * database (a Durable Object's SQLite) refuses the pragma, and a scratch
 * in-memory store is gone before a plan could be worth improving.
 *
 * Analyzing writes, so it needs the write lock, and every process that opens
 * the file runs it: `optimize` names every empty table on every open, since an
 * empty table gets no statistics row to say it was seen. It never waits for
 * that lock. With another process writing, the numbers stay as they are until
 * an open finds the lock free, and the open goes on at once; waiting out the
 * busy timeout here would stall the open behind a writer, and failing it would
 * refuse a command over an optimization.
 */
export let analyzed = (driver: Driver): void => {
  if (!driver.file) return
  let wait = driver.query({ t: 'pragma', name: 'busy_timeout' })[0]?.timeout
  let set = (value: number) =>
    driver.query({ t: 'pragma', name: 'busy_timeout', value })
  set(0)
  try {
    driver.query({ t: 'pragma', name: 'analysis_limit', value: SAMPLE })
    driver.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
  } catch (e) {
    if (!busy(e)) throw e
  } finally {
    set(Number(wait ?? 0))
  }
}

/** SQLite refusing a lock another connection holds, as the driver reports
 * it: SQLITE_BUSY's own sentence. */
let busy = (e: unknown): boolean =>
  e instanceof Error && /database is (locked|busy)/.test(e.message)
