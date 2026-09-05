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
//   <index>       one per `unique`/`index` a component declares, named after
//                 the columns it covers. A unique one is the constraint a race
//                 is decided by; the vocabulary is where that is said.
//   doc_value     a view over the `doc` component (when the vocabulary declares
//                 one): its columns read as TEXT, plus a `rowid` alias. It is
//                 what @yaks/sql reads a `doc` row through, and what the search
//                 index reads a column back out of.
//   doc_fts       a full-text index over the `doc` text columns, kept current
//                 by triggers, so a bare-word query resolves through it.
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

// The `doc` view and its full-text index, emitted only when the vocabulary
// declares a `doc` component. The view republishes `doc`'s columns plus a
// `rowid` alias (the owner id) so `doc_fts` — which matches by rowid — lines up
// with it; @yaks/sql reads whole `doc` rows through it too. The index is
// EXTERNAL-CONTENT over that view (it stores no second copy, just the inverted
// index) and is kept current by triggers. It covers the text columns; a `doc`
// with none gets a view but no index, and a text query over it declines
// upstream rather than hit a missing table.
//
// A column is not always its own text: @yaks/blob swaps a body for its SHA-256
// and keeps the prose beside the rows, so an index reading the column would
// hold addresses and a search would find a body by its title alone. A
// {@link Text} entry says how to resolve one, and it is applied in the view AND
// in both sides of every trigger — the view because FTS5 reads the content back
// for `snippet()` and `rebuild`, the triggers because that is what goes into
// the index. Resolving in a trigger is sound: a blob is immutable and
// content-addressed, so the delete side reads exactly what the insert side did.
export type Text = Record<string, (stored: string) => string>

let textCols = (v: Vocab, comp: string): string[] =>
  stored(v, comp)
    .filter((c) => c.category == 'scalar' && c.scalar == 'text')
    .map((c) => c.prop)

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
  let out = [
    `drop view if exists doc_value`,
    `create view if not exists doc_value as
    select "entity", ${
      cols.map((p) => `${read(p, q(p))} as ${q(p)}`).join(', ')
    }, "entity" as rowid from doc`,
  ]
  let texts = textCols(v, 'doc')
  if (!texts.length) return out
  let index = texts.map(q).join(', ')
  // The value each trigger writes to the index. An external-content index must
  // be handed, on delete, exactly what it was handed on insert, so both sides
  // read the same way: the column as text, or '' for a null (the index never
  // holds a null term).
  let side = (s: string) =>
    texts.map((t) => `coalesce(${read(t, `${s}.${q(t)}`)}, '')`).join(', ')
  out.push(
    `create virtual table if not exists doc_fts using fts5(
      ${index}, content='doc_value', content_rowid='entity'
    )`,
    `create trigger if not exists doc_fts_insert after insert on doc begin
      insert into doc_fts(rowid, ${index}) values (new.entity, ${side('new')});
    end`,
    `create trigger if not exists doc_fts_delete after delete on doc begin
      insert into doc_fts(doc_fts, rowid, ${index})
        values ('delete', old.entity, ${side('old')});
    end`,
    `create trigger if not exists doc_fts_update after update on doc begin
      insert into doc_fts(doc_fts, rowid, ${index})
        values ('delete', old.entity, ${side('old')});
      insert into doc_fts(rowid, ${index}) values (new.entity, ${side('new')});
    end`,
  )
  return out
}

// The whole schema as an ordered list of statements: the spine, then one table
// per component (the `entity` spine component is the identity table above, not
// a component table), then the indexes those tables declare, then the doc view
// and its search index. `install()` in ./mod.ts runs them; a caller may also
// read them to inspect or migrate by hand.
export let schema = (vocab: Vocab, text: Text = {}): string[] => [
  ...tabled(vocab, text),
  // After every table: an index names a column the create above just raised.
  ...indexed(vocab),
]

// The spine and one table per component, with the doc view and its search
// index. Everything an index may need to already exist.
export let tabled = (vocab: Vocab, text: Text = {}): string[] => {
  let comps = vocab.all.filter((name) => name != 'entity')
  return [
    ...SPINE,
    ...comps.map((name) => tableDdl(vocab, name)),
    ...docDdl(vocab, text),
  ]
}

// The indexes the components declare. Raised last, after `grown()`: an index
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
//
// Known gap: `doc_fts` indexes the text columns `doc` had when it was created,
// so a `doc` that grows a text column is not searchable on it until the index
// is rebuilt. Nothing in the platform grows `doc`; an app grows its own words.
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
