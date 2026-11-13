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
import { type Index, loadVocab, type Prop, type Vocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype/sets'
import {
  among,
  and,
  as,
  col,
  type Column,
  count,
  type CreateIndex,
  type CreateTable,
  type CreateView,
  type Derived,
  type Driver,
  eq,
  exists,
  type Expr,
  fn,
  from,
  gt,
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
  val,
} from '@yaks/sql'
import {
  checks,
  foreign,
  objects,
  sole,
  type Stood,
  stood,
} from './physical.ts'
import { unit } from './unit.ts'
import { clocked, versioned } from './versions.ts'
import { telling, writtenDdl } from './written.ts'
import { tallying } from './population.ts'

import type { Counting, Statistics } from './meta.ts'
import { META, tables } from './layout.ts'
export { META, tables } from './layout.ts'

// A column that holds an entity's integer id, keyed to the spine.
let ENTITY = { table: 'entity', cols: ['id'] }

// The high-water mark a new number is taken past, raised by whatever wrote one:
// the store's one count, and the count of the series a lettered number is in.
let raise: Stmt = {
  t: 'update',
  table: 'entity_sequence',
  set: { high: fn('max', col('high'), col('num', 'new')) },
  where: eq(col('singleton'), lit(1)),
}
let raiseSeries: Stmt = {
  t: 'insert',
  into: 'entity_series',
  cols: ['prefix', 'high'],
  rows: [[col('prefix', 'new'), col('num', 'new')]],
  upsert: [{
    on: [col('prefix')],
    set: { high: fn('max', col('high'), col('high', 'excluded')) },
  }],
}
let lettered = and(notNull(col('num', 'new')), notNull(col('prefix', 'new')))

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
      { name: 'num', type: 'integer' },
      { name: 'archetype', type: 'integer', ref: ENTITY },
      { name: 'prefix', type: 'text' },
    ],
  },
  // Each series' high-water mark, by its letter: what the next number in it
  // is taken past (./write.ts `series`).
  {
    t: 'create table',
    name: 'entity_series',
    ifNot: true,
    cols: [
      { name: 'prefix', type: 'text', pk: true },
      { name: 'high', type: 'integer', notNull: true },
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
    t: 'create trigger',
    name: 'entity_series_insert',
    ifNot: true,
    timing: 'after',
    event: 'insert',
    on: 'entity',
    when: lettered,
    body: [raiseSeries],
  },
  {
    t: 'create trigger',
    name: 'entity_series_update',
    ifNot: true,
    timing: 'after',
    event: 'update',
    of: ['num', 'prefix'],
    on: 'entity',
    when: lettered,
    body: [raiseSeries],
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
  ...told(vocab, file),
  ...docDdl(vocab, derived),
]

// The tables a file keeps a token for (./versions.ts): archetype, which every
// connection's catalog follows (./catalog.ts). A single-owner store sees its
// own writes and keeps none.
let clocks = (_vocab: Vocab, file: boolean): string[] =>
  file ? ['archetype'] : []

// Which entity each write named, for a file's other connections to let go of
// just those (./written.ts). A single-owner store keeps no log either.
let told = (vocab: Vocab, file: boolean): Stmt[] =>
  file ? writtenDdl(tables(vocab)) : []

let spine = (vocab: Vocab): Stmt[] => [
  ...SPINE,
  ...tables(vocab).map((name) => tableDdl(vocab, name)),
  ...pointed(vocab),
]

// The archetype descriptors and their retirements (@yaks/archetype), which
// every file keeps whether or not its vocabulary declares them: each entity's
// pointer says which tables hold it, and every whole read and removal goes by
// it (./archetype.ts). A vocabulary that declares them makes their tables with
// its own; for one that does not they are made here, and stay the store's own
// bookkeeping, which its reads never show.
let POINTED = loadVocab([archetypeDoc])
let pointedIndex = (vocab: Vocab): CreateIndex =>
  indexDdl(vocab, 'entity', {
    props: vocab.prop('entity', 'num') ? ['archetype', 'num'] : ['archetype'],
    unique: false,
  })
export let pointerIndex: CreateIndex = pointedIndex(POINTED)
let pointed = (vocab: Vocab): Stmt[] =>
  tables(POINTED).filter((name) => !vocab.comp(name))
    .map((name) => tableDdl(POINTED, name))

// Whether the file's view already says what `make` says. SQLite keeps a
// view's statement from its name on, behind a `CREATE VIEW` of its own.
let stands = (driver: Driver, make: CreateView): boolean => {
  let [row] = objects(driver, { type: 'view', name: make.name })
  let body = (sql: string) => sql.replace(/^create view /i, '')
  return !!row &&
    body(String(row.sql)) == body(render({ ...make, ifNot: false }).sql)
}

// What `retabled` answers by vocabulary and read overrides: the doc view, and
// each list it made for a file whose clocks stand as they should, by whether
// the file is one and its view stands. The same list each time, so what rests
// on what in it (./raise.ts `rests`) is worked out once, as for `indexed`.
let retables = new WeakMap<
  Vocab,
  WeakMap<Derived, { view: Stmt[]; lists: Map<string, readonly Stmt[]> }>
>()

/** {@link tabled} for a file that may already hold them: the doc view is
 * dropped and made again only where the file's says something else. Making an
 * identical view again still changes the schema, and every other connection
 * to the file reads a changed schema as another install to answer. */
export let retabled = (
  driver: Driver,
  vocab: Vocab,
  derived: Derived = {},
): readonly Stmt[] => {
  let by = retables.get(vocab) ?? new WeakMap()
  retables.set(vocab, by)
  let k = by.get(derived)
  if (!k) {
    by.set(derived, k = { view: docDdl(vocab, derived), lists: new Map() })
  }
  let file = !!driver.file
  let make = k.view.find((s): s is CreateView => s.t == 'create view')
  let shown = !!make && stands(driver, make)
  let clock = clocked(driver, clocks(vocab, file))
  let key = `${file} ${shown}`
  let held = clock.length ? undefined : k.lists.get(key)
  if (held) return held
  let made = [
    ...spine(vocab),
    ...clock,
    ...told(vocab, file),
    ...shown ? [] : k.view,
  ]
  if (!clock.length) k.lists.set(key, made)
  return made
}

// Declared and automatic reference indexes. Created last, after `grown()`: an
// index may name a column its table only gained on this boot, and SQLite
// rejects one over a column that is not there yet. Kept per vocabulary, the
// way the statements resting on them are (./raise.ts `rests`): every store of
// a vocabulary asks for the same list as it opens.
let indexes = new WeakMap<Vocab, readonly CreateIndex[]>()
export let indexed = (
  vocab: Vocab,
  storage = false,
): readonly CreateIndex[] => {
  let held = indexes.get(vocab)
  if (!held) indexes.set(vocab, held = indexing(vocab))
  return storage
    ? [
      ...SPINED_INDEXES,
      ...vocab.comp('archetype') ? [] : [pointedIndex(vocab)],
      ...held,
    ]
    : held
}
// One entity to a number in each series, and the number's own lookup: a
// number is read without its letter (@yaks/id `ids`). A storage install
// makes it after `grown()`, which gives a standing spine its prefix; a bare
// schema may stand over a spine that has none.
let SERIES: CreateIndex = {
  t: 'create index',
  name: 'entity_num_prefix',
  on: 'entity',
  cols: [col('num'), col('prefix')],
  unique: true,
  ifNot: true,
}
// The default order, newest number first and then the owner (@yaks/sql
// `bind`), read off an index in that order: the series index puts the
// letter before the owner, so a page of `.limit=1` sorted the whole spine,
// 6.5 million rows on the box, to give one. An index on the number alone
// ends in the owner, as every index does.
let NUMBERED: CreateIndex = {
  t: 'create index',
  name: 'entity_num',
  on: 'entity',
  cols: [col('num')],
  ifNot: true,
}
let SPINED_INDEXES = [SERIES, NUMBERED]

/** Whether `index` is one of the number's indexes over a spine that keeps
 * `num` unique on its own (./physical.ts `sole`). That spine's own index
 * already holds one entity to a number, so one to each pair, finds a number
 * without its letter and reads the default order, and the spine counts once
 * (./write.ts `unmoved`); building either over it would only write a row per
 * entity, in one statement past what an object may write in a minute once a
 * store holds 100,000. A spine rebuilt without its own index needs them. */
export let needless = (driver: Driver, index: CreateIndex): boolean =>
  SPINED_INDEXES.some((i) => i.name == index.name && i.on == index.on) &&
  sole(driver)

/** The storage indexes an install builds over a file: every one of
 * {@link indexed} but a {@link needless} one. An index owed before it became
 * needless is forgotten where it is worked off (./owe.ts, ./maintenance.ts),
 * since an install whose schema stands as it was never looks again. */
export let built = (driver: Driver, vocab: Vocab): readonly CreateIndex[] =>
  indexed(vocab, true).filter((i) => !needless(driver, i))
let indexing = (vocab: Vocab): CreateIndex[] => [
  // Bare schema adapters can still hold the legacy spine. A storage install
  // asks for its internal pointer index after adding the column.
  ...vocab.comp('archetype') ? [pointedIndex(vocab)] : [],
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

// The SQL SQLite keeps for an index made by `create`: its statement as it
// renders, but for `if not exists`, which the engine leaves out, and its
// leading keywords, which the engine keeps in capitals.
let made = (create: CreateIndex): string =>
  render({ ...create, ifNot: false }).sql
    .replace(/^create (unique )?index/, (k) => k.toUpperCase())

/** Retire vocabulary indexes whose declaration disappeared or changed. An
 * index whose kept SQL is the one its declaration makes is as declared, and
 * the engine is asked nothing about it. */
export let retired = (driver: Driver, vocab: Vocab): Stmt[] => {
  let wanted = new Map(indexed(vocab, true).map((i) => [i.name, i]))
  let listed = new Map<string, Map<string, Row>>()
  return objects(driver, { type: 'index' }).flatMap((row) => {
    let table = String(row.tbl_name), name = String(row.name)
    if (!(table == 'entity' || vocab.comp(table))) return []
    let now = wanted.get(name)
    if (now?.on == table && row.sql == made(now)) return []
    if (!managed(driver, table, name)) return []
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
export let FIT = 10

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

/** The tables the file declares exactly as the vocabulary does. Adding or
 * dropping a column rewrites the declaration SQLite keeps, so each of these
 * has every column and constraint, and nothing need ask it about them. */
export let exact = (driver: Driver, vocab: Vocab): Set<string> => {
  let fresh = declared(vocab)
  return new Set(
    objects(driver, { type: 'table' }).filter((t) =>
      declaration(String(t.sql)) == fresh.get(String(t.name))
    ).map((t) => String(t.name)),
  )
}

/** The {@link Standing} of each table that stood other than as the vocabulary
 * declares it: what fitting, or a reader, must ask the file about. */
export let behind = (
  driver: Driver,
  vocab: Vocab,
  kept = exact(driver, vocab),
): Standing => {
  let pick = fitting(vocab)
  return stood(driver, (name) => pick(name) && !kept.has(name))
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
  ...[
    { name: 'archetype', type: 'integer', ref: ENTITY },
    { name: 'prefix', type: 'text' },
  ].filter((c) => was.entity && !was.entity.cols.some((r) => r.name == c.name))
    .map((add) => ({ t: 'alter table' as const, table: 'entity', add })),
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

// The spine as it is declared, and what is raised on it.
let SPINED = SPINE.find((s): s is CreateTable =>
  s.t == 'create table' && s.name == 'entity'
)!
let ON_SPINE = SPINE.filter((s) => s.t == 'create trigger' && s.on == 'entity')

// Every trigger this package raises on the spine, by name: its own counts', the
// archetype counts' (./population.ts) and the write log's (./written.ts).
let SPUN = new Map(
  [...ON_SPINE, ...tallying, ...telling('entity')]
    .map((s) => [(s as { name: string }).name, s]),
)

// The triggers to raise again on a spine made anew: its own, and each other
// that stood on it. One this package does not make would be lost, so it is
// refused before anything moves.
let spun = (driver: Driver): Stmt[] => {
  let stood = objects(driver, { tbl_name: 'entity', type: 'trigger' })
    .map((o) => o.name)
  let alien = stood.filter((name) => !SPUN.has(name))
  if (alien.length) {
    throw new Error(
      `the spine holds triggers this package does not make: ${
        alien.join(', ')
      }`,
    )
  }
  let names = new Set(stood)
  return [
    ...ON_SPINE,
    ...[...SPUN.values()].filter((s) =>
      !ON_SPINE.includes(s) && names.has((s as { name: string }).name)
    ),
  ]
}

/** The column a spine's number moves out of when it stops being unique on its
 * own ({@link respined}): it keeps that old constraint, and no value. */
export let RETIRED_NUM = 'retired_num'

/**
 * The spine moved off a number unique on its own (./physical.ts `sole`), as
 * every spine made before series had letters keeps it: there T-5 and M-5
 * cannot both stand, so a store that numbers by series counts once until it
 * is moved. SQLite drops a column's `unique` only with its table, and
 * dropping the spine with foreign keys on, as a Durable Object keeps them,
 * deletes each row and checks every table naming it, and putting the rows
 * back checks each again: a store's entities times the hundreds of
 * references to them. So no row moves. The column holding the old constraint
 * is renamed {@link RETIRED_NUM} and emptied, and a new `num` takes its
 * numbers; an update of columns no reference names checks none. The spine's
 * indexes and triggers name its number, so they are dropped first and its
 * triggers raised again after. Its indexes are the install's to raise.
 */
export let respined = (driver: Driver): Stmt[] => {
  if (!sole(driver)) return []
  let raised = spun(driver)
  let on = objects(driver, { tbl_name: 'entity' })
    .filter((o) => o.sql && (o.type == 'index' || o.type == 'trigger'))
  return [
    ...on.map((o): Stmt => ({
      t: 'drop',
      kind: o.type as 'index' | 'trigger',
      name: o.name,
    })),
    {
      t: 'alter table',
      table: 'entity',
      rename: { column: 'num', to: RETIRED_NUM },
    },
    {
      t: 'alter table',
      table: 'entity',
      add: SPINED.cols.find((c) => c.name == 'num')!,
    },
    {
      t: 'update',
      table: 'entity',
      set: { num: col(RETIRED_NUM), [RETIRED_NUM]: lit(null) },
      // The numbered rows only, through the retired column's own index: the
      // rest hold none to move, and on the box they are 97% of six million.
      where: notNull(col(RETIRED_NUM)),
    },
    ...raised,
  ]
}

/** The spine rebuilt where it keeps a number unique on its own
 * ({@link respined}), in a unit of its own: one the engine refused is left as
 * it stood, and returned with the engine's reason. */
export let respine = (driver: Driver): Error[] => {
  try {
    let stmts = respined(driver)
    if (!stmts.length) return []
    unit(driver, () => stmts.forEach((s) => driver.query(s)))
    return []
  } catch (e) {
    return [unfit('entity', e)]
  }
}

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
 * unbounded one costs 5.4 s. The sample does not bound the count: `ANALYZE`
 * still reads every page of an index, or of a table with none, to count its
 * rows, so a table with no index is counted in windows instead
 * ({@link counted}).
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
 * Installation analyzes nothing: it answers the receipt of which tables are
 * owed an analysis ({@link owing}), and {@link analyzing} works them off a
 * table at a time, away from the install that owed them (./owe.ts `work` on a
 * file, a Durable Object's alarm), since one `ANALYZE` holds the write lock
 * while it reads its table. A file's analysis is sampled ({@link SAMPLE}),
 * and a table of its with no index is counted a window at a time in a
 * snapshot, holding no lock ({@link counted});
 * a full-analysis engine (a Durable Object's, which refuses `analysis_limit`)
 * provides its stored bytes without scanning rows. An unchanged store below
 * tenfold byte growth bills no rows for statistics, including after a
 * connection restart. A table empty at its last analysis that holds rows now
 * is owed, and so, after a schema change, is a populated table or index
 * without statistics. Existing complete statistics are adopted once by
 * installations predating receipts; empty tables are remembered and checked
 * with zero-billed counts.
 *
 * Optimize decides none of it: empty tables get no stat1 row, so it names
 * them on every run, and it names as often a table whose row count it guesses
 * wrong from one page, such as one of variable-sized rows, which `ANALYZE`
 * then counts end to end under the write lock. Only a database in memory,
 * which nobody else writes, still optimizes at once.
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
  if (driver.file) return owing(driver, size(driver), previous, unchanged)
  sample(driver)
  driver.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
}

// The bytes a file stores, as its pages say, reading no rows.
let size = (driver: Driver) => {
  let first = (name: string) =>
    Number(Object.values(driver.query({ t: 'pragma', name })[0] ?? {})[0] ?? 0)
  return first('page_count') * first('page_size')
}

// A sampled analysis reads a bounded share of each index.
let sample = (driver: Driver) => {
  if (driver.statistics == 'sampled') {
    driver.query({ t: 'pragma', name: 'analysis_limit', value: SAMPLE })
  }
}

// Those of `names` that hold a row, asked in one statement: a plain count
// bills every row of a table, and this one row at most of each, as a probe of
// its own would, but one statement for all of them.
let populated = (driver: Driver, names: string[]): string[] => {
  let filled: string[] = []
  for (let i = 0; i < names.length; i += PROBES) {
    let some = names.slice(i, i + PROBES)
    let [row] = driver.query(select({
      cols: some.map((name, j) =>
        as(
          exists(select({ cols: [lit(1)], from: table(name), limit: lit(1) })),
          `t${j}`,
        )
      ),
    }))
    filled.push(...some.filter((_, j) => Number(row[`t${j}`])))
  }
  return filled
}

// Below SQLite's column limit and a Durable Object's, for one statement's
// probes.
let PROBES = 100

// Whether a table remembered by name is still there: a catalogue read, no rows.
let extant = (driver: Driver, name: string) =>
  driver.query({ t: 'pragma', name: 'table_list', arg: name }).length > 0

// Whether a table expected to hold rows does: one billed row at most.
let holds = (driver: Driver, name: string) =>
  populated(driver, [name]).length > 0

let joined = (owed: string[] = [], more: string[]) => [
  ...new Set([...owed, ...more]),
]

// Whether a table of the catalogue's list is one statistics are kept for:
// the file's own, not the engine's.
let kept = (r: Row) =>
  r.schema == 'main' &&
  (r.type == 'table' || r.type == 'shadow') &&
  !foreign(String(r.name))

/** The tables planner statistics are kept for ({@link analyzed}). */
export let analyzable = (driver: Driver): string[] =>
  driver.query({ t: 'pragma', name: 'table_list' }).filter(kept)
    .map((r) => String(r.name))

/** `statistics`, remembering as empty each of `made`, tables made since it
 * was taken: one a first write makes (./raise.ts) is made empty, and is owed
 * an analysis once it holds rows, as one an install made would be. */
export let emptied = (
  statistics: Statistics,
  made: readonly string[],
): Statistics => ({
  ...statistics,
  empty: [...new Set([...statistics.empty, ...made])],
})

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
    let standing = new Set(
      driver.query({ t: 'pragma', name: 'table_list' }).map((r) =>
        String(r.name)
      ),
    )
    let empty = previous.empty.filter((name) => standing.has(name))
    let filled = populated(driver, empty)
    if (!filled.length && empty.length == previous.empty.length) return
    return {
      bytes: previous.bytes,
      empty: empty.filter((name) => !filled.includes(name)),
      owed: joined(owed, filled),
    }
  }
  let tables = driver.query({ t: 'pragma', name: 'table_list' })
  let names = tables.filter(kept)
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
    previous ? bytes < previous.bytes * 10 : taken.has('entity')
  ) {
    let missing = names.map((r) => String(r.name))
      .filter((name) => !taken.has(name) && !owed.includes(name))
    let filled = populated(driver, missing)
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
  let filled = populated(driver, all)
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
  if (taken.length) sample(driver)
  for (let name of taken) {
    if (!extant(driver, name)) continue
    driver.query({ t: 'analyze', table: name })
    if (!holds(driver, name)) empty.push(name)
  }
  return { bytes: statistics.bytes, empty, owed: owed.slice(taken.length) }
}

/**
 * Whether a file's statistics for `name` are taken by counting its rows
 * ({@link tally}) instead of by `ANALYZE`: a rowid table with no index, whose
 * only statistic is its row count. `ANALYZE` counts such a table by reading
 * every page of it under the write lock, whatever `analysis_limit` says, so on
 * the box's 10 GB file one table held it 20 s (bug bace8585). Every component
 * table is one, and so is a text index's data.
 */
export let counted = (driver: Driver, name: string): boolean =>
  driver.statistics == 'sampled' && extant(driver, name) &&
  !driver.query({ t: 'pragma', name: 'index_list', arg: name }).length

/** One window of counting a table ({@link tally}): how far the count has got,
 * the rowid the window started past, and whether it read the last row. */
export type Tallied = Counting & { since?: number; done: boolean }

/**
 * One window of counting the first table `statistics` owes ({@link counted}):
 * up to `n` of its rows past where `statistics.counting` stopped, read by
 * rowid alone, in the caller's snapshot. A row written behind the count is
 * missed and one deleted is counted; the planner needs only the order of
 * magnitude.
 */
export let tally = (
  driver: Driver,
  statistics: Statistics,
  n: number,
): Tallied => {
  let name = statistics.owed![0]
  let at = statistics.counting?.table == name
    ? statistics.counting
    : { table: name, rows: 0 }
  let [r] = driver.query(select({
    cols: [as(count(), 'n'), as(fn('max', col('id')), 'last')],
    from: from(
      select({
        cols: [as(col('rowid'), 'id')],
        from: table(name),
        where: at.after == null ? undefined : gt(col('rowid'), val(at.after)),
        order: [col('rowid')],
        limit: val(n),
      }),
      'r',
    ),
  }))
  let read = Number(r?.n ?? 0)
  return {
    table: name,
    rows: at.rows + read,
    after: read ? Number(r.last) : at.after,
    since: at.after,
    done: read < n,
  }
}

/**
 * The receipt that follows a window of counting ({@link tally}), in the unit
 * that writes it: the count so far, or once it is `done`, the table's
 * statistics written as `ANALYZE` writes a table with no index's (its count,
 * or no row for an empty table, remembered as empty), and the table no longer
 * owed. A receipt that moved since the window read it is answered as it
 * stands, and the next window reads again.
 */
export let tallied = (
  driver: Driver,
  statistics: Statistics,
  { since, done, ...counting }: Tallied,
): Statistics => {
  let [name, ...rest] = statistics.owed ?? []
  let standing = statistics.counting?.table == name
    ? statistics.counting
    : undefined
  if (name != counting.table || standing?.after != since) return statistics
  if (!done) return { ...statistics, counting }
  let empty = statistics.empty.filter((e) => e != name)
  if (extant(driver, name)) {
    stated(driver, name, counting.rows)
    if (!counting.rows) empty.push(name)
  }
  return { bytes: statistics.bytes, empty, owed: rest }
}

// Write `rows` as the statistics of `name`, a table with no index, and have
// the planner read them again: `ANALYZE sqlite_schema` reads no table, and
// makes `sqlite_stat1` where none stands.
let stated = (driver: Driver, name: string, rows: number) => {
  let reload = () => driver.query({ t: 'analyze', table: 'sqlite_schema' })
  if (!extant(driver, 'sqlite_stat1')) reload()
  driver.query({
    t: 'delete',
    from: 'sqlite_stat1',
    where: eq(col('tbl'), val(name)),
  })
  if (rows) {
    driver.query({
      t: 'insert',
      into: 'sqlite_stat1',
      cols: ['tbl', 'idx', 'stat'],
      rows: [[val(name), val(null), val(String(rows))]],
    })
  }
  reload()
}
