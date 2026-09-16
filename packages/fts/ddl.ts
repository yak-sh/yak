// The index, and keeping it true.
//
// One FTS5 index per indexed component, named `<comp>_fts`. Each is
// EXTERNAL-CONTENT (`content='<comp>'`): it stores the inverted index and
// nothing else, reading the words themselves back out of the component's own
// table, so the prose is never kept twice. `content_rowid='entity'` lines the
// index's rowid up with the component's integer owner — which is the entity's
// spine id — so a match answers with an id the rest of the query already
// speaks, and no join is needed to get there.
//
// Three triggers keep it current. The one rule an external-content index
// imposes: a delete must be handed EXACTLY the values the insert was handed, or
// the index keeps words for rows that no longer say them. So both sides read
// the same way — the stored text, or '' for a null — and an update is spelled
// as the delete then the insert.
//
// WHEN A COLUMN IS NOT ITS OWN TEXT. @yaks/blob swaps a body for its SHA-256
// and keeps the prose in a store beside the rows, so a trigger reading the
// column would index the address and a search would find the body by title
// alone. A {@link Text} entry says how to resolve one, and it is applied on
// BOTH sides of the mirror:
//
//   - the triggers write the resolved words, so every write path indexes prose
//     — the plugin's, a plain `insert into doc`, a restore;
//   - the index's content becomes a VIEW that resolves the same way
//     (`<comp>_text`), because FTS5 reads the content back for `snippet()` and
//     for `rebuild`, and both would otherwise answer with the hash.
//
// Resolving in a trigger is sound because a blob is immutable and
// content-addressed: the text an address stands for is the same when the delete
// side reads it as when the insert side did, which is the whole of what the
// mirror rule asks. And a body written in the same batch is already there — the
// bytes go in before the row that names them.
//
// `heal()` is the other half. An index that drifts from its table (a trigger
// that did not run, a file restored around it) answers wrong quietly, so it is
// checked and rebuilt rather than trusted.
//
// `adopt()` is for a database that already HAS search objects — built by an
// earlier version of this package, or by an application's own hand before it
// used one. It makes what stands equal to what `schema()` says, keeping an
// index whose columns already match (its words need no re-indexing) and
// re-cutting one that does not, and it removes any other trigger that writes
// into an index here: an external-content index has exactly three writers, and
// a fourth double-counts every row.

import {
  type Field,
  indexes,
  indexName,
  type Text,
  textName,
} from './fields.ts'
import type { Driver } from './driver.ts'
import type { Derived } from '@yaks/sql'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

let lit = (s: string): string => s.replaceAll("'", "''")

// One component's index and the triggers that follow its table, plus the view
// the index reads back through when any of its columns resolves.
let index = (comp: string, props: string[], text: Text): string[] => {
  let fts = indexName(comp)
  let cols = props.map(q).join(', ')
  // How one column reads as text, given SQL naming its stored value. Absent a
  // resolution the value IS the text, which is every ordinary column.
  let read = (prop: string, stored: string) =>
    text[`${comp}.${prop}`]?.(stored) ?? stored
  let resolved = props.filter((p) => text[`${comp}.${p}`])
  // The values a trigger writes: the column read as text, or '' for a null —
  // the index never holds a null term, and delete must mirror insert exactly.
  let side = (s: string) =>
    props.map((p) => `coalesce(${read(p, `${s}.${q(p)}`)}, '')`).join(', ')
  // What FTS5 reads a column back out of: the table itself, or the view that
  // resolves it. `<comp>_text` is this package's own name, deliberately not
  // @yaks/sqlite's `doc_value` — that view is the read source for whole `doc`
  // rows, and a narrower one standing in its place under `if not exists` would
  // hide the columns a query needs.
  let content = resolved.length ? textName(comp) : comp
  return [
    ...(resolved.length
      ? [
        `create view if not exists ${q(content)} as
      select "entity", ${
          props.map((p) => `${read(p, q(p))} as ${q(p)}`).join(', ')
        }, "entity" as rowid from ${q(comp)}`,
      ]
      : []),
    `create virtual table if not exists ${q(fts)} using fts5(
      ${cols}, content='${lit(content)}', content_rowid='entity'
    )`,
    `create trigger if not exists ${q(`${fts}_insert`)} after insert on ${
      q(comp)
    } begin
      insert into ${q(fts)}(rowid, ${cols}) values (new.entity, ${side('new')});
    end`,
    `create trigger if not exists ${q(`${fts}_delete`)} after delete on ${
      q(comp)
    } begin
      insert into ${q(fts)}(${q(fts)}, rowid, ${cols})
        values ('delete', old.entity, ${side('old')});
    end`,
    `create trigger if not exists ${q(`${fts}_update`)} after update on ${
      q(comp)
    } begin
      insert into ${q(fts)}(${q(fts)}, rowid, ${cols})
        values ('delete', old.entity, ${side('old')});
      insert into ${q(fts)}(rowid, ${cols}) values (new.entity, ${side('new')});
    end`,
  ]
}

// The whole search schema for a set of fields, as ordered statements: per
// component, its text view where one is needed, then the index and its three
// triggers. Run them after the component tables exist — an external-content
// index names the table it mirrors. `text` says which columns are not their own
// text (`blobText(vocab)` from @yaks/blob is one); with none, every column
// indexes as it stands. The shared @yaks/sql Derived registry is also accepted:
// its `text` expression resolves old/new values without re-reading the owner.
export let schema = (fields: Field[], reads: Text | Derived = {}): string[] => {
  let text: Text = {}
  for (let { comp, prop } of fields) {
    let key = `${comp}.${prop}`
    let read = reads[key]
    if (!read) continue
    if (typeof read == 'function') text[key] = read
    else if (read.text) text[key] = read.text
    else {throw new Error(
        `FTS ${key}: read override needs a stored-value text expression`,
      )}
  }
  return indexes(fields).flatMap(({ comp, props }) => index(comp, props, text))
}

// Is this index still telling the truth about its table? Two questions, cheap
// then thorough: does it hold a row per row of the component, and does FTS5's
// own integrity check pass. Answers the complaint, or undefined for a healthy
// index.
//
// Membership is read from the index's `_docsize` shadow table, never as
// `count(*)` over the index itself: an external-content index answers that
// from the table it mirrors, so it would agree with the table by construction
// and never notice a row the triggers missed.
//
// The integrity check reads both shadow tables whole, which on a large index is
// seconds of boot for damage no trigger causes; `deep: false` skips it and
// keeps the count, which is what catches every drift a missed trigger leaves.
let fault = (
  db: Driver,
  comp: string,
  deep: boolean,
): string | undefined => {
  let fts = indexName(comp)
  let count = (t: string) =>
    Number(db.query(`select count(*) as n from ${t}`, [])[0].n)
  try {
    let [indexed, rows] = [count(q(`${fts}_docsize`)), count(q(comp))]
    if (indexed != rows) return `${fts} holds ${indexed} of ${rows} rows`
    if (deep) {
      db.exec(
        `insert into ${q(fts)}(${q(fts)}, rank) values('integrity-check', 1)`,
      )
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export type HealOpts = {
  // run FTS5's own integrity check beside the row count (default true)
  deep?: boolean
}

// Check every index and rebuild the ones that drifted; answers the names of the
// indexes rebuilt (usually none). A rebuild that does not fix the fault throws
// with BOTH complaints — the first says what was wrong, the second whether the
// damage is wider than the index.
export let heal = (
  db: Driver,
  fields: Field[],
  opts: HealOpts = {},
): string[] => {
  let deep = opts.deep ?? true
  let healed: string[] = []
  for (let { comp } of indexes(fields)) {
    let before = fault(db, comp, deep)
    if (!before) continue
    let fts = indexName(comp)
    db.exec(`insert into ${q(fts)}(${q(fts)}) values('rebuild')`)
    let after = fault(db, comp, deep)
    if (after) {
      throw new Error(
        `${fts} is still broken after a rebuild; before: ${before}; after: ${after}`,
      )
    }
    healed.push(fts)
  }
  return healed
}

// What `adopt` did, by index name: the indexes it created or re-cut (and so
// rebuilt from their tables), the triggers it dropped because they were not
// this package's, and the indexes `heal` rebuilt afterwards.
export type Adopted = {
  recut: string[]
  dropped: string[]
  healed: string[]
}

// The columns an index declares, in order, as SQLite knows them; [] for none.
let declared = (db: Driver, fts: string): string[] => {
  try {
    return db.query(`pragma table_info(${q(fts)})`, []).map((r) =>
      String(r.name)
    )
  } catch {
    return []
  }
}

// What an index reads its words back out of: the `content=` name in its own
// definition, or undefined for an index that is not there.
let source = (db: Driver, fts: string): string | undefined => {
  let row = db.query(
    `select sql from sqlite_master where type = 'table' and name = ?`,
    [fts],
  )[0]
  return row ? /content='([^']*)'/.exec(String(row.sql ?? ''))?.[1] : undefined
}

// A view's declaration with its `create view [if not exists]` preamble off.
// SQLite stores the statement it was handed minus the `if not exists`, so the
// tail from the name onward is the part two spellings can be compared by.
let body = (sql: string, name: string): string =>
  sql.slice(sql.indexOf(q(name)) + q(name).length).trim()

// The text view as it stands, or undefined when none does.
let standing = (db: Driver, view: string): string | undefined => {
  let row = db.query(
    `select sql from sqlite_master where type = 'view' and name = ?`,
    [view],
  )[0]
  return row ? String(row.sql ?? '') : undefined
}

// The triggers that write into an index, by name, other than the three of
// this package's own.
let strays = (db: Driver, fts: string): string[] => {
  let ours = new Set(['insert', 'delete', 'update'].map((s) => `${fts}_${s}`))
  let word = new RegExp(`\\b${fts}\\b`)
  return db.query(
    `select name, sql from sqlite_master where type = 'trigger'`,
    [],
  )
    .filter((r) => !ours.has(String(r.name)) && word.test(String(r.sql ?? '')))
    .map((r) => String(r.name))
}

// Make a database's search objects equal to what `schema()` says, and true.
//
// Per index: one whose declared columns already match is kept, its words
// intact; one that is missing or declares other columns is dropped and cut
// again from the schema, then rebuilt from its table (an external-content
// index is born empty). Any trigger writing into the index that is not one of
// the package's three is dropped, and the three are (re)created. A text view
// holds no rows, so it is re-cut whenever what stands differs from what
// `schema()` says — but only then: dropping a view is a schema WRITE, and a
// host that calls `adopt()` at every boot has a right to a boot that writes
// nothing. Finally `heal` checks membership, so an index kept whole but
// missing rows — one that predates some of its table — is rebuilt too.
//
// Everything else runs through `if not exists`/`if exists`, so a second call
// on the same database changes nothing, touches no byte, and answers empty
// lists.
export let adopt = (
  db: Driver,
  fields: Field[],
  reads: Text | Derived = {},
  opts: HealOpts = {},
): Adopted => {
  let recut: string[] = [], dropped: string[] = []
  let stmts = schema(fields, reads)
  for (let { comp, props } of indexes(fields)) {
    let fts = indexName(comp)
    let have = declared(db, fts)
    let content = stmts.some((s) => s.includes(`content='${textName(comp)}'`))
      ? textName(comp)
      : comp
    let same = have.length == props.length &&
      have.every((c, i) => c == props[i]) && source(db, fts) == content
    for (let t of strays(db, fts)) {
      db.exec(`drop trigger if exists ${q(t)}`)
      dropped.push(t)
    }
    let view = textName(comp)
    let want = stmts.find((s) =>
      s.startsWith(`create view if not exists ${q(view)}`)
    )
    let stood = standing(db, view)
    if (stood && (!want || body(stood, view) != body(want, view))) {
      db.exec(`drop view if exists ${q(view)}`)
    }
    if (!same) {
      for (let s of ['insert', 'delete', 'update']) {
        db.exec(`drop trigger if exists ${q(`${fts}_${s}`)}`)
      }
      db.exec(`drop table if exists ${q(fts)}`)
    }
    let mine = stmts.filter((s) =>
      s.includes(q(fts)) || s.includes(q(textName(comp)))
    )
    for (let s of mine) db.exec(s)
    if (!same) {
      db.exec(`insert into ${q(fts)}(${q(fts)}) values('rebuild')`)
      recut.push(fts)
    }
  }
  let healed = heal(db, fields, opts)
  return { recut, dropped, healed }
}
