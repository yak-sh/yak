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
//   tombstone     a deleted entity keeps its `entity` row (its integer id can
//                 never recycle) and gains a tombstone row; reads exclude it.
//   <component>   one table per component, keyed by an `entity` integer owner.
//                 A scalar column stores its value; a reference stores the
//                 referent's integer id; a component with no columns is a bare
//                 tag whose presence is the fact.
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
// Columns are nullable by default: a patch may create a row from any subset of
// its columns (that is what PATCH means), so a column requires a value only
// where the vocabulary declares one — a `required` column is NOT NULL, and the
// row that omits it is rejected by the engine unless a `default` fills it. An
// `enum` becomes a check, so a value outside the set is rejected where it is
// written. A reference carries a foreign key so a dangling id is rejected by
// the engine, except a `keep` reference, which outlives the row it points at
// and stays key-free.

import type { Index, Prop, Vocab } from '@yaks/vocab'
import type { Driver } from './driver.ts'

/**
 * The key/value table's name. Named `server_meta`, not `meta`, because a
 * vocabulary may well declare a `meta` component and the two must never collide
 * — and because that is the name the fleet's live table already carries, so
 * installing over one adopts it instead of creating a second.
 */
export let META = 'server_meta'

// The identity table, the tombstones, and the store's own key/value. Fixed
// shape — every layout has exactly this spine, whatever components sit on
// it.
let SPINE = [
  `create table if not exists entity (
    id   integer primary key,
    eid  text not null unique,
    num  integer unique,
    archetype integer references entity(id)
  )`,
  `create table if not exists entity_sequence (singleton integer primary key check(singleton = 1), high integer not null)`,
  `insert into entity_sequence (singleton, high) select 1, coalesce(max(num), 0) from entity where true
    on conflict(singleton) do update set high = max(high, excluded.high)`,
  `create trigger if not exists entity_number_insert after insert on entity when new.num is not null
    begin update entity_sequence set high = max(high, new.num) where singleton = 1; end`,
  `create trigger if not exists entity_number_update after update of num on entity when new.num is not null
    begin update entity_sequence set high = max(high, new.num) where singleton = 1; end`,
  `create table if not exists tombstone (
    entity     integer primary key references entity(id),
    deleted_at text not null
  )`,
  // Keyed by `k`, valued by `v`, and nothing else: whatever an application
  // keeps here it keeps as text under a name it chose (./meta.ts).
  `create table if not exists ${META} (
    k text primary key,
    v text not null
  )`,
]

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`
let lit = (s: string): string => `'${s.replaceAll("'", "''")}'`

// The current time, as SQLite formats the instant a row is written — the same
// ISO form every `at` column carries, so a defaulted timestamp reads like a
// server-written one.
export let NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

// A column's default as SQL: the current time, or a literal a row takes when
// the writer supplied no value. A boolean stores as the integer it reads back
// as.
let defaultSql = (c: Prop): string | undefined => {
  let d = c.default
  if (!d) return undefined
  if ('now' in d) return NOW
  let v = d.value
  return typeof v == 'string'
    ? lit(v)
    : typeof v == 'boolean'
    ? (v ? '1' : '0')
    : String(v)
}

// A closed set's check. Every value the vocabulary admits on the way in is
// admitted here too (an alias is an accepted input value), so the engine never
// rejects what the loader accepted.
let checkSql = (c: Prop): string | undefined =>
  c.category == 'enum'
    ? `check(${q(c.prop)} in (${
      [...c.values!, ...Object.keys(c.aliases ?? {})].map(lit).join(', ')
    }))`
    : undefined

// A stored column's DDL fragment. Affinity comes straight off the column as the
// vocabulary describes it; a reference carries a foreign key unless it is a
// `keep` reference, which must survive its target's tombstone and so carries
// none. `required` becomes NOT NULL; `default` and `enum` are emitted as
// above.
let colDdl = (c: Prop): string => {
  let d = defaultSql(c)
  let parts = [
    q(c.prop),
    c.affinity,
    c.required ? 'not null' : '',
    d ? `default ${d}` : '',
    checkSql(c) ?? '',
    c.category == 'ref' && c.fk ? 'references entity(id)' : '',
  ]
  return parts.filter(Boolean).join(' ')
}

// The same column added to a standing table. SQLite refuses `add column` a
// NOT NULL without a constant default and any default that is an expression,
// so a grown column keeps its literal default and its CHECK, arrives NOT NULL
// only when a literal fills the rows already there, and takes the clock only
// on rows written from now on (the writer stamps them; ddl.ts NOW is for the
// row that omits it).
let grownDdl = (c: Prop): string => {
  let d = c.default && 'value' in c.default ? defaultSql(c) : undefined
  let parts = [
    q(c.prop),
    c.affinity,
    c.required && d ? 'not null' : '',
    d ? `default ${d}` : '',
    checkSql(c) ?? '',
    c.category == 'ref' && c.fk ? 'references entity(id)' : '',
  ]
  return parts.filter(Boolean).join(' ')
}

// Which of a component's declared columns are stored: everything the vocabulary
// lists except the computed ones (a computed column is read through a supplied
// expression, never off a row).
let stored = (v: Vocab, comp: string): Prop[] =>
  v.props(comp)
    .map((prop) => v.prop(comp, prop)!)
    .filter((c) => !c.computed)

// One component's table. The `entity` owner is the primary key, so a component
// is stored at most once per entity. A tag component (no stored columns) is
// just the owner column — its row's existence is the whole fact.
let tableDdl = (
  v: Vocab,
  comp: string,
  as = comp,
  extra: string[] = [],
): string => {
  let cols = stored(v, comp).map(colDdl)
  let body = [
    'entity integer primary key references entity(id)',
    ...cols,
    ...extra,
  ]
  return `create table if not exists ${q(as)} (\n    ${
    body.join(',\n    ')
  }\n  )`
}

// One declared index, named `<comp>_<cols>` — derived from what it covers, so
// the name is the same in every store that loads the vocabulary and a second
// install finds its own index already there. `if not exists` is what makes a
// re-install a no-op; a unique one is the constraint a race is decided by (the
// loser's insert is rejected, and it re-reads to find the winner).
// A partial one covers only the rows that hold its `present` columns: the
// rows without them are as many as they like, the rows with them are one.
let indexDdl = (comp: string, i: Index): string =>
  `create ${i.unique ? 'unique ' : ''}index if not exists ` +
  `${comp}_${i.props.join('_')} on ${q(comp)} (${i.props.map(q).join(', ')})` +
  (i.present
    ? ` where ${i.present.map((p) => `${q(p)} is not null`).join(' and ')}`
    : '')

// How a stored document column reads as text. @yaks/blob replaces a body with
// its address; the doc_value view resolves it back for ordinary document
// reads.
// Search indexes are composed separately by the application using @yaks/fts.
export type Text = Record<string, (stored: string) => string>

let docDdl = (v: Vocab, text: Text): string[] => {
  if (!v.all.includes('doc')) return []
  // How one `doc` column reads as text, given SQL naming its stored value.
  // Absent a resolution the value is the text, which is every ordinary column.
  let read = (prop: string, s: string) => text[`doc.${prop}`]?.(s) ?? s
  let cols = stored(v, 'doc').map((c) => c.prop)
  // The view names its columns rather than selecting `*`, because `*` cannot
  // replace one with the expression that resolves it. `*` did have one virtue —
  // it followed a table that gained columns — so the view is dropped and
  // recreated rather than left in place: it holds no rows, so recreating it
  // costs nothing, and a view that lags its table is a read that fails at the
  // engine.
  return [
    `drop view if exists doc_value`,
    `create view if not exists doc_value as
    select "entity", ${
      cols.map((p) => `${read(p, q(p))} as ${q(p)}`).join(', ')
    }, "entity" as rowid from doc`,
  ]
}

// The whole schema as an ordered list of statements: the spine, then one table
// per component (the `entity` spine component is the identity table above, not
// a component table), the doc view, and the indexes those tables declare.
// `install()` in ./mod.ts runs them; a caller may also read them to inspect or
// migrate by hand.
export let schema = (vocab: Vocab, text: Text = {}): string[] => [
  ...tabled(vocab, text),
  // After every table: an index names a column the create above just raised.
  ...indexed(vocab),
]

// The spine and one table per component, with the doc view. Everything an
// index may need to already exist.
export let tabled = (vocab: Vocab, text: Text = {}): string[] => {
  let comps = vocab.all.filter((name) => name != 'entity')
  return [
    ...SPINE,
    ...comps.map((name) => tableDdl(vocab, name)),
    ...docDdl(vocab, text),
  ]
}

// Declared and automatic reference indexes. Created last, after `grown()`: an
// index may name a column its table only gained on this boot, and SQLite
// rejects one over a column that is not there yet.
export let indexed = (vocab: Vocab): string[] => [
  // Adapters that only replay schema() may still have the old spine. Until
  // they opt into archetypes/migration, do not index a column they lack.
  ...(vocab.comp('archetype')
    ? [
      `create index if not exists entity_archetype on entity(archetype)`,
      `create index if not exists entity_archetype_num on entity(archetype, num)`,
    ]
    : []),
  ...vocab.all
    .filter((name) => name != 'entity')
    .flatMap((name) => vocab.indexes(name).map((i) => indexDdl(name, i))),
]

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
 */
export let refit = (driver: Driver, vocab: Vocab): string[] =>
  vocab.all.filter((name) => name != 'entity').flatMap((comp) => {
    let want = bound(vocab, comp)
    let has = new Set(
      driver.query(`pragma foreign_key_list(${q(comp)})`, [])
        .map((r) => String(r.from)),
    )
    if (want.size == has.size && [...want].every((c) => has.has(c))) return []
    let held = driver.query(`pragma table_info(${q(comp)})`, [])
    if (!held.length) return []
    // Every column the table has comes across, not every column the vocabulary
    // declares: a column the vocabulary has since dropped is still a column
    // this table's rows were written under, and a constraint change is no
    // reason to remove one. Its declaration is copied off the existing table,
    // minus whatever key it carried.
    let said = new Set(stored(vocab, comp).map((c) => c.prop))
    let extra = held.filter((r) =>
      r.name != 'entity' && !said.has(String(r.name))
    )
    let fresh = `${comp}__refit`
    let cols = held.map((r) => q(String(r.name))).join(', ')
    return [
      tableDdl(
        vocab,
        comp,
        fresh,
        extra.map((r) =>
          [
            q(String(r.name)),
            String(r.type || ''),
            r.notnull ? 'not null' : '',
            r.dflt_value == null ? '' : `default ${r.dflt_value}`,
          ].filter(Boolean).join(' ')
        ),
      ),
      `insert into ${q(fresh)} (${cols}) select ${cols} from ${q(comp)}`,
      `drop table ${q(comp)}`,
      `alter table ${q(fresh)} rename to ${q(comp)}`,
    ]
  })

// What `schema()` alone cannot do: add the columns a component gained after
// its table was already created. `create table if not exists` does nothing to a
// table that exists, so a vocabulary that gained a column leaves the table at
// the shape it was first created with, and every read naming the new column
// fails at the engine ("no such column"). SQLite has no
// `add column if not exists`, so the live shape is inspected and only the
// missing columns are added.
//
// Additive only, and deliberately: nothing is dropped and nothing is retyped,
// because rows are already written under the columns the table has. A column
// is emitted in the form SQLite accepts in an `add column` (grownDdl above).
export let grown = (driver: Driver, vocab: Vocab): string[] => [
  ...(driver.query('pragma table_info(entity)', []).some((r) =>
      r.name == 'archetype'
    )
    ? []
    : [
      'alter table entity add column archetype integer references entity(id)',
    ]),
  ...vocab.all
    .filter((name) => name != 'entity')
    .flatMap((comp) => {
      let has = new Set(
        driver.query(`pragma table_info(${q(comp)})`, [])
          .map((r) => String(r.name)),
      )
      return stored(vocab, comp)
        .filter((c) => !has.has(c.prop))
        .map((c) => `alter table ${q(comp)} add column ${grownDdl(c)}`)
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
 * have moved. The mask asks after every table rather than only the ones this
 * connection has already read — at install it has read none — and an older
 * SQLite that does not know that bit ignores it.
 *
 * Only for a driver over a file: an engine that hands out storage rather than a
 * database (a Durable Object's SQLite) refuses the pragma, and a scratch
 * in-memory store is gone before a plan could be worth improving.
 */
export let analyzed = (driver: Driver): void => {
  if (!driver.file) return
  driver.exec(`pragma analysis_limit = ${SAMPLE}`)
  driver.exec('pragma optimize = 0x10002')
}
