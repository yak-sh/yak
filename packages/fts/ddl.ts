// Creating the indexes, and keeping them correct.
//
// One FTS5 index per indexed component, named `<comp>_fts`. Each is an
// external-content index (`content='<comp>'`): it stores the inverted index and
// nothing else, reading the text itself back out of the component's own table,
// so the prose is never stored twice. `content_rowid='entity'` makes the
// index's rowid the component's integer owner column — the entity's id in the
// `entity` table — so a match yields an id the rest of the query already uses,
// and no join is needed to get there.
//
// Three triggers keep each index current. External-content indexes impose one
// rule: a delete must be given exactly the values the matching insert was
// given, or the index keeps terms for text that is no longer there. So both
// sides read the column the same way — the stored text, or '' for a null — and
// an update is written as a delete followed by an insert.
//
// When A column does not hold its own text. @yaks/blob stores a body's SHA-256
// and keeps the prose in a separate table, so a trigger reading the column
// would index the hash and a search would only ever find the body by its title.
// A {@link Text} entry describes how to resolve such a column, and it is
// applied on both sides:
//
//   - the triggers insert the resolved text, so every write path indexes prose
//     — the plugin's writes, a plain `insert into doc`, a restore;
//   - the index's content source becomes a view that resolves the same way
//     (`<comp>_text`), because FTS5 reads the content back for `snippet()` and
//     for `rebuild`, and both would otherwise see the hash.
//
// Resolving inside a trigger is sound because a blob is immutable and
// content-addressed: the text a hash stands for is the same when the delete
// trigger reads it as when the insert trigger did, which is all the rule above
// requires. And a body written in the same transaction is already stored — the
// bytes are inserted before the row that references them.
//
// An index read on behalf of another component (`entry` found by
// `content.body`) covers only the entities carrying that component. Its view
// joins the two tables, and its triggers fire on both: a write to the text
// indexes it when the entity already is one, and the entity becoming one (or
// ceasing to be) indexes the text already there (or removes it). Whichever of
// the two rows a transaction writes second is the one that indexes, so an
// entity is indexed once however its bundle's components are ordered.
//
// `heal()` is the other half. An index that has drifted from its table (a
// trigger that did not run, a file restored around it) returns wrong results
// quietly, so it is checked and rebuilt rather than trusted.
//
// `adopt()` is for a database that already has search objects — created by an
// earlier version of this package, or by an application before it used one. It
// makes what is there match what `schema()` returns, keeping an index whose
// columns already match (its terms need no re-indexing) and re-creating one
// that does not, and it drops any other trigger that writes into one of these
// indexes: an external-content index has exactly three writers, and a fourth
// double-counts every row.

import {
  type Field,
  type Index,
  indexes,
  indexName,
  type Text,
  textName,
} from './fields.ts'
import type { Driver } from './driver.ts'
import type { Derived } from '@yaks/sql'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

let lit = (s: string): string => s.replaceAll("'", "''")

// One index and the triggers keeping it, plus the view it reads its content
// back through when any of its columns has to be resolved or it is read on
// behalf of another component.
let index = (ix: Index, text: Text): string[] => {
  let { name, comp, props, on } = ix
  let fts = q(indexName(name))
  let cols = props.map(q).join(', ')
  // How one column reads as text, given a SQL expression for its stored value.
  // With no resolution the stored value is the text, which is every ordinary
  // column.
  let read = (prop: string, stored: string) =>
    text[`${comp}.${prop}`]?.(stored) ?? stored
  // The values a trigger inserts: the column read as text, or '' for a null —
  // the index never holds a null term, and the delete side must mirror the
  // insert side exactly.
  let side = (s: string) =>
    props.map((p) => `coalesce(${read(p, `${s}.${q(p)}`)}, '')`).join(', ')
  let insert = (s: string) =>
    `insert into ${fts}(rowid, ${cols}) values (${s}.entity, ${side(s)});`
  let remove = (s: string) =>
    `insert into ${fts}(${fts}, rowid, ${cols})
        values ('delete', ${s}.entity, ${side(s)});`
  // Where FTS5 reads a column back from: the component table itself, or the
  // view that resolves it. `<name>_text` is this package's own name,
  // deliberately not @yaks/sqlite's `doc_value` — that view is the read source
  // for whole `doc` rows, and a narrower view taking its place under
  // `if not exists` would hide the columns a query needs.
  let content = sourceOf(ix, text)
  let view = content == comp ? [] : on
    ? [
      `create view if not exists ${q(content)} as
      select "c"."entity" as "entity", ${
        props.map((p) => `${read(p, `"c".${q(p)}`)} as ${q(p)}`).join(', ')
      }, "c"."entity" as rowid from ${q(comp)} "c"
      join ${q(on)} "o" on "o"."entity" = "c"."entity"`,
    ]
    : [
      `create view if not exists ${q(content)} as
      select "entity", ${
        props.map((p) => `${read(p, q(p))} as ${q(p)}`).join(', ')
      }, "entity" as rowid from ${q(comp)}`,
    ]
  // The text's own triggers, which for a scoped index fire only for an entity
  // that already carries `on`.
  let when = (s: string) =>
    on
      ? ` when exists (select 1 from ${q(on)} where "entity" = ${s}.entity)`
      : ''
  let trigger = (what: string, event: string, table: string, body: string) =>
    `create trigger if not exists ${
      q(`${indexName(name)}_${what}`)
    } after ${event} on ${q(table)}${
      what == 'join' || what == 'leave'
        ? ''
        : when(event == 'delete' ? 'old' : 'new')
    } begin
      ${body}
    end`
  return [
    ...view,
    `create virtual table if not exists ${fts} using fts5(
      ${cols}, content='${lit(content)}', content_rowid='entity'
    )`,
    trigger('insert', 'insert', comp, insert('new')),
    trigger('delete', 'delete', comp, remove('old')),
    trigger(
      'update',
      'update',
      comp,
      `${remove('old')}
      ${insert('new')}`,
    ),
    // The entity becoming one of `on`, or ceasing to be one, with its text
    // already written.
    ...on
      ? [
        trigger(
          'join',
          'insert',
          on,
          `insert into ${fts}(rowid, ${cols})
        select new.entity, ${side('"c"')} from ${q(comp)} "c"
        where "c"."entity" = new.entity;`,
        ),
        trigger(
          'leave',
          'delete',
          on,
          `insert into ${fts}(${fts}, rowid, ${cols})
        select 'delete', old.entity, ${side('"c"')} from ${q(comp)} "c"
        where "c"."entity" = old.entity;`,
        ),
      ]
      : [],
  ]
}

// The trigger names an index owns: three on its text's table, and two more on
// `on` for a scoped one.
let owned = (ix: Index): string[] =>
  [...TRIGGERS, ...ix.on ? SCOPED : []].map((s) => `${indexName(ix.name)}_${s}`)

let TRIGGERS = ['insert', 'delete', 'update']
let SCOPED = ['join', 'leave']

// What an index reads its content back through: the component table, or its
// text view where a column must be resolved or the text is read on behalf of
// another component.
let sourceOf = (ix: Index, text: Text): string =>
  ix.on || ix.props.some((p) => text[`${ix.comp}.${p}`])
    ? textName(ix.name)
    : ix.comp

// The whole search schema for a set of fields, as statements in the order they
// must run: per component, its text view where one is needed, then the index
// and its three triggers. Run them after the component tables exist — an
// external-content index names the table it mirrors. `text` names which columns
// do not hold their own text (`blobText(vocab)` from @yaks/blob returns such a
// map); with none, every column is indexed as stored. The shared @yaks/sql
// `Derived` registry is also accepted: its `text` expression resolves the old
// and new values without re-reading the owner row.
export let schema = (fields: Field[], reads: Text | Derived = {}): string[] => {
  let text = textOf(fields, reads)
  return indexes(fields).flatMap((ix) => index(ix, text))
}

// The resolutions `schema()` was given, as one `Text` map over these fields.
let textOf = (fields: Field[], reads: Text | Derived): Text => {
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
  return text
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
//
// A scoped index holds one row per entity carrying both components, so its
// rows are counted through its view's join rather than off the text's table.
let fault = (
  db: Driver,
  ix: Index,
  deep: boolean,
): string | undefined => {
  let fts = indexName(ix.name)
  let count = (t: string) =>
    Number(db.query(`select count(*) as n from ${t}`, [])[0].n)
  let rows = ix.on ? textName(ix.name) : ix.comp
  try {
    let [indexed, had] = [count(q(`${fts}_docsize`)), count(q(rows))]
    if (indexed != had) return `${fts} holds ${indexed} of ${had} rows`
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
// problem throws an error naming both results — the first reports what was
// wrong, the second whether the damage extends beyond the index.
export let heal = (
  db: Driver,
  fields: Field[],
  opts: HealOpts = {},
): string[] => {
  let deep = opts.deep ?? false
  let healed: string[] = []
  for (let ix of indexes(fields)) {
    let before = fault(db, ix, deep)
    if (!before) continue
    let fts = indexName(ix.name)
    db.exec(`insert into ${q(fts)}(${q(fts)}) values('rebuild')`)
    let after = fault(db, ix, deep)
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
let standing = (db: Driver, view: string): string | undefined =>
  stored(db, 'view', view)

// A trigger's definition as the database holds it, or undefined.
let trigger = (db: Driver, name: string): string | undefined =>
  stored(db, 'trigger', name)

let stored = (db: Driver, type: string, name: string): string | undefined => {
  let row = db.query(
    `select sql from sqlite_master where type = ? and name = ?`,
    [type, name],
  )[0]
  return row ? String(row.sql ?? '') : undefined
}

// The names of any triggers that write into an index other than this package's
// own.
let strays = (db: Driver, ix: Index): string[] => {
  let fts = indexName(ix.name)
  let ours = new Set(owned(ix))
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
// then: dropping a view is a schema write, and a process that calls `adopt()`
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
  let text = textOf(fields, reads)
  for (let ix of indexes(fields)) {
    let fts = indexName(ix.name)
    let have = declared(db, fts)
    let same = have.length == ix.props.length &&
      have.every((c, i) => c == ix.props[i]) &&
      source(db, fts) == sourceOf(ix, text)
    for (let t of strays(db, ix)) {
      db.exec(`drop trigger if exists ${q(t)}`)
      dropped.push(t)
    }
    let mine = index(ix, text)
    let view = textName(ix.name)
    let want = mine.find((s) =>
      s.startsWith(`create view if not exists ${q(view)}`)
    )
    let stood = standing(db, view)
    if (stood && (!want || body(stood, view) != body(want, view))) {
      db.exec(`drop view if exists ${q(view)}`)
    }
    // A trigger's body is compared the same way: one written by an earlier
    // version of this package (a scoped index's `when`, say) is created again.
    for (let t of owned(ix)) {
      let had = trigger(db, t)
      let now = mine.find((s) => s.includes(q(t)))
      if (had && (!same || !now || body(had, t) != body(now, t))) {
        db.exec(`drop trigger if exists ${q(t)}`)
      }
    }
    if (!same) db.exec(`drop table if exists ${q(fts)}`)
    for (let s of mine) db.exec(s)
    if (!same) {
      db.exec(`insert into ${q(fts)}(${q(fts)}) values('rebuild')`)
      recut.push(fts)
    }
  }
  let healed = heal(db, fields, opts)
  return { recut, dropped, healed }
}
