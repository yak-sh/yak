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
//                 is decided by; the vocabulary is where that is said.
//   doc_value     a view over the `doc` component (when the vocabulary declares
//                 one): its columns read as TEXT, plus a `rowid` alias. It is
//                 what @yaks/sql reads a `doc` row through.
//
// Columns are nullable by design: a patch may create a row from any subset of
// its columns (that is what PATCH means), so no column may demand a value an
// insert might omit. A reference carries a foreign key so a dangling id is
// refused at the engine, except a `keep` reference, which outlives the row it
// points at and stays key-free.

import type { Column, Index, Vocab } from '@yaks/vocab'
import type { Driver } from './driver.ts'

// The identity table and the graveyard. Fixed shape — every layout has exactly
// this spine, whatever components ride on it.
let SPINE = [
  `create table if not exists entity (
    id   integer primary key,
    eid  text not null unique,
    num  integer unique
  )`,
  `create table if not exists tombstone (
    entity     integer primary key references entity(id),
    deleted_at text not null
  )`,
]

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// A stored column's DDL fragment. Affinity comes straight off the interrogated
// column; a foreign key rides a reference unless it is a `keep` reference,
// which must survive its target's tombstone and so carries none.
let colDdl = (c: Column): string => {
  let fk = c.category == 'ref' && c.fk ? ' references entity(id)' : ''
  return `${q(c.prop)} ${c.affinity}${fk}`
}

// Which of a component's declared columns are STORED: everything the vocabulary
// lists except the computed ones (a computed column is read through a supplied
// expression, never off a row).
let stored = (v: Vocab, comp: string): Column[] =>
  v.columns(comp)
    .map((prop) => v.column(comp, prop)!)
    .filter((c) => c.persist)

// One component's table. The `entity` owner is the primary key, so a component
// is worn at most once per entity. A tag component (no stored columns) is just
// the owner column — its row's existence is the whole fact.
let tableDdl = (v: Vocab, comp: string): string => {
  let cols = stored(v, comp).map(colDdl)
  let body = ['entity integer primary key references entity(id)', ...cols]
  return `create table if not exists ${q(comp)} (\n    ${
    body.join(',\n    ')
  }\n  )`
}

// One declared index, named `<comp>_<cols>` — derived from what it covers, so
// the name is the same in every store that loads the vocabulary and a second
// install finds its own index already standing. `if not exists` is what makes a
// re-install a no-op; a UNIQUE one is the constraint a race is decided by (the
// loser's insert is refused, and it re-reads to find the winner).
let indexDdl = (comp: string, i: Index): string =>
  `create ${i.unique ? 'unique ' : ''}index if not exists ` +
  `${comp}_${i.cols.join('_')} on ${q(comp)} (${i.cols.map(q).join(', ')})`

// How a stored document column reads as text. @yaks/blob swaps a body for
// its address; the doc_value view resolves it for ordinary document reads.
// Search indexes are composed separately by the application using @yaks/fts.
export type Text = Record<string, (stored: string) => string>

let docDdl = (v: Vocab, text: Text): string[] => {
  if (!v.all.includes('doc')) return []
  // How one `doc` column reads as text, given SQL naming its stored value.
  // Absent a resolution the value IS the text, which is every ordinary column.
  let read = (prop: string, s: string) => text[`doc.${prop}`]?.(s) ?? s
  let cols = stored(v, 'doc').map((c) => c.prop)
  // The view names its columns rather than starring them, because a star cannot
  // replace one with the expression that resolves it. A star did have one
  // virtue — it followed a table that GREW — so the view is DROPPED and raised
  // again rather than left standing: it holds no rows, so re-cutting it costs
  // nothing, and a view that lags its table is a read that fails at the engine.
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

// Declared and automatic reference indexes. Raised last, after `grown()`: an index
// may name a column its table only gained on this boot, and SQLite refuses one
// over a column that is not there yet.
export let indexed = (vocab: Vocab): string[] =>
  vocab.all
    .filter((name) => name != 'entity')
    .flatMap((name) => vocab.indexes(name).map((i) => indexDdl(name, i)))

// What `schema()` alone cannot say: the columns a component GREW after its
// table was already raised. `create table if not exists` is silent about a
// table that exists, so a vocabulary that gained a column leaves the table at
// the shape it was first created with, and every read naming the new column
// fails at the engine ("no such column"). SQLite has no
// `add column if not exists`, so the live shape is interrogated and only the
// missing columns are added.
//
// Additive only, and deliberately: nothing is dropped and nothing is retyped,
// because rows are already written under the words the table has. A column
// arrives nullable with no default, which is the one form SQLite accepts an
// `add column` carrying a foreign key in.
export let grown = (driver: Driver, vocab: Vocab): string[] =>
  vocab.all
    .filter((name) => name != 'entity')
    .flatMap((comp) => {
      let has = new Set(
        driver.query(`pragma table_info(${q(comp)})`, [])
          .map((r) => String(r.name)),
      )
      return stored(vocab, comp)
        .filter((c) => !has.has(c.prop))
        .map((c) => `alter table ${q(comp)} add column ${colDdl(c)}`)
    })
