// The one-pass move from the fleet-shaped store (src/store/schema.json, whose
// Durable Object class went with T-33807) to the packages-shaped one (graph.ts,
// @yaks/sqlite from a loaded vocabulary). Nothing here imports that class: the
// pass reads the old tables by name, which is why it outlives the code that
// wrote them and must stay until every deployed object has been touched once.
// Jeff, 2026-09-05: "there are a few users! can't just drop" — so this is a data
// migration, and the rows a deployed object holds are the whole subject.
//
// Two things happen, in this order, and the order is the safety:
//
//   1. Carry    {@link carry} runs the whole pass inside one `transactionSync`:
//               the derived objects go, the base tables are renamed aside, the
//               new schema is planted, the rows are copied across, and the
//               counts are read back. A throw anywhere unwinds all of it and
//               the object is bit-for-bit what it was.
//   2. Reconcile per table, old count against new, with every expected delta
//               named ({@link Moved.note}). One that does not reconcile throws
//               {@link Refused}, which is the rollback — the caller then serves
//               the old rows read-only and says so.
//
// The restore path is the Durable Object's own point-in-time recovery, which
// keeps every object's storage for 30 days; the passes write no second copy.
//
// ## What is not a straight copy
// The layouts agree almost everywhere: both spell the spine `entity(id, eid,
// num)`, both key a component table by an integer `entity` referencing it, and
// both name a component after its word. So the spine and `tombstone` are not
// touched at all — every integer id, every `num`, every tombstone survives
// because nothing moves them — and a component the new vocabulary also names is
// copied column-for-column over the columns the two have in common. Four things
// are not that:
//
//   doc.body      was an integer pointing at a `blob` entity whose text sat in
//                 `blob_text(entity, value)`; it is now the text's own SHA-256,
//                 with the text in @yaks/blob's `blob_text(sha, value)`. Same
//                 table name, different table — which is exactly why the old one
//                 is renamed aside before the new one is planted.
//   references    the fleet wrote the tag for `referenced` under its present
//                 tense, and an edge's eid is derived from `from|tag|to` — so
//                 the tag is rewritten and the entity re-addressed under the new
//                 name (`update entity set eid`, which keeps the integer id
//                 and so keeps every row that points at it).
//   recalled      wore `source` and `at`; the relation is a bare tag now, so
//                 both columns are dropped and said so in the report.
//   member.role   @yaks/member's roster has two seats (`owner|member`) and hands
//                 out levels as `grant{app, person, access}`. An app's store
//                 therefore splits: an owner keeps the seat, and anyone else
//                 becomes a `member` plus a grant at the level they had. The
//                 directory does not split — its vocabulary declares the three
//                 seats itself (vocab.ts `platformDoc`), so its rows copy whole.
//
// ## Beside the copy
// The same transaction lands the facts the fleet kept where the vocabulary no
// longer looks: `space.home` as `home{}` on the app it named (T-34227), the
// directory's app addresses in `former` (T-34390), a domain's target in
// `hostname.serves` (T-34596), and a task's filing in `filed`.
//
// ## What cannot be carried
// The fleet's other ~100 words (`card`, `pin`, `mail`, `session`, the journal…)
// are not in any store's vocabulary now, so there is no table for their rows to
// go to. They are named in the report with their row counts, and the tables are
// dropped — which is step 4 of T-33809. The journal is one of them: nothing in
// workers/yak installs @yaks/journal, so an app store keeps no
// `journal_tx`/`journal_change`/`journal_field` of its own.
import { fields, schema as ftsSchema } from '@yaks/fts'
import { driver, type DurableStorage, reserved } from '@yaks/durable-object'
import { edgeEid } from '@yaks/edge'
import { sha256 } from '@yaks/graph'
import {
  and,
  as,
  col,
  type Derived,
  type Driver,
  eq,
  type Expr,
  fn,
  iff,
  isNull,
  join,
  left,
  lit,
  notNull,
  or,
  select,
  sub,
  table,
  tally,
  val,
} from '@yaks/sql'
import { backfill, grown, indexed, tabled } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'

/** The object's own key-value slots beside its SQL — where the old store kept
 * everything it remembered (its name, the app's `vocab.json`, the words it
 * borrows, its tools). `ctx.storage.kv`, which graph.ts's Store does not use. */
export type Slots = {
  get(key: string): unknown
  put(key: string, value: unknown): void
}

/** The five type words the short manifest used, and the JSON Schema each
 * meant. Frozen here rather than read off vocab.ts: what a stored slot meant is
 * history, and history does not move when the platform's words do. */
let WAS: Record<string, Record<string, unknown>> = {
  text: { type: 'string' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  time: { type: 'string', format: 'date-time' },
  url: { type: 'string', format: 'uri' },
}

let record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

/**
 * A document with every property saying its type (T-37986). A property once
 * could say none, and was stored and read as text, so `"type": "string"` is
 * what it always meant; the loader now refuses a property that says none.
 * `null` where every property already says one.
 *
 * The build before this one still accepts a property with no type, so a
 * manifest it planted during a rollback arrives here too, which is why this
 * runs at every wake rather than once.
 */
let typed = (doc: Record<string, unknown>): string | null => {
  if (!record(doc.$defs)) return null
  let moved = false
  let defs = Object.fromEntries(
    Object.entries(doc.$defs).map(([name, s]) => {
      if (!record(s) || s.tool === true || s.rule === true) return [name, s]
      if (!record(s.properties)) return [name, s]
      let props = Object.fromEntries(
        Object.entries(s.properties).map(([prop, c]) => {
          if (!record(c) || 'type' in c) return [prop, c]
          moved = true
          return [prop, { type: 'string', ...c }]
        }),
      )
      return [name, { ...s, properties: props }]
    }),
  )
  return moved ? JSON.stringify({ ...doc, $defs: defs }) : null
}

/**
 * A short type map, as the document it means. An app's `vocab.json` could be
 * written as one — `{"recipe": {"serves": "number"}}` — and that form is
 * gone: a manifest is a JSON Schema document and nothing converts one at the
 * door any more (vocab.ts `appDoc`).
 *
 * A store that last accepted one remembers it in its vocabulary slot, and is
 * rewritten at its next open (graph.ts `#reshaping`).
 *
 * `null` where there is nothing to do — nothing held, a document whose
 * properties all say their type, or something no reader could parse — which is
 * every store after one wake.
 *
 * `"tools": false` is the manifest's one word about itself, so it rides across
 * as the document's own; every other key is a component.
 *
 * A document is rewritten too when one of its properties says no type
 * ({@link typed}), at the same open and for the same reason.
 */
export let documented = (held: string): string | null => {
  let said: unknown
  try {
    said = JSON.parse(held)
  } catch {
    return null
  }
  if (!said || typeof said != 'object' || Array.isArray(said)) return null
  let body = said as Record<string, unknown>
  let keys = Object.keys(body)
  if (keys.some((k) => k.startsWith('$'))) return typed(body)
  if (!keys.length) return null
  let defs: Record<string, unknown> = {}
  let tools: boolean | undefined
  for (let [name, props] of Object.entries(body)) {
    if (name == 'tools' && typeof props == 'boolean') {
      tools = props
      continue
    }
    if (!props || typeof props != 'object' || Array.isArray(props)) return null
    defs[name] = {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: Object.fromEntries(
        Object.entries(props as Record<string, unknown>).map(([prop, word]) => [
          prop,
          { ...(WAS[String(word)] ?? WAS.text) },
        ]),
      ),
    }
  }
  return JSON.stringify(
    tools === undefined ? { $defs: defs } : { $defs: defs, tools },
  )
}

/**
 * A tools manifest with each `{{arg}}` hole written as the `$arg` variable it
 * became (c0ca24d4). A deploy refuses the hole (lib/tools.ts `parseTools`),
 * but a store that last accepted a manifest before then remembers it in its
 * tools slot, and is rewritten at its next open (graph.ts `#reshaping`).
 * `null` where there is nothing to do. The names a hole can hold never need
 * escaping in JSON, so the text is rewritten as it is held.
 */
export let unholed = (held: string): string | null => {
  let now = held.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, '$$$1')
  return now == held ? null : now
}

/** The five words a tool's argument was once written as, and the JSON Schema
 * each was shown to a host as (lib/tools.ts `schemaOf` before T-38021) —
 * frozen here for the same reason {@link WAS} is. */
let ARGS: Record<string, Record<string, unknown>> = {
  text: { type: 'string' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  time: {
    type: 'string',
    description: 'a time, like 2026-09-01 or 2026-09-01T10:00:00Z',
  },
  url: { type: 'string', description: 'a url' },
}

// A tool whose arguments are words, or that says which may be left out rather
// than which must be sent.
let worded = (t: unknown) =>
  record(t) && ('optional' in t ||
    record(t.input) && Object.values(t.input).some((w) => typeof w == 'string'))

// One tool in the shape a package declares one: each argument a JSON Schema,
// and `required` naming every argument but the ones it left `optional`.
let schemed = (t: Record<string, unknown>): Record<string, unknown> => {
  let { input, optional, ...rest } = t
  let args = record(input) ? input : {}
  let loose = Array.isArray(optional) ? optional : []
  let required = Object.keys(args).filter((a) => !loose.includes(a))
  return {
    ...rest,
    input: Object.fromEntries(
      Object.entries(args).map((
        [a, w],
      ) => [a, typeof w == 'string' ? { ...(ARGS[w] ?? ARGS.text) } : w]),
    ),
    ...(required.length ? { required } : {}),
  }
}

/**
 * A tools slot with every argument a JSON Schema (T-38021): a store remembers
 * the tools its last deploy handed it, as one of five words each, and is
 * rewritten at its next open (graph.ts `#reshaping`). `null` where there is
 * nothing to do.
 */
export let unworded = (held: string): string | null => {
  let said: unknown
  try {
    said = JSON.parse(held)
  } catch {
    return null
  }
  if (!record(said) || !Object.values(said).some(worded)) return null
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(said).map((
        [name, t],
      ) => [name, worded(t) ? schemed(t as Record<string, unknown>) : t]),
    ),
  )
}

// A clause in a postfix form, where a query line can hold one: after a quote,
// a `&` or a query string's own `?`, and before a quote or a `&`.
let POSTFIX =
  /(?<=['"`&?])\.([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)(\[[^\]\s]*\])?([!?])(?=['"`&])/g

/**
 * Text with each query clause in its one spelling (T-39341): `.p!` is `.p`,
 * `.edges[t]!` is `.edges[t]`, and `.p?` is `?p`. A store's tools slot is
 * rewritten at its next open (graph.ts `#reshaping`), since the parser refuses
 * the old spellings. `null` where there is nothing to do.
 */
export let respelled = (text: string): string | null => {
  let now = text.replace(
    POSTFIX,
    (m, word, pick = '', mark) =>
      mark == '!' ? `.${word}${pick}` : pick ? m : `?${word}`,
  )
  return now == text ? null : now
}

/** The marker written when the pass reconciles, so it never runs twice: the
 * move off the fleet-shaped store. */
export let MARK = 'yak/store/packages/1'

/** The stored shapes this code reads, each named by the pass that moved stores
 * into it, read per commit by `yak admin deploys`: a rollback across one would
 * serve rows the build before it cannot read. Every pass after the first ran on
 * every store and was deleted, so only its name is left here. The shape it made
 * is the one this code reads, and code without the name is code from before
 * it. */
export let BOUNDARIES = [
  MARK,
  'yak/store/home/2',
  'yak/store/former/3',
  'yak/store/serves/4',
  'yak/store/handle/5',
  'yak/store/filed/6',
  'yak/store/tool/7',
  'yak/store/args/11',
]

/** The two tables the two layouts spell identically, and so never move. */
let SPINE = ['entity', 'tombstone']

/** This object's own memory in the new store (graph.ts `KV`), which the pass
 * writes but never reads out of the old schema, and its write log (writes.ts),
 * which holds what was sent while the pass had yet to run. */
let KEEP = [...SPINE, 'yak_kv', 'yak_writes']

/** A table renamed aside for the length of the pass. */
let ASIDE = 'yak_old_'

/** What the directory's app addresses were called before T-34390 — and what
 * the core word is called now, which is why their rows have to move out of it
 * ({@link formerly}). */
let FORMERLY = 'alias'

/** The schema's own catalogue, narrowed to one type of object. */
let catalogued = (type: string, also?: Expr) =>
  select({
    cols: [col('name'), col('sql')],
    from: table('sqlite_master'),
    where: and(eq(col('type'), lit(type)), ...(also ? [also] : [])),
  })

/** The entity an eid names. */
let byEid = (eid: string) =>
  select({
    cols: [col('id')],
    from: table('entity'),
    where: eq(col('eid'), val(eid)),
  })

/** An entity called by another eid, keeping its integer id. */
let readdress = (id: number, eid: string) => ({
  t: 'update' as const,
  table: 'entity',
  set: { eid: val(eid) },
  where: eq(col('id'), val(id)),
})

/** A column dropped from a table. */
let unseat = (name: string, column: string) => ({
  t: 'alter table' as const,
  table: name,
  drop: column,
})

/** A refusal that unwinds the pass: the counts did not reconcile, or the new
 * schema would not stand over the old rows. It carries the report, so the
 * caller can archive what it learned even though nothing was written. */
export class Refused extends Error {
  report: Report
  constructor(report: Report) {
    super(report.message ?? 'the migration did not reconcile')
    this.name = 'Refused'
    this.report = report
  }
}

/** One table's move: how many rows it had, how many it has, and — when those
 * are not the same number — why. */
export type Moved = { table: string; from: number; to: number; note?: string }

/** What the pass did. */
export type Report = {
  store: string
  app: string | null
  at: string
  ok: boolean
  message?: string
  mark: string
  /** the tables that moved, old count against new */
  moved: Moved[]
  /** the fleet's other words: no vocabulary names them, so their tables are
   * dropped with the row counts said here */
  dropped: { table: string; rows: number }[]
}

/**
 * Whether this object still holds the fleet-shaped store. The journal is the
 * tell: `journal_tx` is the old schema's and only the old schema's — the new
 * store installs no journal at all — so a table by that name is an object that
 * has not moved, and its absence is one that never was or already has.
 */
export let stale = (storage: DurableStorage): boolean =>
  stands(driver(storage), 'journal_tx')

/** What an object holds, for deciding whether it is an orphan (orphan.ts): the
 * name its old memory keeps, whether it is fleet-shaped, and how many entities
 * are in it. */
export let holding = (storage: DurableStorage & { kv?: Slots }) => {
  let d = driver(storage)
  let name = storage.kv?.get('name')
  return {
    name: name == null || name === '' ? null : String(name),
    fleet: stale(storage),
    entities: stands(d, 'entity') ? tally(d, 'entity') : 0,
  }
}

/**
 * Every definition of one type that is this object's — the single place the
 * pass learns what tables there are.
 *
 * `reserved` (@yaks/durable-object) is what it is not: SQLite's catalogue and
 * Cloudflare's own tables. The runtime lists `_cf_KV` here like any other and
 * then refuses to read it — which is how a pass that took `sqlite_master` at
 * its word threw `SQLITE_AUTH` in every deployed object and none of the local
 * ones, where nothing creates that table (T-34019).
 */
let named = (d: Driver, type: string): { name: string; sql: string }[] =>
  d.query(catalogued(type))
    .map((r) => ({ name: String(r.name), sql: String(r.sql ?? '') }))
    .filter((t) => !reserved(t.name))

let columns = (d: Driver, name: string): string[] =>
  d.query({ t: 'pragma', name: 'table_info', arg: name })
    .map((r) => String(r.name))

/**
 * Every definition this object stands on, dropped: its views, its triggers and
 * its full-text indexes.
 *
 * They hold no rows of their own — a view is a query, a trigger is a rule, and
 * an external-content FTS5 index is an inverted copy of rows that live
 * somewhere else — and `create ... if not exists` says nothing about one that is
 * already standing. So re-raising them is the only way a changed shape reaches a
 * store that has an older one, and dropping them costs only the rebuild below.
 * Dropping a virtual table takes its shadow tables with it.
 */
export let recut = (d: Driver) => {
  let drop = (kind: 'table' | 'index' | 'view' | 'trigger', name: string) =>
    d.query({ t: 'drop', kind, name, ifExists: true })
  for (let t of named(d, 'trigger')) drop('trigger', t.name)
  for (let v of named(d, 'view')) drop('view', v.name)
  for (let f of shadowed(d)) drop('table', f)
}

/**
 * A column its vocabulary stopped naming, dropped (vocab.ts `grew`). SQLite
 * refuses to drop a column an index, a trigger or a view names, so `recut()`
 * runs first and every index of the table goes with it; `install()` raises
 * again the ones the vocabulary still declares, in the same transaction.
 */
export let shed = (d: Driver, name: string, prop: string) => {
  if (!columns(d, name).includes(prop)) return
  recut(d)
  let indexes = d.query(catalogued(
    'index',
    and(eq(col('tbl_name'), val(name)), notNull(col('sql'))),
  ))
  for (let i of indexes) {
    d.query({ t: 'drop', kind: 'index', name: String(i.name), ifExists: true })
  }
  d.query(unseat(name, prop))
}

/** Every full-text index refilled from the content it mirrors — what a freshly
 * raised external-content index needs, because the rows it indexes were written
 * before it existed. */
export let rebuild = (d: Driver) => {
  for (let f of shadowed(d)) {
    d.query({ t: 'insert', into: f, cols: [f], rows: [[lit('rebuild')]] })
  }
}

let stands = (d: Driver, name: string): boolean =>
  d.query(catalogued('table', eq(col('name'), val(name)))).length > 0

/** The schema a vocabulary implies, raised over whatever the object holds.
 * Only the tables that stood before it can be missing a column (@yaks/sqlite
 * `grown`), so a fresh object is asked nothing about its columns. Existing rows
 * need a preparing migration before gaining a unique constraint; empty tables
 * can acquire it now without changing what old rows must satisfy. */
export let install = (
  storage: DurableStorage,
  vocab: Vocab,
  derived: Derived = {},
  classify = true,
) => {
  let d = driver(storage)
  let stood = new Set(named(d, 'table').map((t) => t.name))
  for (let stmt of tabled(vocab, derived)) d.query(stmt)
  for (let stmt of grown(d, vocab, stood)) d.query(stmt)
  let held = new Set(named(d, 'index').map((i) => i.name))
  let ready = {
    ...vocab,
    indexes: (table: string) =>
      vocab.indexes(table).filter((i) => {
        let name = `${table}_${i.props.join('_')}`
        if (held.has(name)) return false
        if (!i.unique || !tally(d, table)) return true
        throw new Error(
          `skipped unique index ${name}: existing rows require a preparing migration`,
        )
      }),
  }
  for (let stmt of indexed(ready)) d.query(stmt)
  // Search is app composition, after all indexed columns have been raised.
  for (let stmt of ftsSchema(fields(vocab), derived)) d.query(stmt)
  if (classify && vocab.comp('archetype')) backfill(d, false)
}

// A full-text index is several tables — the virtual one and its shadows — and
// the shadows are derived bytes nobody restores from. The virtual table's own
// name prefixes every one of them, which is how they are told apart.
let shadowed = (d: Driver): string[] =>
  named(d, 'table').filter((t) => /using\s+fts\d/i.test(t.sql)).map((t) =>
    t.name
  )

// ---- the pass --------------------------------------------------------------

/** What the pass needs to know that the storage cannot tell it. */
export type Carry = {
  /** the object's own name, which says whether it is the directory */
  store: string
  /** the app this store holds, when the kernel has said — what a split grant is
   * on. Absent, a level that cannot be carried is named in the report instead of
   * being invented. */
  app: string | null
  /** the vocabulary the new schema is raised from */
  vocab: Vocab
  /** raise that schema — graph.ts's own boot, so there is one planting */
  plant: () => void
  /** the id a mirrored grant is filed under (graph.ts `grantEid`) */
  grantEid: (app: string, person: string) => string
}

// The one relation the fleet named in the present tense. Everything else wears
// the same word in both stores, so this is the whole rename table.
let RENAMED: Record<string, string> = { references: 'referenced' }

// The integer id of an eid, minting the spine row when there is none. Only the
// split grant needs this: every other row the pass writes rides an id the old
// store already had. The spine takes no number — this pass runs on an app's
// store, and an app's entities are not numbered (vocab.ts) — so what it mints
// is the eid and nothing else.
let idOf = (d: Driver, eid: string, minted: { n: number }): number => {
  let [row] = d.query(byEid(eid))
  if (row) return Number(row.id)
  d.query({ t: 'insert', into: 'entity', cols: ['eid'], rows: [[val(eid)]] })
  minted.n++
  return Number(d.query(byEid(eid))[0].id)
}

// The fleet and the app store have separate schemas. Carry both deployed
// shapes: an already-package-shaped app and an old fleet-shaped task table.
let FILING = ['priority', 'project', 'assignee', 'domain']
let filingCols = (d: Driver, from: string) =>
  FILING.filter((c) => columns(d, from).includes(c))

// Refuse conflicting facts rather than pick a winner. Reconcile values, not
// only counts, before the caller can remove the old place or advance a marker.
let fileward = (d: Driver, from: string): number => {
  let cols = filingCols(d, from)
  if (!cols.length) return 0
  let rows = d.query(select({
    cols: ['entity', ...cols].map((c) => col(c)),
    from: table(from),
  }))
  let filing = (entity: number) =>
    d.query(select({
      from: table('filed'),
      where: eq(col('entity'), val(entity)),
    }))
  for (let row of rows) {
    let [held] = filing(Number(row.entity))
    for (let c of cols) {
      if (held?.[c] != null && row[c] != null && held[c] !== row[c]) {
        throw new Error(
          `task.${c} conflicts with filed.${c} for entity ${row.entity}`,
        )
      }
    }
    let names = ['entity', ...cols]
    d.query({
      t: 'insert',
      into: 'filed',
      cols: names,
      rows: [names.map((c) => val(row[c] as string | number | null))],
      upsert: [{
        on: [col('entity')],
        set: Object.fromEntries(
          cols.map((c) => [
            c,
            fn('coalesce', col(c, 'filed'), col(c, 'excluded')),
          ]),
        ),
      }],
    })
    let [landed] = filing(Number(row.entity))
    if (!landed || cols.some((c) => row[c] != null && landed[c] !== row[c])) {
      throw new Error(`task filing did not reconcile for entity ${row.entity}`)
    }
  }
  return rows.length
}

// ---- `space.home` → `home{}` (T-34227) -------------------------------------
//
// The fact "this app is the space's front page" was a property of the space and
// is now a word the app wears (vocab.ts). The pass finds the column in the
// table renamed aside.

/** The stamping: one `home` row per space that named an app. Answers how many
 * spaces named one and how many apps came to wear it, which is what the
 * reconciliation compares. */
let homeward = (
  d: Driver,
  from: string,
): { named: number; stamped: number } => {
  let homes = notNull(col('home'))
  let named = tally(d, from, homes)
  let before = tally(d, 'home')
  d.query({
    t: 'insert',
    or: 'ignore',
    into: 'home',
    cols: ['entity'],
    q: select({ cols: [col('home')], from: table(from), where: homes }),
  })
  return { named, stamped: tally(d, 'home') - before }
}

// ---- the app's addresses → `former` (T-34390) ------------------------------
//
// The directory's record of every address an app has answered at — its birth
// address in `slug`, each one a rename left behind in `slugs` — was named
// `alias`. That word is now every store's (@yaks/alias: a name any entity may
// wear, a kind tag on `key{of, value}`), and two things cannot share one word,
// so the record is `former` (vocab.ts `platformDoc`).
//
// The table name is what makes this a migration and not a rename. The core tag
// declares no properties, so its table is `alias(entity)` — and `create table
// if not exists` over a directory that already has `alias(entity, slug, slugs)`
// leaves the old columns standing under the new word, with the addresses still
// in them. The rows move to `former`.

/** The addresses moved out of one table and into `former`. Answers how many
 * rows named an address and how many landed, which is what the reconciliation
 * compares. A row with no `slug` is not an address — it is the core word's own
 * tag — so it is neither counted nor moved. */
let SLUGGED = notNull(col('slug'))
let formerly = (d: Driver, from: string): { rows: number; moved: number } => {
  let rows = tally(d, from, SLUGGED)
  let before = tally(d, 'former')
  let cols = ['entity', 'slug', 'slugs']
  d.query({
    t: 'insert',
    into: 'former',
    cols,
    q: select({
      cols: cols.map((c) => col(c)),
      from: table(from),
      where: SLUGGED,
    }),
  })
  return { rows, moved: tally(d, 'former') - before }
}

/**
 * Whether a table is the app-address record as the platform used to spell it:
 * both of the old word's columns, with an address in them. Rows and columns,
 * because an app store has neither and a directory the pass has been over has
 * the columns swept — and because the core word writes rows of its own into
 * the same table, which are not addresses and are not this pass's business.
 */
let addressing = (d: Driver, name: string): boolean =>
  stands(d, name) && columns(d, name).includes('slug') &&
  columns(d, name).includes('slugs') && tally(d, name, SLUGGED) > 0

// ---- a domain's target: `hostname.app` → `hostname.serves` (T-34596) --------
//
// A hostname used to name the one app it opened. It now names the place it
// opens — that app, or the whole space, whose front page it serves at `/` with
// every app of it at `/<app>/` — and one property says which (vocab.ts). The
// column a word loses is still standing with its values in it, and nothing
// selects it, so a domain whose target stayed in `app` would resolve to
// nothing: a live customer domain would stop serving at the deploy. The eids
// move across, and each one still points at the same app.

/** A hostname with a target. */
let AIMED = notNull(col('serves'))

/**
 * The whole pass, synchronously — run it inside `transactionSync`, because a
 * throw is how it refuses and the rollback is how it leaves nothing behind.
 *
 * Returns the report when the counts reconcile; throws {@link Refused},
 * carrying the same report, when they do not.
 */
export let carry = (storage: DurableStorage, o: Carry): Report => {
  let d = driver(storage)
  let at = new Date().toISOString()
  let moved: Moved[] = []
  let dropped: { table: string; rows: number }[] = []
  let report = (ok: boolean, message?: string): Report => ({
    store: o.store,
    app: o.app,
    at,
    ok,
    message,
    mark: MARK,
    moved,
    dropped,
  })

  // Every definition goes first: leaving one standing would make renaming the
  // table under it rewrite something we are about to replace, and the new
  // schema's own would not raise over the old ones anyway. The search index is
  // filled by its triggers as the doc rows land below, which is why the blob
  // rows are written before the row that addresses them.
  recut(d)
  // A named index would collide with one the new vocabulary declares under the
  // same name; an implicit one (a unique column) has no SQL and goes with its
  // table.
  for (let i of named(d, 'index')) {
    if (i.sql) {
      d.query({ t: 'drop', kind: 'index', name: i.name, ifExists: true })
    }
  }

  // The base tables, moved aside. The spine is NOT one of them: `entity` and
  // `tombstone` are identical in both layouts, so every integer id,
  // every `num` and every death survives by not being touched. A store that
  // was numbered before numbers became @yaks/id's keeps the numbers it was
  // given, in a column its vocabulary no longer names (T-37831): nothing reads
  // them, and taking them away would be a write the migration does not need.
  let before = { entity: tally(d, 'entity'), tombstone: tally(d, 'tombstone') }
  let old: string[] = []
  for (let t of named(d, 'table')) {
    if (KEEP.includes(t.name) || t.name.startsWith(ASIDE)) continue
    d.query({ t: 'alter table', table: t.name, rename: ASIDE + t.name })
    old.push(t.name)
  }
  let aside = (name: string) => ASIDE + name
  let there = (name: string) => old.includes(name)
  let from = (name: string) => there(name) ? tally(d, aside(name)) : 0

  // The new schema, raised by the object itself, over the spine that stayed.
  // A unique index the vocabulary declares is raised here too, so rows that
  // cannot satisfy it throw out of this transaction rather than landing.
  o.plant()

  let words = o.vocab.all.filter((w) => w != 'entity')
  let carried = new Set<string>()

  // Everything that is a straight copy: the columns the two layouts share, by
  // name. A column the old store had and the vocabulary does not declare has no
  // home and is left behind (named below); a column the vocabulary declares and
  // the old store never had is simply null.
  // A word another word is renamed into is filled by that rename below, never
  // here — otherwise a store that held both names would write the same
  // entity twice.
  // The table the core word took over is never a straight copy either: its old
  // rows are addresses and its new ones are name tags, so copying `entity`
  // across would say every app answers to a name nobody wrote. They go to
  // `former` below.
  let renamed = new Set(Object.values(RENAMED))
  // The roster. @yaks/member's seat is `owner|member` and a level is a `grant`;
  // the directory's own `member` declares the three seats itself, so it copies
  // whole and nothing splits.
  let seats = o.vocab.prop('member', 'role')?.values ?? []
  let splits = words.includes('grant') && !seats.includes('editor')
  // The one column the copy cannot take at its word. Where the seat splits
  // below, the old roster's level ('editor') is no longer a seat the new
  // `member` admits, and the column now CHECKs its enum (@yaks/sqlite `ddl`) —
  // so the seat lands as the seat it is here, and the level it was becomes the
  // grant minted from the row set aside.
  let value = (comp: string, c: string) =>
    comp == 'member' && c == 'role' && splits
      ? iff(
        or(isNull(col(c)), eq(col(c), lit('owner'))),
        col(c),
        lit('member'),
      )
      : col(c)
  for (let comp of words) {
    if (comp == 'doc' || comp == FORMERLY) continue
    if (renamed.has(comp) || !there(comp)) continue
    let want = new Set(columns(d, comp))
    let have = columns(d, aside(comp)).filter((c) => want.has(c))
    let lost = columns(d, aside(comp)).filter((c) => !want.has(c))
    d.query({
      t: 'insert',
      into: comp,
      cols: have,
      q: select({
        cols: have.map((c) => value(comp, c)),
        from: table(aside(comp)),
      }),
    })
    carried.add(comp)
    moved.push({
      table: comp,
      from: from(comp),
      to: tally(d, comp),
      ...(lost.length ? { note: `dropped columns: ${lost.join(', ')}` } : {}),
    })
  }

  // Old fleet-shaped stores may still carry filing on task, while a newer
  // fleet already has filed. Preserve either, refusing disagreeing values.
  if (there('task') && stands(d, 'filed')) {
    let n = fileward(d, aside('task'))
    if (n) {
      moved.push({ table: 'filed', from: n, to: n, note: 'carried from task' })
    }
  }

  // `doc.body`: the text out of the old blob backend, addressed by its own
  // SHA-256 and stored under that address in the new one. Two rows become two
  // rows of different shapes; the prose is the same prose.
  let bodies = 0
  if (there('doc')) {
    let texts = there('blob_text')
    let rows = d.query(select({
      cols: [
        as(col('entity', 'd'), 'id'),
        as(col('title', 'd'), 'title'),
        as(col('body', 'd'), 'at'),
        as(texts ? col('value', 'b') : lit(null), 'body'),
      ],
      from: table(aside('doc'), 'd'),
      joins: texts
        ? [
          left(
            table(aside('blob_text'), 'b'),
            eq(col('entity', 'b'), col('body', 'd')),
          ),
        ]
        : [],
    }))
    let seen = new Set<string>()
    // A doc that addresses a body the blob table does not hold. Every body a
    // store wrote went in there, so this is a row nobody can read — and a body
    // that cannot be read is exactly the thing this pass may not lose.
    let unread = rows.filter((r) => r.at != null && r.body == null).length
    if (unread) {
      throw new Refused(report(
        false,
        `${unread} doc rows address a body the blob table does not hold`,
      ))
    }
    for (let r of rows) {
      let body = r.body == null ? null : String(r.body)
      let sha = body == null ? null : sha256(body)
      if (sha != null && !seen.has(sha)) {
        seen.add(sha)
        d.query({
          t: 'insert',
          or: 'ignore',
          into: 'blob_text',
          cols: ['sha', 'value'],
          rows: [[val(sha), val(body)]],
        })
      }
      d.query({
        t: 'insert',
        into: 'doc',
        cols: ['entity', 'title', 'body'],
        rows: [[
          val(Number(r.id)),
          val(r.title == null ? null : String(r.title)),
          val(sha),
        ]],
      })
    }
    bodies = seen.size
    carried.add('doc')
    moved.push({ table: 'doc', from: from('doc'), to: tally(d, 'doc') })
    moved.push({
      table: 'blob_text',
      from: from('blob_text'),
      to: tally(d, 'blob_text'),
      note: `content-addressed: ${bodies} distinct bodies, ` +
        `the old blob entities are kept as they were`,
    })
  }

  // `space.home` → `home{}` on the app it named (T-34227). The column is not
  // among the ones `space` copies across, since the new vocabulary does not
  // declare it.
  if (there('space') && words.includes('home') && !carried.has('home')) {
    let { named, stamped } = homeward(d, aside('space'))
    carried.add('home')
    moved.push({
      table: 'home',
      from: 0,
      to: stamped,
      note: `${named} spaces named a front page in space.home`,
    })
    if (stamped != named) {
      throw new Refused(report(
        false,
        `${named} spaces named a front page and ${stamped} apps wear home`,
      ))
    }
  }

  // The app addresses → `former` (T-34390): the rows land under the new word
  // and the old table goes with the rest of the ones set aside.
  if (
    there(FORMERLY) && words.includes('former') &&
    addressing(d, aside(FORMERLY))
  ) {
    let { rows, moved: landed } = formerly(d, aside(FORMERLY))
    carried.add(FORMERLY)
    moved.push({
      table: 'former',
      from: 0,
      to: landed,
      note: `${rows} apps had an address of their own, named "${FORMERLY}"`,
    })
    if (landed != rows) {
      throw new Refused(report(
        false,
        `${rows} addresses to move and ${landed} landed in former`,
      ))
    }
  }

  // A domain's target → `serves` (T-34596). The straight copy above left the
  // old `app` column behind, since the new vocabulary does not declare it, so
  // the eids are read back out of the table set aside and land in the column
  // that names them now. The integer `entity` is the spine's and never moved,
  // which is what joins the two.
  // The directory's alone: an app store's old schema has the table and the new
  // vocabulary does not declare it, so there is nothing to update into.
  if (
    there('hostname') && words.includes('hostname') &&
    columns(d, aside('hostname')).includes('app')
  ) {
    let had = tally(d, aside('hostname'), notNull(col('app')))
    d.query({
      t: 'update',
      table: 'hostname',
      set: {
        serves: sub(select({
          cols: [col('app', 'h')],
          from: table(aside('hostname'), 'h'),
          where: eq(col('entity', 'h'), col('entity', 'hostname')),
        })),
      },
      where: isNull(col('serves')),
    })
    let aimed = tally(d, 'hostname', AIMED)
    moved.push({
      table: 'hostname',
      from: had,
      to: aimed,
      note: 'each domain aimed at the app it already served',
    })
    if (aimed != had) {
      throw new Refused(report(
        false,
        `${had} domains had a target and ${aimed} kept one`,
      ))
    }
  }

  // `references` → `referenced`, and the edge re-addressed with it: an edge's
  // eid is derived from `from|tag|to`, so the tag's new name is a new
  // address. The integer id does not move, so every row that points at this
  // edge still points at it.
  for (let [was, now] of Object.entries(RENAMED)) {
    if (!there(was) || !words.includes(now)) continue
    d.query({
      t: 'insert',
      into: now,
      cols: ['entity'],
      q: select({ cols: [col('entity')], from: table(aside(was)) }),
    })
    let ends = there('edge')
      ? d.query(select({
        cols: [
          as(col('entity', 'r'), 'id'),
          as(col('eid', 'f'), 'from'),
          as(col('eid', 't'), 'to'),
        ],
        from: table(aside(was), 'r'),
        joins: [
          join(
            table(aside('edge'), 'g'),
            eq(col('entity', 'g'), col('entity', 'r')),
          ),
          join(table('entity', 'f'), eq(col('id', 'f'), col('from', 'g'))),
          join(table('entity', 't'), eq(col('id', 't'), col('to', 'g'))),
        ],
      }))
      : []
    for (let e of ends) {
      d.query(readdress(
        Number(e.id),
        edgeEid(String(e.from), now, String(e.to)),
      ))
    }
    carried.add(now)
    moved.push({
      table: now,
      from: from(was),
      to: tally(d, now),
      note: `was "${was}"; ${ends.length} edges re-addressed under the new ` +
        `name (the other ${from(was) - ends.length} carry no edge row)`,
    })
  }

  // The levels the copy above set aside, as grants.
  let grants = 0
  let stranded = 0
  // Spine rows the pass minted rather than found: a grant is a new entity, and
  // so is the app it is on when this store has never written a row about it.
  // The only rows this pass adds, and the reconciliation names them.
  let minted = { n: 0 }
  if (splits && carried.has('member')) {
    let rows = d.query(select({
      cols: [as(col('eid', 'p'), 'person'), as(col('role', 'm'), 'role')],
      from: table(aside('member'), 'm'),
      joins: [
        left(table('entity', 'p'), eq(col('id', 'p'), col('person', 'm'))),
      ],
    }))
    for (let r of rows) {
      let was = String(r.role ?? '')
      if (was == 'owner' || !was) continue
      if (!o.app || r.person == null) {
        stranded++
        continue
      }
      let person = String(r.person)
      let eid = o.grantEid(o.app, person)
      d.query({
        t: 'insert',
        or: 'ignore',
        into: 'grant',
        cols: ['entity', 'app', 'person', 'access'],
        rows: [[
          val(idOf(d, eid, minted)),
          val(idOf(d, o.app, minted)),
          val(idOf(d, person, minted)),
          val(was),
        ]],
      })
      grants++
    }
    moved.push({
      table: 'grant',
      from: 0,
      to: tally(d, 'grant'),
      note: `minted from ${grants} non-owner member rows` +
        (stranded ? `; ${stranded} had no app to be a grant on` : ''),
    })
  }

  // Every word the new vocabulary names and the old store never had: the table
  // is standing and empty, which is what it should be.
  for (let comp of words) {
    if (carried.has(comp) || !stands(d, comp)) continue
    moved.push({ table: comp, from: 0, to: tally(d, comp) })
  }
  moved.push({
    table: 'entity',
    from: before.entity,
    to: tally(d, 'entity'),
    ...(minted.n
      ? { note: `${minted.n} minted for the grants and what they are on` }
      : {}),
  })
  moved.push({
    table: 'tombstone',
    from: before.tombstone,
    to: tally(d, 'tombstone'),
  })

  // The fleet's other words. No vocabulary names them, so their rows have
  // nowhere to go: the report names them and their tables are dropped.
  for (let name of old) {
    if (carried.has(name) || RENAMED[name] || name == 'blob_text') continue
    let rows = tally(d, aside(name))
    if (rows) dropped.push({ table: name, rows })
  }

  // The rule. Every table carries across the number of rows it had, and the
  // three exceptions are each a delta this pass can name:
  //   blob_text  was one row per body, is one row per distinct body
  //   grant      had none, has one per non-owner seat the split moved
  //   home       had none, has one per space that named a front page
  //   former     had none, has the addresses the old `alias` table held
  //   entity     gains one spine row per entity those grants named into being
  // Anything else that does not match is a copy that lost or gained a row, and
  // there is no version of that worth marking done.
  let SAID = ['grant', 'blob_text', 'home', 'former', 'entity']
  let off = moved.filter((m) => !SAID.includes(m.table) && m.from != m.to)
  let spine = moved.find((m) => m.table == 'entity')!
  if (spine.to != spine.from + minted.n) off.push(spine)
  if (off.length) {
    throw new Refused(report(
      false,
      `the counts did not reconcile: ` +
        off.map((m) => `${m.table} ${m.from}→${m.to}`).join(', '),
    ))
  }
  if (splits && grants != tally(d, 'grant')) {
    throw new Refused(report(
      false,
      `grant: minted ${grants}, stored ${tally(d, 'grant')}`,
    ))
  }

  // The tables aside, gone. A few of the fleet's point at each other rather
  // than at the spine (`blob_text` and `image` both key to `blob`), and dropping
  // a parent while a child still holds rows is a foreign-key failure — so a drop
  // that will not go yet is simply tried again on the next pass, which is the
  // dependency order without having to read it. `pragma foreign_keys` is not the
  // way out: SQLite ignores it inside a transaction, and this is all one.
  let rest = old
  while (rest.length) {
    let again: string[] = []
    for (let name of rest) {
      try {
        d.query({ t: 'drop', kind: 'table', name: aside(name), ifExists: true })
      } catch {
        again.push(name)
      }
    }
    if (again.length == rest.length) {
      throw new Refused(report(
        false,
        `these tables would not drop: ${again.join(', ')}`,
      ))
    }
    rest = again
  }
  return report(true)
}
