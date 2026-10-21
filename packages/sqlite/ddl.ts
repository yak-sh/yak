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

import { field, indexName } from '@yaks/sql'
import type { Index, Prop, Vocab } from '@yaks/vocab'
import {
  among,
  and,
  as,
  col,
  type Column,
  type CreateIndex,
  type CreateTable,
  type CreateView,
  type Derived,
  type Driver,
  eq,
  type Expr,
  fn,
  isNull,
  left,
  lit,
  notNull,
  NOW,
  render,
  type Row,
  scan,
  select,
  type Stmt,
  sub,
  table,
} from '@yaks/sql'
import { checks, objects, type Stood, stood } from './physical.ts'
import { unit } from './unit.ts'
import { busy } from './error.ts'
import { clocked, versioned } from './versions.ts'

import type { Statistics } from './meta.ts'
import { META, tables } from './layout.ts'
export { META, tables } from './layout.ts'

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
      col(field(c.prop)),
      [...c.values!, ...Object.keys(c.aliases ?? {})].map(lit),
    )
    : undefined

// A stored property's column. Affinity comes straight off the property as the
// vocabulary describes it; a reference carries a foreign key unless it is a
// `keep` reference, which must survive its target's tombstone and so carries
// none. `required` becomes NOT NULL; `default` and `enum` are emitted as above.
let column = (c: Prop): Column => ({
  name: field(c.prop),
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

// One declared index, named for what it covers (@yaks/sql `indexName`), so the
// same declaration always names the same index and a second install is a
// no-op. A partial one covers only the rows that hold its `present`
// properties: the rows without them are as many as they like, the rows with
// them are one.
let indexDdl = (v: Vocab, comp: string, i: Index): CreateIndex => ({
  t: 'create index',
  name: indexName(v, comp, i.props),
  on: comp,
  cols: i.props.map((p) => col(field(p))),
  unique: i.unique,
  ifNot: true,
  where: i.present ? and(...i.present.map((p) => notNull(col(p)))) : undefined,
})

/** The `doc` view: each property read as text — through its registered `text`
 * expression where the stored value is not the text itself (@yaks/blob keeps
 * an address) — plus a `rowid` alias. Search indexes are composed separately
 * by the application using @yaks/fts. */
export let docDdl = (v: Vocab, derived: Derived): Stmt[] => {
  if (!v.all.includes('doc')) return []
  let read = (prop: string) =>
    derived[`doc.${prop}`]?.text?.(col(prop)) ?? col(prop)
  let props = stored(v, 'doc').map((c) => c.prop)
  // The view names its columns rather than selecting `*`, because `*` cannot
  // replace one with the expression that resolves it. `*` did have one virtue —
  // it followed a table that gained columns — so the view is dropped and
  // recreated whenever it says something else ({@link retabled}): it holds no
  // rows, so recreating it costs nothing, and a view that lags its table is a
  // read that fails at the engine.
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
export let schema = (
  vocab: Vocab,
  derived: Derived = {},
  file = false,
): Stmt[] => [
  ...tabled(vocab, derived, file),
  // After every table: an index names a column the create above just raised.
  ...indexed(vocab),
]

// The spine and one table per component, with the doc view. Everything an
// index may need to already exist.
export let tabled = (
  vocab: Vocab,
  derived: Derived = {},
  file = false,
): Stmt[] => [
  ...spine(vocab),
  ...clocks(vocab, file).flatMap(versioned),
  ...docDdl(vocab, derived),
]

// The tables a file keeps a token for (./versions.ts): archetype, which every
// connection's catalog follows (./catalog.ts). A single-owner store sees its
// own writes and keeps none.
let clocks = (vocab: Vocab, file: boolean): string[] =>
  file && vocab.comp('archetype') ? ['archetype'] : []

let spine = (vocab: Vocab): Stmt[] => [
  ...SPINE,
  ...tables(vocab).map((name) => tableDdl(vocab, name)),
]

// Whether the file's view already says what `make` says. SQLite keeps a
// view's statement from its name on, behind a `CREATE VIEW` of its own.
let stands = (driver: Driver, make: CreateView): boolean => {
  let [row] = objects(driver, { type: 'view', name: make.name })
  let body = (sql: string) => sql.replace(/^create view /i, '')
  return !!row &&
    body(String(row.sql)) == body(render({ ...make, ifNot: false }).sql)
}

/** {@link tabled} for a file that may already hold them: the doc view is
 * dropped and made again only where the file's says something else. Making an
 * identical view again still changes the schema, and every other connection
 * to the file reads a changed schema as another install to answer. */
export let retabled = (
  driver: Driver,
  vocab: Vocab,
  derived: Derived = {},
): Stmt[] => {
  let view = docDdl(vocab, derived)
  let make = view.find((s): s is CreateView => s.t == 'create view')
  return [
    ...spine(vocab),
    ...clocked(driver, clocks(vocab, !!driver.file)),
    ...make && stands(driver, make) ? [] : view,
  ]
}

// Declared and automatic reference indexes. Created last, after `grown()`: an
// index may name a column its table only gained on this boot, and SQLite
// rejects one over a column that is not there yet.
export let indexed = (vocab: Vocab): CreateIndex[] => [
  // Adapters that only replay schema() may still have the old spine. Until
  // they opt into archetypes/migration, do not index a column they lack.
  ...(vocab.comp('archetype')
    ? [
      ...vocab.prop('entity', 'num')
        ? [
          indexDdl(vocab, 'entity', {
            props: ['archetype', 'num'],
            unique: false,
          }),
        ]
        : [indexDdl(vocab, 'entity', { props: ['archetype'], unique: false })],
    ]
    : []),
  ...tables(vocab)
    .flatMap((name) =>
      vocab.indexes(name).map((i) => indexDdl(vocab, name, i))
    ),
]

// A vocabulary index has the name of its table and indexed columns, joined by
// underscores or dots (@yaks/sql `indexName`). Inspect the engine's column list
// too: another package's index on a component table is not ours to retire
// merely because its name starts with that table's name.
let managed = (driver: Driver, table: string, name: string): boolean => {
  let cols = driver.query({ t: 'pragma', name: 'index_info', arg: name })
    .toSorted((a, b) => Number(a.seqno) - Number(b.seqno))
    .map((r) => r.name)
  return !!cols.length && cols.every((c) => typeof c == 'string') &&
    ['_', '.'].some((by) => name == [table, ...cols].join(by))
}

let predicate = (sql: string): string =>
  (sql.match(/\bwhere\b([\s\S]*)$/i)?.[1] ?? '')
    .toLowerCase().replace(/\s+/g, ' ').trim()

let fitsIndex = (
  held: Row | undefined,
  sql: string,
  now: CreateIndex,
): boolean =>
  !!held && Number(held.unique) == Number(!!now.unique) &&
  Number(held.partial) == Number(!!now.where) &&
  (!now.where || predicate(sql) == predicate(render(now).sql))

/** Retire vocabulary indexes whose declaration disappeared or changed. */
export let retired = (driver: Driver, vocab: Vocab): Stmt[] => {
  let wanted = new Map(indexed(vocab).map((i) => [i.name, i]))
  let listed = new Map<string, Map<string, Row>>()
  return objects(driver, { type: 'index' }).flatMap((row) => {
    let table = String(row.tbl_name), name = String(row.name)
    if (!(table == 'entity' || vocab.comp(table))) return []
    if (!managed(driver, table, name)) return []
    let now = wanted.get(name)
    if (now?.on == table) {
      let held = listed.get(table)
      if (!held) {
        held = new Map(
          driver.query({ t: 'pragma', name: 'index_list', arg: table })
            .map((r) => [String(r.name), r]),
        )
        listed.set(table, held)
      }
      if (fitsIndex(held.get(name), String(row.sql), now)) return []
    }
    return [{ t: 'drop' as const, kind: 'index' as const, name }]
  })
}

/**
 * Which revision of fitting ({@link grown}, {@link refit}) brings a standing
 * file to its vocabulary. What fitting changes it reads off the file, not off
 * the vocabulary, so a fingerprint of the statements alone calls a file
 * current that an older fitting left behind. This is part of every install's
 * fingerprint instead, and moving it fits every store once more: move it when
 * fitting learns to see something it did not.
 */
export let FIT = 7

/**
 * What fitting reads off a file before an install creates anything: each
 * table the vocabulary names that stood, and the spine. Only those can be
 * behind the vocabulary, since a table the install creates is already the
 * shape it says, so a fresh file is asked nothing.
 */
export type Standing = Record<string, Stood>

/** Whether fitting asks a file about the table `name`. */
export let fitting = (vocab: Vocab) => (name: string): boolean =>
  name == 'entity' || tables(vocab).includes(name)

/** The {@link Standing} a file holds now, read through a driver that answers
 * at once. */
export let standing = (driver: Driver, vocab: Vocab): Standing =>
  stood(driver, fitting(vocab))

// SQLite keeps the CREATE declaration without IF NOT EXISTS. An identical
// declaration already has every column and constraint fitting would check.
let declarations = new WeakMap<Vocab, Map<string, string>>()
let declaration = (sql: string) => sql.replace(/^create table /i, '')

/** Whether a table SQLite keeps the CREATE text `sql` of stands as `s`
 * declares it, every column and constraint included. */
export let declares = (sql: string | null, s: CreateTable): boolean =>
  sql != null &&
  declaration(sql) == declaration(render({ ...s, ifNot: false }).sql)
let declared = (vocab: Vocab) => {
  let held = declarations.get(vocab)
  if (!held) {
    held = new Map(
      tabled(vocab).filter((s): s is CreateTable => s.t == 'create table')
        .map((s) => [s.name, declaration(render({ ...s, ifNot: false }).sql)]),
    )
    declarations.set(vocab, held)
  }
  return held
}

let behind = (driver: Driver, vocab: Vocab): Standing => {
  let fresh = declared(vocab)
  let exact = new Set(
    objects(driver, { type: 'table' }).filter((t) =>
      declaration(String(t.sql)) == fresh.get(String(t.name))
    ).map((t) => String(t.name)),
  )
  let pick = fitting(vocab)
  return stood(driver, (name) => pick(name) && !exact.has(name))
}

// The component tables that stood.
let comps = (vocab: Vocab, was: Standing): string[] =>
  tables(vocab).filter((name) => name in was)

// Whether a table that stood already says what its fresh statement says about
// the three things only a rebuild changes: which columns are keyed to another
// table, what each column checks, and which refuse a null. A column the table
// lacks is `grown`'s, and arrives with its check. A column that refuses a null
// its vocabulary now allows (a property no longer `required`, or no longer
// named and kept for its values) could never be cleared, so it could never
// be cleared; a column that admits a null its vocabulary refuses is how
// `grown` adds one on purpose, and admission holds the writes.
let fits = (t: Stood, fresh: CreateTable, changes: number): boolean => {
  let keyed = fresh.cols.filter((c) => c.ref).map((c) => c.name)
  let checked = checks(render(fresh).sql)
  let names = ['', ...t.cols.map((r) => String(r.name).toLowerCase())]
  let loose = new Set(fresh.cols.filter((c) => !c.notNull).map((c) => c.name))
  return keyed.length == t.keys.length &&
    keyed.every((c) => t.keys.includes(c)) &&
    !changes &&
    names.every((n) => (t.checks[n] ?? '') == (checked[n] ?? '')) &&
    !t.cols.some((r) => Number(r.notnull) && loose.has(String(r.name)))
}

// An eid and its integer reference are two storage forms for one entity.
// Versions of an app can move in either direction, so resolve through the
// entity spine whenever its vocabulary changes that relation.
let referenceFields = (vocab: Vocab, comp: string): Set<string> =>
  new Set(
    stored(vocab, comp).filter((p) => p.category == 'ref').map((p) =>
      field(p.prop)
    ),
  )

let converted = (
  t: Stood,
  fresh: CreateTable,
  references: Set<string>,
): { name: string; from: string; to: string }[] =>
  fresh.cols.flatMap((c) => {
    let old = t.cols.find((r) => r.name == c.name)
    let type = String(old?.type).toLowerCase()
    if (references.has(c.name) && c.type == 'integer' && type == 'text') {
      return [{ name: c.name, from: 'eid', to: 'id' }]
    }
    if (
      !c.ref && c.type == 'text' && type == 'integer' &&
      t.keys.includes(c.name)
    ) {
      return [{ name: c.name, from: 'id', to: 'eid' }]
    }
    return []
  })

/** Values that cannot resolve through the entity spine. A failed conversion
 * must leave its old column untouched rather than turn a missing id into null. */
export let unresolved = (
  vocab: Vocab,
  was: Standing,
): Record<string, Stmt[]> =>
  Object.fromEntries(
    comps(vocab, was).flatMap((comp) => {
      let fresh = tableDdl(vocab, comp)
      let changes = converted(was[comp], fresh, referenceFields(vocab, comp))
      return changes.length
        ? [[
          comp,
          changes.map(({ name, from, to }) =>
            select({
              cols: [col(name, comp)],
              from: table(comp),
              joins: [left(
                table('entity', '__ref'),
                eq(
                  col(from, '__ref'),
                  col(name, comp),
                ),
              )],
              where: and(notNull(col(name, comp)), isNull(col(to, '__ref'))),
              limit: lit(1),
            })
          ),
        ]]
        : []
    }),
  )

/**
 * What rebuilding one table takes ({@link refit}): the table as its vocabulary
 * says it, the columns it has, the ones carried over, and the reference
 * columns whose stored form changes (an eid becoming the entity's integer id,
 * or back), each read through the entity spine.
 */
export type Refitting = {
  fresh: CreateTable
  old: string[]
  cols: string[]
  changed: Record<string, { from: string; to: string }>
}

/**
 * What {@link grown} cannot fix: a constraint the vocabulary changed its mind
 * about after a table was created. A reference's death word decides whether its
 * column carries a foreign key, an enum is its column's check (`closed`),
 * `required` is its NOT NULL, and SQLite alters none of them in place. So a
 * table whose keys or checks disagree with the vocabulary is rebuilt.
 *
 * Undeclared columns come back, even when empty: another process may have
 * installed a newer vocabulary. Removing a column is an explicit migration.
 * A kept column keeps its type and nothing else.
 *
 * Each table that needs it, by name: none for a file that already fits, which
 * is every boot but the one after the vocabulary changed.
 */
export let refitting = (
  vocab: Vocab,
  was: Standing,
): Record<string, Refitting> =>
  Object.fromEntries(
    comps(vocab, was).flatMap((comp) => {
      let t = was[comp]
      let said = new Set(stored(vocab, comp).map((c) => field(c.prop)))
      let extra = t.cols
        .filter((r) => r.name != 'entity' && !said.has(String(r.name)))
        .map((r) => ({
          name: String(r.name),
          type: String(r.type ?? '') || undefined,
        }))
      let fresh = tableDdl(vocab, comp, comp, extra)
      let refs = converted(t, fresh, referenceFields(vocab, comp))
      if (fits(t, fresh, refs.length)) return []
      let old = t.cols.map((r) => String(r.name))
      let cols = fresh.cols.map((r) => r.name).filter((n) => old.includes(n))
      let changed = Object.fromEntries(
        refs.map(({ name, from, to }) => [name, { from, to }]),
      )
      return [[comp, { fresh, old, cols, changed }]]
    }),
  )

/** The value `r` carries over for column `c`, read off `row`: as stored, or
 * through the entity spine where its stored form changes. */
export let carried = (r: Refitting, c: string, row: string): Expr => {
  let to = r.changed[c]
  return to
    ? sub(select({
      cols: [col(to.to)],
      from: table('entity'),
      where: eq(col(to.from), col(c, row)),
    }))
    : col(c, row)
}

/**
 * The statements rebuilding each table {@link refitting} names, in one unit:
 * its rows set aside as they are, the table made again as the vocabulary
 * says, and the rows brought back. It is made under its own name rather than
 * renamed into it, because a rename checks every view and trigger that names
 * the table while it is gone (`doc_value` names `doc`). The table's triggers
 * and undeclared indexes go with it, for whoever raised them to raise again at
 * boot (@yaks/fts `adopt`); the declared indexes are {@link indexed}'s, which
 * runs after. A table too big to rebuild in one unit is owed instead, and
 * rebuilt beside itself in windows (./owe.ts).
 */
export let refit = (
  vocab: Vocab,
  was: Standing,
): Record<string, Stmt[]> =>
  Object.fromEntries(
    Object.entries(refitting(vocab, was)).map(([comp, r]) => {
      let aside = `${comp}__refit`
      return [comp, [
        // A column of no type holds each value exactly as it was stored.
        {
          t: 'create table',
          name: aside,
          cols: r.old.map((name) => ({ name })),
        },
        {
          t: 'insert',
          into: aside,
          cols: r.old,
          q: select({ cols: r.old.map((c) => col(c)), from: table(comp) }),
        },
        { t: 'drop', kind: 'table', name: comp },
        r.fresh,
        {
          t: 'insert',
          into: comp,
          cols: r.cols,
          q: select({
            cols: r.cols.map((c) => carried(r, c, aside)),
            from: table(aside),
          }),
        },
        { t: 'drop', kind: 'table', name: aside },
      ]]
    }),
  )

// What `schema()` alone cannot do: add the columns a component gained after its
// table was already created. `create table if not exists` does nothing to a
// table that exists, so a vocabulary that gained a property leaves the table at
// the shape it was first created with, and every read naming the new column
// fails at the engine ("no such column"). SQLite has no `add column if not
// exists`, so the standing shape is read and only the missing columns are
// added.
//
// Additive only, and deliberately: nothing is dropped and nothing is retyped,
// because rows are already written under the columns the table has. A column
// is emitted in the form SQLite accepts in an `add column` (grownColumn above).
export let grown = (vocab: Vocab, was: Standing): Stmt[] => [
  ...(!was.entity || was.entity.cols.some((r) => r.name == 'archetype')
    ? []
    : [{
      t: 'alter table' as const,
      table: 'entity',
      add: { name: 'archetype', type: 'integer', ref: ENTITY },
    }]),
  ...comps(vocab, was).flatMap((comp) => {
    let has = new Set(was[comp].cols.map((r) => String(r.name)))
    return stored(vocab, comp)
      .filter((c) => !has.has(field(c.prop)))
      .map((c) => ({
        t: 'alter table' as const,
        table: comp,
        add: grownColumn(c),
      }))
  }),
]

/**
 * Bring the tables that stood to the vocabulary, through a driver that answers
 * at once: the columns they lack ({@link grown}), then a rebuild of each whose
 * constraints moved ({@link refit}), in one unit. A table whose rows do not fit
 * the shape the vocabulary now says (a value its enum no longer lists) is left
 * exactly as it stood, and returned with the engine's reason: those rows need a
 * migration that prepares them. Until one runs, the old constraint admits them,
 * and admission holds every new write to the vocabulary. A table `owe` takes
 * on is left for it to rebuild later.
 */
export let fit = (
  driver: Driver,
  vocab: Vocab,
  owe: (comp: string, r: Refitting) => boolean = () => false,
): Error[] =>
  unit(driver, () => {
    let was = behind(driver, vocab)
    for (let stmt of grown(vocab, was)) driver.query(stmt)
    let missing = Object.fromEntries(
      Object.entries(unresolved(vocab, was)).map(([comp, checks]) => [
        comp,
        checks.some((q) => driver.query(q).length),
      ]),
    )
    let plans = refitting(vocab, was)
    return Object.entries(refit(vocab, was)).flatMap(([comp, stmts]) => {
      if (missing[comp]) {
        return [
          new Error(
            `${comp} keeps its old shape: a reference names no entity`,
          ),
        ]
      }
      if (owe(comp, plans[comp])) return []
      try {
        unit(driver, () => stmts.forEach((s) => driver.query(s)))
        return []
      } catch (e) {
        return [unfit(comp, e)]
      }
    })
  })

/** Where a store tells what it outlived when its caller names nowhere else:
 * one line on the console. It is the state of the data, not a defect in the
 * code, so a stack says nothing, and it repeats on every open until fixed. */
export let logged = (e: Error): void =>
  console.error(`@yaks/sqlite: ${e.message}`)

/** What is reported of a table whose rebuild ({@link refit}) the engine
 * refused, `e` being its refusal: the table is as it stood. */
export let unfit = (comp: string, e: unknown): Error =>
  new Error(
    `${comp} keeps its old shape: its rows need a migration that prepares ` +
      `them for the vocabulary's (${e instanceof Error ? e.message : e})`,
    { cause: e },
  )

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
 * File drivers sample through optimize. Full-analysis engines (a Durable
 * Object's, which refuses `analysis_limit`) provide their stored bytes without
 * scanning rows and analyze a table at a time: this answers which tables are
 * owed ({@link owing}), and {@link analyzing} works them off a few at a time,
 * never inside the install that owed them, since one `ANALYZE` of a whole
 * file reads every row of every index. An unchanged store below
 * tenfold byte growth bills no rows for statistics, including after a
 * connection restart. A table empty at its last analysis that holds rows now
 * is owed, and so, after a schema change, is a populated table or index
 * without statistics. Existing complete statistics are adopted once by
 * installations predating receipts; empty tables are remembered and checked
 * with zero-billed counts.
 *
 * Optimize is not itself a durable gate: empty indexed tables get no stat1
 * row, so it analyzes them repeatedly, scanning existing stat1/stat4 entries
 * to delete records for each empty table. Its outer cursor omits this nested
 * work. So what is owed is kept in a receipt, and analyzed explicitly.
 * Ordinary reads never analyze. Scratch memory stores keep no statistics.
 *
 * Analyzing writes, so it needs the write lock, and every process that opens
 * the file runs it: `optimize` names every empty table on every open, since an
 * empty table gets no statistics row to say it was seen. It never waits for
 * that lock. With another process writing, the numbers stay as they are until
 * an open finds the lock free, and the open goes on at once; waiting out the
 * busy timeout here would stall the open behind a writer, and failing it would
 * refuse a command over an optimization.
 */
export let analyzed = (
  driver: Driver,
  previous?: Statistics,
  unchanged = false,
): Statistics | undefined => {
  if (!driver.statistics) return
  if (typeof driver.statistics == 'object') {
    return owing(driver, driver.statistics.bytes(), previous, unchanged)
  }
  let optimize = () => {
    if (driver.statistics == 'sampled') {
      driver.query({ t: 'pragma', name: 'analysis_limit', value: SAMPLE })
    }
    driver.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
  }
  if (!driver.file) {
    optimize()
    return
  }
  atOnce(driver, () => {
    optimize()
  })
}

// A table remembered as empty may have filled since installation. Probe only
// one row: a plain count bills every owner once it is no longer empty.
let populated = (driver: Driver, name: string) =>
  driver.query(select({ cols: [lit(1)], from: table(name), limit: lit(1) }))
    .length > 0

// Whether a table remembered by name is still there: a catalogue read, no rows.
let extant = (driver: Driver, name: string) =>
  driver.query({ t: 'pragma', name: 'table_list', arg: name }).length > 0

// Whether a table expected to hold rows does: one billed row at most.
let holds = (driver: Driver, name: string) =>
  driver.query(select({ cols: [lit(1)], from: table(name), limit: lit(1) }))
    .length > 0

let joined = (owed: string[] = [], more: string[]) => [
  ...new Set([...owed, ...more]),
]

/**
 * The planner statistics a full-analysis engine owes, as the receipt keeps
 * them (./meta.ts `Statistics`), or undefined where nothing new is owed or
 * the store holds nothing to analyze. Deciding reads no rows of any table that
 * holds some: the stored bytes, zero-billed counts of the tables remembered
 * empty, and after a schema change the catalogue and the statistics standing.
 * A table owed stays owed until {@link analyzing} reaches it, and one
 * remembered empty that has been dropped since is forgotten.
 */
let owing = (
  driver: Driver,
  bytes: number,
  previous: Statistics | undefined,
  unchanged: boolean,
): Statistics | undefined => {
  let owed = previous?.owed ?? []
  if (previous && unchanged && bytes < previous.bytes * 10) {
    let empty = previous.empty.filter((name) => extant(driver, name))
    let filled = empty.filter((name) => populated(driver, name))
    if (!filled.length && empty.length == previous.empty.length) return
    return {
      bytes: previous.bytes,
      empty: empty.filter((name) => !filled.includes(name)),
      owed: joined(owed, filled),
    }
  }
  let tables = driver.query({ t: 'pragma', name: 'table_list' })
  let names = tables.filter((r) =>
    r.schema == 'main' &&
    (r.type == 'table' || r.type == 'shadow') &&
    !/^sqlite_|^_+cf_/i.test(String(r.name))
  )
  let stats = tables.some((r) => r.name == 'sqlite_stat1')
    ? scan(driver, 'sqlite_stat1', undefined, ['tbl', 'idx'])
    : []
  let taken = new Set(stats.map((r) => String(r.tbl)))
  let indexes = new Set(stats.map((r) => String(r.idx)))
  // Adopt the statistics that stand, and owe the populated tables lacking
  // them: one with statistics for some of its indexes held rows when it was
  // analyzed, and one with none that is not owed already is counted for rows
  // at no billed cost while it holds none.
  if (
    previous ? bytes < previous.bytes * 10 : unchanged && taken.has('entity')
  ) {
    let missing = names.map((r) => String(r.name))
      .filter((name) => !taken.has(name) && !owed.includes(name))
    let filled = missing.filter((name) => populated(driver, name))
    let partial = names.filter((r) =>
      taken.has(String(r.name)) &&
      driver.query({ t: 'pragma', name: 'index_list', arg: String(r.name) })
        .some((i) =>
          !indexes.has(String(r.wr == 1 && i.origin == 'pk' ? r.name : i.name))
        )
    ).map((r) => String(r.name))
    return {
      bytes: previous?.bytes ?? bytes,
      empty: missing.filter((name) => !filled.includes(name)),
      owed: joined(owed, [...partial, ...filled]),
    }
  }
  if (!holds(driver, 'entity')) return
  // Tenfold growth, or no statistics to adopt: every table that holds rows
  // afresh, found at a billed row a table, and the bytes stored now are what
  // the next growth is measured from.
  let all = names.map((r) => String(r.name))
  let filled = all.filter((name) => holds(driver, name))
  return {
    bytes,
    empty: all.filter((name) => !filled.includes(name)),
    owed: filled,
  }
}

/**
 * Analyze up to `n` of the tables `statistics` owes, one `ANALYZE` each, and
 * answer the receipt that follows: those tables no longer owed, and each that
 * holds no rows remembered as empty, since no statistics row will. A table
 * dropped since it was owed is no longer owed. Each statement reads that
 * table's index rows, so a caller bounds `n` to keep a window short.
 */
export let analyzing = (
  driver: Driver,
  statistics: Statistics,
  n: number,
): Statistics => {
  let owed = statistics.owed ?? []
  let taken = owed.slice(0, n)
  let empty = statistics.empty.filter((name) => !taken.includes(name))
  for (let name of taken) {
    if (!extant(driver, name)) continue
    driver.query({ t: 'analyze', table: name })
    if (!holds(driver, name)) empty.push(name)
  }
  return { bytes: statistics.bytes, empty, owed: owed.slice(taken.length) }
}

/** `body` now or not at all: run with no busy timeout, so where another
 * connection holds the lock it needs, it answers `undefined` at once instead
 * of waiting the timeout out. For work that can as well happen on a later
 * call, which a caller should not wait a minute behind a writer for. */
export let atOnce = <R>(driver: Driver, body: () => R): R | undefined => {
  let wait = driver.query({ t: 'pragma', name: 'busy_timeout' })[0]?.timeout
  let set = (value: number) =>
    driver.query({ t: 'pragma', name: 'busy_timeout', value })
  set(0)
  try {
    return body()
  } catch (e) {
    if (!busy(e)) throw e
  } finally {
    set(Number(wait ?? 0))
  }
}
