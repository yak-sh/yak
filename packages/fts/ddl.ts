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
// When a column does not hold its own text. @yaks/blob stores a body's SHA-256
// and keeps the prose in a separate table, so a trigger reading the column
// would index the hash and a search would only ever find the body by its title.
// A `text` expression in the store's @yaks/sql `Derived` describes how to
// resolve such a column, and it is applied on both sides:
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
  textName,
} from './fields.ts'
import {
  and,
  as,
  col,
  count,
  type CreateTrigger,
  type CreateView,
  type Derived,
  type Driver,
  eq,
  exists,
  type Expr,
  fn,
  type Insert,
  join,
  lit,
  render,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'

// How one column of `comp` reads as text, given the expression for its stored
// value: through the registered `text` expression where there is one, else as
// stored, which is every ordinary column.
let reader =
  (comp: string, derived: Derived) => (prop: string, stored: Expr): Expr =>
    derived[`${comp}.${prop}`]?.text?.(stored) ?? stored

// An FTS5 command: a row written to the index's own hidden column.
let command = (fts: string, word: string, rank?: number): Insert => ({
  t: 'insert',
  into: fts,
  cols: rank == null ? [fts] : [fts, 'rank'],
  rows: [[lit(word), ...(rank == null ? [] : [lit(rank)])]],
})

// The trigger names an index owns: three on its text's table, and two more on
// `on` for a scoped one.
let TRIGGERS = ['insert', 'delete', 'update']
let SCOPED = ['join', 'leave']
let owned = (ix: Index): string[] =>
  [...TRIGGERS, ...ix.on ? SCOPED : []].map((s) => `${indexName(ix.name)}_${s}`)

// What an index reads its content back through: the component table, or its
// text view where a column must be resolved or the text is read on behalf of
// another component.
let sourceOf = (ix: Index, derived: Derived): string =>
  ix.on || ix.props.some((p) => derived[`${ix.comp}.${p}`]?.text)
    ? textName(ix.name)
    : ix.comp

// One index and the triggers keeping it, plus the view it reads its content
// back through when any of its columns has to be resolved or it is read on
// behalf of another component.
let index = (ix: Index, derived: Derived): Stmt[] => {
  let { name, comp, props, on } = ix
  let fts = indexName(name)
  let read = reader(comp, derived)
  // The values a trigger inserts: the column read as text, or '' for a null —
  // the index never holds a null term, and the delete side must mirror the
  // insert side exactly.
  let side = (row: string) =>
    props.map((p) => fn('coalesce', read(p, col(p, row)), lit('')))
  let add = (row: string): Insert => ({
    t: 'insert',
    into: fts,
    cols: ['rowid', ...props],
    rows: [[col('entity', row), ...side(row)]],
  })
  let drop: Insert = {
    t: 'insert',
    into: fts,
    cols: [fts, 'rowid', ...props],
    rows: [[lit('delete'), col('entity', 'old'), ...side('old')]],
  }
  // The text a scoped entity already holds, as it joins or leaves `on`.
  let held = (row: 'new' | 'old', first: Expr[]): Insert => ({
    t: 'insert',
    into: fts,
    cols: [...(row == 'old' ? [fts] : []), 'rowid', ...props],
    q: select({
      cols: [...first, col('entity', row), ...side('c')],
      from: table(comp, 'c'),
      where: eq(col('entity', 'c'), col('entity', row)),
    }),
  })
  // The text's own triggers, which for a scoped index fire only for an entity
  // that already carries `on`.
  let guard = (over: string, event: CreateTrigger['event']) =>
    on && over == comp
      ? {
        when: exists(select({
          cols: [lit(1)],
          from: table(on),
          where: eq(
            col('entity', on),
            col('entity', event == 'delete' ? 'old' : 'new'),
          ),
        })),
      }
      : {}
  let trigger = (
    what: string,
    event: CreateTrigger['event'],
    over: string,
    body: Insert[],
  ): CreateTrigger => ({
    t: 'create trigger',
    name: `${fts}_${what}`,
    ifNot: true,
    timing: 'after',
    event,
    on: over,
    ...guard(over, event),
    body,
  })
  // Where FTS5 reads a column back from: the component table itself, or the
  // view that resolves it. `<name>_text` is this package's own name,
  // deliberately not @yaks/sqlite's `doc_value` — that view is the read source
  // for whole `doc` rows, and a narrower view taking its place under
  // `if not exists` would hide the columns a query needs.
  let content = sourceOf(ix, derived)
  return [
    ...(content == comp ? [] : [view(ix, derived)]),
    {
      t: 'create virtual table',
      name: fts,
      ifNot: true,
      using: 'fts5',
      args: [...props, ['content', content], ['content_rowid', 'entity']],
    },
    trigger('insert', 'insert', comp, [add('new')]),
    trigger('delete', 'delete', comp, [drop]),
    trigger('update', 'update', comp, [drop, add('new')]),
    // The entity becoming one of `on`, or ceasing to be one, with its text
    // already written.
    ...on
      ? [
        trigger('join', 'insert', on, [held('new', [])]),
        trigger('leave', 'delete', on, [held('old', [lit('delete')])]),
      ]
      : [],
  ]
}

// The view presenting an index's columns as text, joined to `on` for a scoped
// one.
let view = (ix: Index, derived: Derived): CreateView => {
  let { name, comp, props, on } = ix
  let read = reader(comp, derived)
  let c = on ? 'c' : undefined
  return {
    t: 'create view',
    name: textName(name),
    ifNot: true,
    q: select({
      cols: [
        as(col('entity', c), 'entity'),
        ...props.map((p) => as(read(p, col(p, c)), p)),
        as(col('entity', c), 'rowid'),
      ],
      from: table(comp, c),
      joins: on
        ? [join(table(on, 'o'), eq(col('entity', 'o'), col('entity', 'c')))]
        : [],
    }),
  }
}

// The whole search schema for a set of fields, as statements in the order they
// must run: per index, its text view where one is needed, then the index and
// its triggers. Run them after the component tables exist — an
// external-content index names the table it mirrors. `derived` is the store's
// read overrides (@yaks/sql `Derived`): a column whose stored value is not its
// text (@yaks/blob `blobRead` registers one per body) is indexed through its
// `text` expression, which resolves the old and new values without re-reading
// the owner row. An override with no `text` would index the stored value, so it
// is refused.
export let schema = (fields: Field[], derived: Derived = {}): Stmt[] => {
  for (let { comp, prop } of fields) {
    let key = `${comp}.${prop}`
    if (derived[key] && !derived[key].text) {
      throw new Error(
        `FTS ${key}: read override needs a stored-value text expression`,
      )
    }
  }
  return indexes(fields).flatMap((ix) => index(ix, derived))
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
  let rows = (t: string) =>
    Number(
      db.query(select({ cols: [as(count(), 'n')], from: table(t) }))[0].n,
    )
  try {
    let [indexed, held] = [
      rows(`${fts}_docsize`),
      rows(ix.on ? textName(ix.name) : ix.comp),
    ]
    if (indexed != held) return `${fts} holds ${indexed} of ${held} rows`
    if (deep) db.query(command(fts, 'integrity-check', 1))
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
    db.query(command(fts, 'rebuild'))
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
    return db.query({ t: 'pragma', name: 'table_info', arg: fts })
      .map((r) => String(r.name))
  } catch {
    return []
  }
}

// The schema objects of one type, with the text each was created by.
let objects = (db: Driver, type: string, name?: string) =>
  db.query(select({
    cols: [col('name'), col('sql')],
    from: table('sqlite_master'),
    where: name == null
      ? eq(col('type'), val(type))
      : and(eq(col('type'), val(type)), eq(col('name'), val(name))),
  }))

// The text a schema object was created by, or undefined when there is none.
let stored = (db: Driver, type: string, name: string): string | undefined => {
  let row = objects(db, type, name)[0]
  return row ? String(row.sql ?? '') : undefined
}

// Where an index reads its content back from: the `content=` name in its own
// definition, or undefined when the index does not exist.
let source = (db: Driver, fts: string): string | undefined =>
  /content='([^']*)'/.exec(stored(db, 'table', fts) ?? '')?.[1]

// A definition with its `create view [if not exists]` preamble removed. SQLite
// stores the statement it was given minus the `if not exists`, with its leading
// keywords in capitals, so the part from the name onward is what two
// definitions can be compared by.
let body = (sql: string, name: string): string => {
  let at = `"${name}"`
  return sql.slice(sql.indexOf(at) + at.length).trim()
}

// The names of any triggers that write into an index other than this package's
// own.
let strays = (db: Driver, ix: Index): string[] => {
  let fts = indexName(ix.name)
  let ours = new Set(owned(ix))
  let word = new RegExp(`\\b${fts}\\b`)
  return objects(db, 'trigger')
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
// that is not one of this package's own is dropped, and ours are created
// again. A view holds no rows, so the text view is re-created whenever the one
// in the database differs from what `schema()` returns — but only then:
// dropping a view is a schema write, and a process that calls `adopt()` on
// every start-up should be able to start up without writing anything. A
// trigger of ours written by an earlier version of this package is re-created
// the same way. Finally `heal` checks the row counts, so an index that was
// kept but is missing rows — one created after part of its table already
// existed — is rebuilt too.
//
// Everything else runs with `if not exists` / `if exists`, so a second call on
// the same database changes nothing, writes nothing, and returns empty lists.
export let adopt = (
  db: Driver,
  fields: Field[],
  derived: Derived = {},
  opts: HealOpts = {},
): Adopted => {
  let recut: string[] = [], dropped: string[] = []
  let gone = (kind: 'trigger' | 'view' | 'table', name: string) =>
    db.query({ t: 'drop', kind, name, ifExists: true })
  // What one of `mine` would be stored as, by the name it creates.
  let text = (mine: Stmt[], name: string): string | undefined => {
    let s = mine.find((s) =>
      (s.t == 'create view' || s.t == 'create trigger') && s.name == name
    )
    return s && render(s).sql
  }
  for (let ix of indexes(fields)) {
    let fts = indexName(ix.name)
    let have = declared(db, fts)
    let same = have.length == ix.props.length &&
      have.every((c, i) => c == ix.props[i]) &&
      source(db, fts) == sourceOf(ix, derived)
    for (let t of strays(db, ix)) {
      gone('trigger', t)
      dropped.push(t)
    }
    let mine = index(ix, derived)
    let ours: ['view' | 'trigger', string][] = [
      ['view', textName(ix.name)],
      ...owned(ix).map((t): ['trigger', string] => ['trigger', t]),
    ]
    for (let [kind, name] of ours) {
      let had = stored(db, kind, name)
      let now = text(mine, name)
      if (
        had != null &&
        (kind == 'trigger' && !same || now == null ||
          body(had, name) != body(now, name))
      ) gone(kind, name)
    }
    if (!same) gone('table', fts)
    for (let s of mine) db.query(s)
    if (!same) {
      db.query(command(fts, 'rebuild'))
      recut.push(fts)
    }
  }
  let healed = heal(db, fields, opts)
  return { recut, dropped, healed }
}
