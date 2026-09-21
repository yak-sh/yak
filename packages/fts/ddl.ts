// Creating the indexes, and keeping them correct.
//
// One FTS5 index per indexed component, named `<comp>_fts`. Each is an
// EXTERNAL-CONTENT index (`content='<comp>'`): it stores the inverted index and
// nothing else, reading the text itself back out of the component's own table,
// so the prose is never stored twice. `content_rowid='entity'` makes the
// index's rowid the component's integer owner column — the entity's id in the
// `entity` table — so a match yields an id the rest of the query already uses,
// and no join is needed to get there.
//
// Three triggers keep each index current. External-content indexes impose one
// rule: a delete must be given EXACTLY the values the matching insert was
// given, or the index keeps terms for text that is no longer there. So both
// sides read the column the same way — the stored text, or '' for a null — and
// an update is written as a delete followed by an insert.
//
// WHEN A COLUMN DOES NOT HOLD ITS OWN TEXT. @yaks/blob stores a body's SHA-256
// and keeps the prose in a separate table, so a trigger reading the column
// would index the hash and a search would only ever find the body by its title.
// A {@link Text} entry describes how to resolve such a column, and it is
// applied on both sides:
//
//   - the triggers insert the resolved text, so every write path indexes prose
//     — the plugin's writes, a plain `insert into doc`, a restore;
//   - the index's content source becomes a VIEW that resolves the same way
//     (`<comp>_text`), because FTS5 reads the content back for `snippet()` and
//     for `rebuild`, and both would otherwise see the hash.
//
// Resolving inside a trigger is sound because a blob is immutable and
// content-addressed: the text a hash stands for is the same when the delete
// trigger reads it as when the insert trigger did, which is all the rule above
// requires. And a body written in the same transaction is already stored — the
// bytes are inserted before the row that references them.
//
// `heal()` is the other half. An index that has drifted from its table (a
// trigger that did not run, a file restored around it) returns wrong results
// quietly, so it is checked and rebuilt rather than trusted.
//
// `adopt()` is for a database that already HAS search objects — created by an
// earlier version of this package, or by an application before it used one. It
// makes what is there match what `schema()` returns, keeping an index whose
// columns already match (its terms need no re-indexing) and re-creating one
// that does not, and it drops any other trigger that writes into one of these
// indexes: an external-content index has exactly three writers, and a fourth
// double-counts every row.

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

// One component's index and the triggers on its table, plus the view the index
// reads its content back through when any of its columns has to be resolved.
let index = (comp: string, props: string[], text: Text): string[] => {
  let fts = indexName(comp)
  let cols = props.map(q).join(', ')
  // How one column reads as text, given a SQL expression for its stored value.
  // With no resolution the stored value IS the text, which is every ordinary
  // column.
  let read = (prop: string, stored: string) =>
    text[`${comp}.${prop}`]?.(stored) ?? stored
  let resolved = props.filter((p) => text[`${comp}.${p}`])
  // The values a trigger inserts: the column read as text, or '' for a null —
  // the index never holds a null term, and the delete side must mirror the
  // insert side exactly.
  let side = (s: string) =>
    props.map((p) => `coalesce(${read(p, `${s}.${q(p)}`)}, '')`).join(', ')
  // Where FTS5 reads a column back from: the component table itself, or the
  // view that resolves it. `<comp>_text` is this package's own name,
  // deliberately not @yaks/sqlite's `doc_value` — that view is the read source
  // for whole `doc` rows, and a narrower view taking its place under
  // `if not exists` would hide the columns a query needs.
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

// The whole search schema for a set of fields, as statements in the order they
// must run: per component, its text view where one is needed, then the index
// and its three triggers. Run them after the component tables exist — an
// external-content index names the table it mirrors. `text` names which columns
// do not hold their own text (`blobText(vocab)` from @yaks/blob returns such a
// map); with none, every column is indexed as stored. The shared @yaks/sql
// `Derived` registry is also accepted: its `text` expression resolves the old
// and new values without re-reading the owner row.
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

// Is this index still consistent with its table? Two checks, the cheap one
// first: does it hold one row per row of the component table, and does FTS5's
// own integrity check pass. Returns a description of the problem, or undefined
// for a healthy index.
//
// The row count is read from the index's `_docsize` shadow table, never as
// `count(*)` over the index itself: for an external-content index SQLite
// computes that count from the table it mirrors, so it would agree with the
// table by construction and never notice a row the triggers missed.
//
// Start-up asks only for the row count. FTS5's own integrity check reads both
// shadow tables in full — 0.4s on a thirty-thousand-row index, seconds on a
// larger one — to detect damage no writer of ours can cause, so it runs only
// when a caller asks for it (`deep: true`), never on the pass a command line
// makes on its way in. The row count is what catches the drift a missed
// trigger leaves behind, which is the damage that actually happens.
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
  // also run FTS5's own integrity check, not just the row count (default
  // false) — it reads the whole index, so it suits a maintenance pass rather
  // than start-up
  deep?: boolean
}

// Check every index and rebuild the ones that have drifted; returns the names
// of the indexes rebuilt (usually none). A rebuild that does not fix the
// problem throws an error naming BOTH results — the first reports what was
// wrong, the second whether the damage extends beyond the index.
export let heal = (
  db: Driver,
  fields: Field[],
  opts: HealOpts = {},
): string[] => {
  let deep = opts.deep ?? false
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

// What `adopt` did, by index name: the indexes it created or re-created (and
// so rebuilt from their tables), the triggers it dropped because they were not
// this package's, and the indexes `heal` rebuilt afterwards.
export type Adopted = {
  recut: string[]
  dropped: string[]
  healed: string[]
}

// The columns an index declares, in order, as SQLite reports them; [] when the
// index does not exist.
let declared = (db: Driver, fts: string): string[] => {
  try {
    return db.query(`pragma table_info(${q(fts)})`, []).map((r) =>
      String(r.name)
    )
  } catch {
    return []
  }
}

// Where an index reads its content back from: the `content=` name in its own
// definition, or undefined when the index does not exist.
let source = (db: Driver, fts: string): string | undefined => {
  let row = db.query(
    `select sql from sqlite_master where type = 'table' and name = ?`,
    [fts],
  )[0]
  return row ? /content='([^']*)'/.exec(String(row.sql ?? ''))?.[1] : undefined
}

// A view's definition with its `create view [if not exists]` preamble removed.
// SQLite stores the statement it was given minus the `if not exists`, so the
// part from the name onward is what two definitions can be compared by.
let body = (sql: string, name: string): string =>
  sql.slice(sql.indexOf(q(name)) + q(name).length).trim()

// The text view currently in the database, or undefined when there is none.
let standing = (db: Driver, view: string): string | undefined => {
  let row = db.query(
    `select sql from sqlite_master where type = 'view' and name = ?`,
    [view],
  )[0]
  return row ? String(row.sql ?? '') : undefined
}

// The names of any triggers that write into an index other than this package's
// own three.
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

// Make a database's search objects match what `schema()` returns, and be
// consistent with their tables.
//
// For each index: one whose declared columns already match is kept, with its
// indexed terms intact; one that is missing or declares different columns is
// dropped, created again from the schema, and rebuilt from its table (a new
// external-content index starts out empty). Any trigger writing into the index
// that is not one of this package's three is dropped, and the three are
// created again. A view holds no rows, so the text view is re-created whenever
// the one in the database differs from what `schema()` returns — but only
// then: dropping a view is a schema WRITE, and a process that calls `adopt()`
// on every start-up should be able to start up without writing anything.
// Finally `heal` checks the row counts, so an index that was kept but is
// missing rows — one created after part of its table already existed — is
// rebuilt too.
//
// Everything else runs with `if not exists` / `if exists`, so a second call on
// the same database changes nothing, writes nothing, and returns empty lists.
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
