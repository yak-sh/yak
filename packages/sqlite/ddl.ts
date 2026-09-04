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
//   doc_value     a view over the `doc` component (when the vocabulary declares
//                 one), exposing a `rowid` so full-text search can join it.
//   doc_fts       a full-text index over the `doc` text columns, kept current
//                 by triggers, so a bare-word query resolves through it.
//
// Columns are nullable by design: a patch may create a row from any subset of
// its columns (that is what PATCH means), so no column may demand a value an
// insert might omit. A reference carries a foreign key so a dangling id is
// refused at the engine, except a `keep` reference, which outlives the row it
// points at and stays key-free.

import type { Column, Vocab } from '@yaks/vocab'

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

// The `doc` view and its full-text index, emitted only when the vocabulary
// declares a `doc` component. The view republishes `doc`'s columns plus a
// `rowid` alias (the owner id) so `doc_fts` — which matches by rowid — lines up
// with it. The index covers the text-shaped columns (plain text and body); a
// `doc` with none gets a view but no index, and a text query over it declines
// upstream rather than hitting a missing table.
let textCols = (v: Vocab, comp: string): string[] =>
  stored(v, comp)
    .filter((c) =>
      c.category == 'scalar' && (c.scalar == 'text' || c.scalar == 'body')
    )
    .map((c) => c.prop)

let docDdl = (v: Vocab): string[] => {
  if (!v.all.includes('doc')) return []
  let out = [
    `create view if not exists doc_value as
    select d.*, d.entity as rowid from doc d`,
  ]
  let texts = textCols(v, 'doc')
  if (!texts.length) return out
  let cols = texts.map(q).join(', ')
  // The stored value read for a trigger: a text value inserts as itself, a null
  // as the empty string so the index never sees a null term.
  let read = (side: string) =>
    texts.map((t) => `coalesce(${side}.${q(t)}, '')`).join(', ')
  out.push(
    `create virtual table if not exists doc_fts using fts5(${cols})`,
    `create trigger if not exists doc_fts_insert after insert on doc begin
      insert into doc_fts(rowid, ${cols}) values (new.entity, ${read('new')});
    end`,
    `create trigger if not exists doc_fts_delete after delete on doc begin
      insert into doc_fts(doc_fts, rowid, ${cols})
        values ('delete', old.entity, ${read('old')});
    end`,
    `create trigger if not exists doc_fts_update after update on doc begin
      insert into doc_fts(doc_fts, rowid, ${cols})
        values ('delete', old.entity, ${read('old')});
      insert into doc_fts(rowid, ${cols}) values (new.entity, ${read('new')});
    end`,
  )
  return out
}

// The whole schema as an ordered list of statements: the spine, then one table
// per component (the `entity` spine component is the identity table above, not
// a component table), then the doc view and its index. `install()` in ./mod.ts
// runs them; a caller may also read them to inspect or migrate by hand.
export let schema = (vocab: Vocab): string[] => [
  ...SPINE,
  ...vocab.all
    .filter((name) => name != 'entity')
    .map((name) => tableDdl(vocab, name)),
  ...docDdl(vocab),
]
