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
// ## The passes after it
// A store that has carried can still hold a fact in a place the vocabulary no
// longer names — SQLite's schema is additive, so a column a word lost is still
// standing with its values in it. That is a second kind of migration and it is
// numbered ({@link MARKS}): {@link homed} is version 2, `space.home` becoming
// `home{}` on the app (T-34227); {@link addressed} is version 3, the
// directory's app addresses moving out of the table the core word `alias` now
// owns and into `former` (T-34390). Same two steps, same order — one
// transaction, then reconcile — over the new schema rather than the old one.
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
import { entryEid, TREE_ENTRY } from '@yaks/git'
import { identityEid, sha256 } from '@yaks/graph'
import {
  among,
  and,
  as,
  col,
  count,
  type Derived,
  type Driver,
  each,
  eq,
  type Expr,
  fn,
  iff,
  isNull,
  join,
  left,
  lit,
  ne,
  notNull,
  op,
  or,
  type Query,
  type Select,
  select,
  sub,
  table,
  val,
} from '@yaks/sql'
import { backfill, fold, grown, indexed, pointers, tabled } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { handle } from './directory.ts'

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

/** The marker written when a pass reconciles, so it never runs twice. The
 * number is the version an object stands at: {@link MARK} is the move off the
 * fleet-shaped store, and each one after it a pass over the new schema
 * ({@link MARKS}). An object is at the last marker it wrote, and a pass whose
 * marker is already there does not run. */
export let MARK = 'yak/store/packages/1'

/** The second pass (T-34227): `space.home` — the property that said which app a
 * space opens at — becomes `home{}` worn by that app. The directory's alone;
 * no other object has a `space` table. */
export let HOMED = 'yak/store/home/2'

/** The third pass (T-34390): the directory's app addresses — `{slug, slugs}`,
 * named `alias` until that word became every store's (@yaks/alias) — move to
 * `former`. The directory's alone; no other object has a row of them. */
export let FORMER = 'yak/store/former/3'

/** The fourth pass (T-34596): a domain's target — the property that said which
 * app a hostname opens — becomes `serves`, which names the app or the whole
 * space. The directory's alone; no other object has a hostname. */
export let SERVES = 'yak/store/serves/4'

/** The fifth pass (T-34657): an app's handle — the string its Durable Object,
 * its script and its analytics rows are named by — becomes a property of its
 * own, `app.store`, instead of being read back off the address it was born at.
 * The directory's alone; no other object has an app row. */
export let HANDLED = 'yak/store/handle/5'

/** The sixth pass: portfolio fields move off task into optional filed. */
export let FILED = 'yak/store/filed/6'

/** The seventh pass (D-37943): a tool is its name. `tool.name` is the tool's
 * identity, so its entity takes the id the name derives. */
export let TOOLED = 'yak/store/tool/7'

/** The eighth pass (C-37980): a copy of somebody else's app runs like the
 * space's own apps unless its owner sandboxed it (`installed.sandboxed`),
 * where it used to run sandboxed until they trusted it (`installed.trusted`).
 * Each copy that is not sandboxed is stamped trusted as well, so the build
 * before this one serves it the same way. The directory's alone; no other
 * object has an install. */
export let SANDBOXED = 'yak/store/sandboxed/8'

/** The ninth pass: a sent letter's Message-ID moves out of `delivered.via`,
 * where the transport's receipt was kept, onto `mail.message_id`, where an
 * arrival's is — so a reply to either threads the same way. Any store that
 * sends mail. */
export let SENT = 'yak/store/sent/9'

/** The tenth pass: a tree's link to a child is a `tree_entry`, at the id that
 * tag derives. The git object store's alone; no other object has a `gitobj`
 * table. */
export let ENTERED = 'yak/store/entered/10'

/** The eleventh pass (T-38042): a call's arguments are the object they spell,
 * kept as SQLite's binary JSON, where they were that object's JSON text. Any
 * store a tool is called in. */
export let ARGUED = 'yak/store/args/11'

/** Every marker in order, so "is this object caught up" is one comparison and
 * a new pass is one line here. */
export let MARKS = [
  MARK,
  HOMED,
  FORMER,
  SERVES,
  HANDLED,
  FILED,
  TOOLED,
  SANDBOXED,
  SENT,
  ENTERED,
  ARGUED,
]

/** Passes that change stored shape, read per commit by `yak admin deploys`.
 * A refused pass leaves stored data and its marker unchanged, so adds no
 * boundary. Nor does an expanding pass the build before it reads correctly:
 * SANDBOXED and SENT write only properties that build already reads, and
 * ENTERED moves rows it never read into the table it does. */
export let BOUNDARIES = [
  MARK,
  HOMED,
  FORMER,
  SERVES,
  HANDLED,
  FILED,
  TOOLED,
  ARGUED,
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
 * ({@link addressed}). */
let FORMERLY = 'alias'

/** How many rows a query answers, as its `n`. */
let n = (d: Driver, q: Query): number => Number(d.query(q)[0]?.n ?? 0)

/** How many rows a table holds, or how many of them match. */
let tally = (d: Driver, name: string, where?: Expr): number =>
  n(d, select({ cols: [as(count(), 'n')], from: table(name), where }))

/** How many rows a query selects. */
let many = (d: Driver, q: Query): number =>
  n(d, select({ cols: [as(count(), 'n')], from: { t: 'from', q } }))

/** Whether a query selects a row at all. */
let found = (d: Driver, q: Select): boolean =>
  d.query({ ...q, limit: lit(1) }).length > 0

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

/** Existing rows need a preparing pass before gaining a unique constraint.
 * Empty tables can acquire it now without changing what old rows must satisfy.
 * `migrated` is the object's marker: a pass it has not reached, over rows it
 * still has to prepare, raises its own index once they satisfy it. */
export let install = (
  storage: DurableStorage,
  vocab: Vocab,
  derived: Derived = {},
  migrated: string | null = null,
  classify = true,
) => {
  let d = driver(storage)
  for (let stmt of tabled(vocab, derived)) d.query(stmt)
  for (let stmt of grown(d, vocab)) d.query(stmt)
  let held = new Set(named(d, 'index').map((i) => i.name))
  // HANDLED assigns and reconciles handles before it raises `app_store`;
  // TOOLED moves and merges tools before it raises `tool_name`.
  let prepared: Record<string, [string, (s: DurableStorage) => boolean]> = {
    app_store: [HANDLED, unhandled],
    tool_name: [TOOLED, mistooled],
  }
  let deferred = (name: string) => {
    let [mark, holds] = prepared[name] ?? []
    return !!mark && !!holds &&
      MARKS.indexOf(migrated ?? '') < MARKS.indexOf(mark) && holds(storage)
  }
  let ready = {
    ...vocab,
    indexes: (table: string) =>
      vocab.indexes(table).filter((i) => {
        let name = `${table}_${i.props.join('_')}`
        if (held.has(name)) return false
        if (!i.unique || !tally(d, table)) return true
        if (deferred(name)) return false
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

export let unfiled = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'task') && stands(d, 'filed') &&
    filingCols(d, 'task').length > 0
}

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

/** Run inside transactionSync, like every numbered pass. */
export let filed = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let moved = fileward(d, 'task')
  let notes: string[] = []
  // Dead columns are tidying, not the move (the same rule as homed). A
  // platform SQLite version that cannot drop one must not lose its data or
  // rerun this pass; the marker and copied rows commit together.
  for (let c of filingCols(d, 'task')) {
    try {
      d.query(unseat('task', c))
    } catch (e) {
      notes.push(`${c} remains dead: ${String(e)}`)
    }
  }
  return {
    ...o,
    at: new Date().toISOString(),
    ok: true,
    mark: FILED,
    moved: [{
      table: 'filed',
      from: moved,
      to: moved,
      note: `task filing preserved${
        notes.length ? '; ' + notes.join('; ') : ''
      }`,
    }],
    dropped: [],
  }
}

// ---- a tool is its name (D-37943) ------------------------------------------
//
// A call points at a `tool` entity, and the id of one was the hash of
// `tool:<name>`. The vocabulary now declares `tool.name` its identity, so the
// id is the one @yaks/graph derives from the name, and a tool row standing at
// the old id would refuse the runner's next planting of the same name. The
// integer id stays, so every call keeps pointing at its tool; only the eid it
// is called by moves.

// Each tool row, with the eid it stands at and the one its name derives,
// oldest first.
let toolIds = (d: Driver) =>
  stands(d, 'tool')
    ? d.query(select({
      cols: [col('id', 'e'), col('eid', 'e'), col('name', 't')],
      from: table('tool', 't'),
      joins: [
        join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 't'))),
      ],
      where: notNull(col('name', 't')),
      order: [col('id', 'e')],
    })).map((r) => ({
      id: Number(r.id),
      eid: String(r.eid),
      named: identityEid('tool', [String(r.name)]),
    }))
    : []

// The unique index the vocabulary raises over `tool.name`, its identity, by
// the name @yaks/sqlite gives it (`<comp>_<props>`).
let TOOL_NAME = 'tool_name'

/** Whether the tools are not yet their names: a row standing at an id its name
 * does not derive, or rows the identity's unique index has not been raised
 * over. */
export let mistooled = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  let rows = toolIds(d)
  return rows.some((t) => t.eid != t.named) ||
    (rows.length > 0 && !named(d, 'index').some((i) => i.name == TOOL_NAME))
}

/**
 * Each tool onto the id its name derives, synchronously, inside
 * `transactionSync` like every numbered pass, and then the identity's unique
 * index, which `install()` leaves to this pass.
 *
 * Tools sharing a name are one tool: the newest row stays, the others fold
 * into it (@yaks/sqlite `fold`) with every reference repointed, and it takes
 * the derived id. It refuses, moving nothing, when the derived id is another
 * entity's, or when a link touches a tool — a link's id is derived from its
 * ends, and no store has one to a tool.
 */
export let tooled = (
  storage: DurableStorage,
  o: { store: string; app: string | null; vocab: Vocab },
): Report => {
  let d = driver(storage)
  let rows = toolIds(d)
  let report = (
    ok: boolean,
    moved: number,
    merged: number,
    message?: string,
  ): Report => ({
    store: o.store,
    app: o.app,
    at: new Date().toISOString(),
    ok,
    message,
    mark: TOOLED,
    moved: [{
      table: 'tool',
      from: rows.length,
      to: rows.length - merged,
      note: `${moved} tools called by the id their name derives, ` +
        `${merged} merged into the newest of their name`,
    }],
    dropped: [],
  })
  let byName = Map.groupBy(rows, (t) => t.named)
  let moving = [...byName.values()]
    .filter((ts) => ts.length > 1 || ts[0].eid != ts[0].named).flat()
  let ids = each(moving.map((t) => t.id))
  let linked = stands(d, 'edge') && moving.length
    ? tally(d, 'edge', or(among(col('from'), ids), among(col('to'), ids)))
    : 0
  if (linked) {
    throw new Refused(report(false, 0, 0, `${linked} links touch a tool`))
  }
  let into = fold(d, pointers(d, o.vocab))
  let moved = 0
  let merged = 0
  for (let [eid, ts] of byName) {
    let keep = ts[ts.length - 1]
    for (let t of ts.slice(0, -1)) {
      into(t.id, keep.id)
      merged++
    }
    if (keep.eid == eid) continue
    if (d.query(byEid(eid)).length) {
      throw new Refused(
        report(false, 0, 0, `${eid} is already another entity's id`),
      )
    }
    d.query(readdress(keep.id, eid))
    moved++
  }
  if (rows.length) {
    d.query({
      t: 'create index',
      name: TOOL_NAME,
      on: 'tool',
      cols: [col('name')],
      unique: true,
      ifNot: true,
    })
  }
  if (mistooled(storage)) {
    throw new Refused(
      report(false, 0, 0, 'a tool still stands at an old id'),
    )
  }
  return report(true, moved, merged)
}

// ---- a copy runs like the space's own apps (C-37980) -----------------------
//
// Expand, not contract (D-37972): `installed.sandboxed` is the word now, and
// empty on every copy, since the space is the trust boundary and no owner had
// asked for a sandbox.
// The build before this one read `installed.trusted` the other way round, so
// a copy it would still sandbox is stamped trusted here, and tools.ts writes
// both from now on (installed.ts `sandboxing`). A later release drops it.

// The copies the build before this one would sandbox and this one does not.
let UNTRUSTED = and(isNull(col('sandboxed')), isNull(col('trusted')))

/** Whether a copy stands that the two builds would serve differently. */
export let untrusted = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'installed') &&
    ['sandboxed', 'trusted'].every((c) =>
      columns(d, 'installed').includes(c)
    ) &&
    found(
      d,
      select({ cols: [lit(1)], from: table('installed'), where: UNTRUSTED }),
    )
}

/** Every such copy stamped trusted, inside `transactionSync` like every
 * numbered pass. */
export let trusting = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let rest = () => tally(d, 'installed', UNTRUSTED)
  let from = rest()
  let at = new Date().toISOString()
  d.query({
    t: 'update',
    table: 'installed',
    set: { trusted: val(at) },
    where: UNTRUSTED,
  })
  let to = from - rest()
  return {
    ...o,
    at,
    ok: to == from,
    mark: SANDBOXED,
    moved: [{
      table: 'installed',
      from,
      to,
      note: 'copies stamped trusted, so the build before this serves them ' +
        'unsandboxed too',
    }],
    dropped: [],
  }
}

// ---- a sent letter's Message-ID → `mail.message_id` ------------------------
//
// Expand, not contract: the build before this one kept the Message-ID the
// transport gave a letter in `delivered.via`, beside `local` for a letter
// delivered by writing it and the address it went to when the transport gave
// none. Only the Message-ID moves, onto `mail.message_id`, where an arrival's
// already is. The build before reads `mail.message_id` first when it threads a
// reply, so it serves the moved letters the same; the column stays until no
// build writes it.

// The letters whose Message-ID is still only in `delivered.via`.
let UNSENT = select({
  cols: [col('entity', 'm')],
  from: table('mail', 'm'),
  joins: [
    join(table('delivered', 'd'), eq(col('entity', 'd'), col('entity', 'm'))),
  ],
  where: and(
    isNull(col('message_id', 'm')),
    notNull(col('via', 'd')),
    ne(col('via', 'd'), lit('local')),
    op('is not', col('via', 'd'), col('to', 'm')),
  ),
})

/** Whether a sent letter's Message-ID is still only in `delivered.via`. */
export let unsent = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'mail') && stands(d, 'delivered') &&
    columns(d, 'delivered').includes('via') &&
    found(d, UNSENT)
}

/** Each such Message-ID copied onto its letter, inside `transactionSync` like
 * every numbered pass. */
export let sent = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let rest = () => many(d, UNSENT)
  let from = rest()
  d.query({
    t: 'update',
    table: 'mail',
    set: {
      message_id: sub(select({
        cols: [col('via')],
        from: table('delivered'),
        where: eq(col('entity', 'delivered'), col('entity', 'mail')),
      })),
    },
    where: among(col('entity'), UNSENT),
  })
  let to = from - rest()
  return {
    ...o,
    at: new Date().toISOString(),
    ok: to == from,
    mark: SENT,
    moved: [{
      table: 'mail',
      from,
      to,
      note: 'sent letters given the Message-ID delivered.via held',
    }],
    dropped: [],
  }
}

// ---- a tree's link to a child → `tree_entry` -------------------------------
//
// @yaks/git tagged a tree's link `entry` until it took git's own two words
// (76058ad2), and a link's id is derived from its tag, its tree and its name
// (`entryEid`). The trees minted before that stayed under the old tag, where
// the walk that builds a pack never looks, so a clone of any history reaching
// one arrived without that tree's files. Each link takes the tag and the id it
// has now; a link the same tree was minted again under since is the same
// link, and the old row folds into it. Then the old table goes.

/** The tag a tree's link wore before, and the table its rows are still in. */
let ENTRY = 'entry'

// Each link still under the old tag, with the id its tree and name derive now.
let entries = (d: Driver) =>
  d.query(select({
    cols: [
      as(col('entity', 'n'), 'id'),
      col('name', 'n'),
      col('mode', 'n'),
      as(col('eid', 't'), 'tree'),
    ],
    from: table(ENTRY, 'n'),
    joins: [
      join(table('edge', 'e'), eq(col('entity', 'e'), col('entity', 'n'))),
      join(table('entity', 't'), eq(col('id', 't'), col('from', 'e'))),
    ],
  })).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    mode: String(r.mode),
    eid: entryEid(String(r.tree), String(r.name)),
  }))

/** Whether the git object store still has the old tag's table. */
export let misentered = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'gitobj') && stands(d, ENTRY)
}

/** Each old link onto `tree_entry` at its derived id, inside `transactionSync`
 * like every numbered pass, and the old table dropped. A row with no edge
 * beside it names no tree, so it has nowhere to go and goes with the table. */
export let entered = (
  storage: DurableStorage,
  o: { store: string; app: string | null; vocab: Vocab },
): Report => {
  let d = driver(storage)
  let from = tally(d, ENTRY)
  let had = tally(d, TREE_ENTRY)
  let into = fold(d, pointers(d, o.vocab))
  let moved = 0
  let merged = 0
  for (let r of entries(d)) {
    let [same] = d.query(byEid(r.eid))
    if (same) {
      into(r.id, Number(same.id))
      merged++
      continue
    }
    d.query({
      t: 'insert',
      into: TREE_ENTRY,
      cols: ['entity', 'name', 'mode'],
      rows: [[val(r.id), val(r.name), val(r.mode)]],
    })
    d.query(readdress(r.id, r.eid))
    moved++
  }
  d.query({ t: 'drop', kind: 'table', name: ENTRY })
  return {
    store: o.store,
    app: o.app,
    at: new Date().toISOString(),
    ok: tally(d, TREE_ENTRY) == had + moved,
    mark: ENTERED,
    moved: [{
      table: TREE_ENTRY,
      from,
      to: moved,
      note: `${moved} tree links retagged from "${ENTRY}", ` +
        `${merged} folded into the same link minted since, ` +
        `${from - moved - merged} with no edge dropped`,
    }],
    dropped: [{ table: ENTRY, rows: from }],
  }
}

// ---- a call's arguments → the object they spell (T-38042) -----------------
//
// `call.args` was the arguments' JSON text, and is the object: @yaks/tools
// hands a tool the call with its arguments in place, and a jsonb property is
// kept as SQLite's binary JSON (@yaks/sqlite ./jsonb.ts). SQLite never retypes
// a column, so the text stays text until it is rewritten. Text that is not
// JSON becomes the JSON string holding it: nothing is lost, and the runner
// refuses it as arguments, as it refused the text.

// The calls whose arguments are still text.
let TEXTUAL = eq(fn('typeof', col('args')), lit('text'))
let TEXT_ARGS = select({
  cols: [col('entity')],
  from: table('call'),
  where: TEXTUAL,
})

/** Whether a call's arguments are still their JSON text. */
export let unargued = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'call') && columns(d, 'call').includes('args') &&
    found(d, TEXT_ARGS)
}

/** Each call's arguments rewritten as binary JSON, inside `transactionSync`
 * like every numbered pass. */
export let argued = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let rest = () => many(d, TEXT_ARGS)
  let from = rest()
  let args = col('args')
  d.query({
    t: 'update',
    table: 'call',
    set: {
      args: fn(
        'jsonb',
        iff(fn('json_valid', args), args, fn('json_quote', args)),
      ),
    },
    where: TEXTUAL,
  })
  let to = from - rest()
  return {
    ...o,
    at: new Date().toISOString(),
    ok: to == from,
    mark: ARGUED,
    moved: [{ table: 'call', from, to, note: 'arguments kept as binary JSON' }],
    dropped: [],
  }
}

// ---- `space.home` → `home{}` (T-34227) -------------------------------------
//
// The fact "this app is the space's front page" was a property of the space and
// is now a word the app wears (vocab.ts). It moves in both passes, because a
// store reaches it from either side: one carrying now finds the column in the
// table renamed aside, one that carried before this word existed finds it
// standing in `space` itself — SQLite never drops a column a vocabulary stopped
// declaring. Same insert either way, so it is said once.

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

/**
 * Whether this object still says which app a space opens in the old place: a
 * `space` table with a `home` column. False for every app store — no `space`
 * table at all — and for a directory {@link homed} has already been over, since
 * that pass drops the column.
 *
 * SQLite never drops a column a vocabulary stopped declaring (the schema is
 * additive, graph.ts `#boot`), which is exactly why the values are still there
 * to be read after the word is gone from vocab.ts.
 */
export let housed = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'space') && stands(d, 'home') &&
    columns(d, 'space').includes('home')
}

/**
 * `space.home` → `home{}` on the app it named (T-34227), synchronously — run it
 * inside `transactionSync` for the same reason {@link carry} is: a throw is how
 * it refuses and the rollback is how it leaves nothing behind.
 *
 * The rule: one `home` row per space that named an app, and not one more. A
 * count that does not match is two spaces naming one app, or a row the insert
 * would not take, and neither is a directory to go on serving from — so it
 * refuses, and the column keeps the fact.
 */
export let homed = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let at = new Date().toISOString()
  let moved: Moved[] = []
  let report = (ok: boolean, message?: string): Report => ({
    store: o.store,
    app: o.app,
    at,
    ok,
    message,
    mark: HOMED,
    moved,
    dropped: [],
  })
  let spaces = tally(d, 'space')
  let { named, stamped } = homeward(d, 'space')
  moved.push({
    table: 'home',
    from: 0,
    to: stamped,
    note: `${named} spaces named a front page`,
  })
  if (stamped != named) {
    throw new Refused(report(
      false,
      `${named} spaces named a front page and ${stamped} apps wear home: ` +
        'two spaces cannot open the same app',
    ))
  }
  // The old place, swept up. Tidying, not the move: the fact is already on the
  // apps, the vocabulary no longer declares this column, and nothing selects
  // it — so a drop the engine will not do leaves a dead column and a working
  // directory. Refusing over it would answer 503 to the whole platform for a
  // column nobody reads, so it is noted in the report and the pass stands.
  let swept = ''
  try {
    d.query(unseat('space', 'home'))
  } catch (e) {
    swept = `the home column would not drop: ${
      e instanceof Error ? e.message : String(e)
    } — it is dead, nothing selects it`
  }
  let kept = tally(d, 'space')
  moved.push({
    table: 'space',
    from: spaces,
    to: kept,
    note: swept || 'the home column dropped',
  })
  // The rows themselves are the move, and losing one is not tidying.
  if (kept != spaces) {
    throw new Refused(report(false, `space ${spaces}→${kept}`))
  }
  return report(true)
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
// in them. The rows move to `former` and the dead columns are swept.

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

/** Whether this object still keeps app addresses under the core word's table.
 * False for every app store — no addresses — and for a directory
 * {@link addressed} has already been over. */
export let slugged = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'former') && addressing(d, FORMERLY)
}

/**
 * The app addresses out of `alias` and into `former` (T-34390), synchronously —
 * run it inside `transactionSync` for the same reason {@link carry} is: a throw
 * is how it refuses and the rollback is how it leaves nothing behind.
 *
 * The rule: every address carries across. One that does not is an address an
 * app answers at and the directory can no longer find, which is a rename that
 * strands every open page — so it refuses, and the rows stay where they are.
 */
export let addressed = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let at = new Date().toISOString()
  let moved: Moved[] = []
  let report = (ok: boolean, message?: string): Report => ({
    store: o.store,
    app: o.app,
    at,
    ok,
    message,
    mark: FORMER,
    moved,
    dropped: [],
  })
  let { rows, moved: landed } = formerly(d, FORMERLY)
  moved.push({
    table: 'former',
    from: 0,
    to: landed,
    note: `${rows} apps had an address of their own`,
  })
  if (landed != rows) {
    throw new Refused(report(
      false,
      `${rows} addresses to move and ${landed} landed in former`,
    ))
  }
  d.query({ t: 'delete', from: FORMERLY, where: SLUGGED })
  // The old place, swept up. Tidying, not the move: the addresses are in
  // `former`, the vocabulary declares neither column, and nothing selects
  // them — so a drop the engine will not do leaves two dead columns and a
  // working directory. The unique index goes first because SQLite will not
  // drop a column an index stands on, and that index is the old word's.
  let swept = ''
  try {
    d.query({
      t: 'drop',
      kind: 'index',
      name: `${FORMERLY}_slug`,
      ifExists: true,
    })
    d.query(unseat(FORMERLY, 'slug'))
    d.query(unseat(FORMERLY, 'slugs'))
  } catch (e) {
    swept = `the address columns would not drop: ${
      e instanceof Error ? e.message : String(e)
    } — they are dead, nothing selects them`
  }
  moved.push({
    table: FORMERLY,
    from: rows,
    to: 0,
    note: swept || 'the slug and slugs columns dropped',
  })
  return report(true)
}

// ---- a domain's target: `hostname.app` → `hostname.serves` (T-34596) --------
//
// A hostname used to name the one app it opened. It now names the place it
// opens — that app, or the whole space, whose front page it serves at `/` with
// every app of it at `/<app>/` — and one property says which (vocab.ts). The
// column a word loses is still standing with its values in it, and nothing
// selects it, so a domain whose target stayed in `app` would resolve to
// nothing: a live customer domain would stop serving at the deploy. The eids
// move across, and each one still points at the same app.

/** Whether this object still keeps a domain's target under the old column: the
 * hostname table with an `app` beside `serves`. False for every app store — no
 * hostnames — and for a directory {@link served} has already been over. */
let AIMED = notNull(col('serves'))

export let aimedOld = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'hostname') && columns(d, 'hostname').includes('app')
}

/**
 * The target out of `app` and into `serves` (T-34596), synchronously — run it
 * inside `transactionSync` for the same reason {@link carry} is: a throw is how
 * it refuses and the rollback is how it leaves nothing behind.
 *
 * The rule: every hostname keeps a target. One left without is a domain the
 * platform serves nothing at — a customer's own address answering the branded
 * "still connecting" page for good — so it refuses, and the eids stay where
 * they are.
 */
export let served = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let at = new Date().toISOString()
  let moved: Moved[] = []
  let report = (ok: boolean, message?: string): Report => ({
    store: o.store,
    app: o.app,
    at,
    ok,
    message,
    mark: SERVES,
    moved,
    dropped: [],
  })
  let rows = tally(d, 'hostname')
  d.query({
    t: 'update',
    table: 'hostname',
    set: { serves: col('app') },
    where: and(isNull(col('serves')), notNull(col('app'))),
  })
  let aimed = tally(d, 'hostname', AIMED)
  moved.push({
    table: 'hostname',
    from: rows,
    to: aimed,
    note: `${rows} domains, each aimed at the app it already served`,
  })
  if (aimed != rows) {
    throw new Refused(report(
      false,
      `${rows} domains and ${aimed} with a target: one would serve nothing`,
    ))
  }
  // The old place, swept up. Tidying, not the move: the targets are in
  // `serves`, the vocabulary no longer declares this column, and nothing
  // selects it — so a drop the engine will not do leaves a dead column and a
  // working directory.
  let swept = ''
  try {
    d.query(unseat('hostname', 'app'))
  } catch (e) {
    swept = `the app column would not drop: ${
      e instanceof Error ? e.message : String(e)
    } — it is dead, nothing selects it`
  }
  moved.push({
    table: 'hostname',
    from: rows,
    to: tally(d, 'hostname'),
    note: swept || 'the app column dropped',
  })
  return report(true)
}

// ---- an app's handle: `former.slug` → `app.store` (T-34657) -----------------
//
// An app's store, script and analytics rows were named by the address it was
// born at, kept in `former.slug`. That made the platform's own object names a
// projection of a string a person picks — so an address could never be freed
// and reused, and renaming the space was not a thing that could be offered at
// all. The handle moves into a property of the app's own, `app.store`. An
// unambiguous name stays put; apps sharing one are separated without copying
// any bytes, and the report names which app keeps the rows.
//
// And `former` is left as what it now only is — address history — with the
// space prefix taken off each entry, so the history is in the space's own
// namespace and a space rename leaves it standing (T-34658).

/** Whether this object still names its apps by their birth address: an app row
 * with no handle of its own. False for every app store — no app table — and for
 * a directory {@link handled} has already been over. */
export let unhandled = (storage: DurableStorage): boolean => {
  let d = driver(storage)
  return stands(d, 'app') && columns(d, 'app').includes('store') &&
    tally(d, 'app', isNull(col('store'))) > 0
}

/** One address with the space prefix taken off it: `ada/cookbook` is
 * `cookbook`, and a bare `cookbook` is already itself. A slug holds no slash
 * (route.ts slug), so the seam is never in doubt. */
let bare = (address: string) => address.slice(address.indexOf('/') + 1)

/**
 * The handle out of `former.slug` and into `app.store` (T-34657), synchronously
 * — run it inside `transactionSync` for the same reason {@link carry} is: a
 * throw is how it refuses and the rollback is how it leaves nothing behind.
 *
 * The rule: every app ends with a handle, and no two share one. An app left
 * without is an app whose store nothing can open — every recipe in it gone from
 * the platform's point of view — so it refuses, and the rows stay where they
 * are.
 *
 * An app with no `former` row at all (one born before addresses were kept) gets
 * the name it is already answering to, `<space>/<app>` as the rows stand, which
 * is what the code fell back to for it anyway.
 *
 * A shared name belongs to the oldest entity num: creation order survives a
 * rename, whereas the current slug does not establish who was born there.
 * Existing handles stay reserved. Every other claimant gets app_new's handle
 * at its current address; its old rows stay in the shared store. Reserve all
 * bare names before minting suffixes so a suffix cannot take another's store.
 */
export let handled = (
  storage: DurableStorage,
  o: { store: string; app: string | null },
): Report => {
  let d = driver(storage)
  let at = new Date().toISOString()
  let moved: Moved[] = []
  let report = (ok: boolean, message?: string): Report => ({
    store: o.store,
    app: o.app,
    at,
    ok,
    message,
    mark: HANDLED,
    moved,
    dropped: [],
  })
  try {
    let former = stands(d, 'former')
    let apps = d.query(select({
      cols: [
        col('entity', 'a'),
        col('eid', 'e'),
        col('slug', 'a'),
        as(col('slug', 's'), 'space'),
        col('store', 'a'),
        as(former ? col('slug', 'f') : lit(null), 'birth'),
      ],
      from: table('app', 'a'),
      joins: [
        join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'a'))),
        left(table('space', 's'), eq(col('entity', 's'), col('space', 'a'))),
        ...(former
          ? [
            left(
              table('former', 'f'),
              eq(col('entity', 'f'), col('entity', 'a')),
            ),
          ]
          : []),
      ],
      order: [col('num', 'e'), col('id', 'e')],
    })).map((r) => {
      let space = r.space == null ? null : String(r.space)
      let slug = r.slug == null ? null : String(r.slug)
      let store = r.store == null ? null : String(r.store)
      let birth = r.birth == null ? null : String(r.birth)
      return {
        id: Number(r.entity),
        eid: String(r.eid),
        space,
        slug,
        store,
        next: store ?? birth ?? (space && slug ? `${space}/${slug}` : null),
      }
    })
    let owners = new Map<string, typeof apps[number]>()
    for (let app of apps) {
      if (app.store != null) owners.set(app.store, app)
    }
    let split: {
      app: typeof apps[number]
      was: string
      owner: typeof apps[number]
    }[] = []
    for (let app of apps) {
      if (app.store != null || app.next == null) continue
      let owner = owners.get(app.next)
      if (owner) split.push({ app, was: app.next, owner })
      else owners.set(app.next, app)
    }
    let notes: string[] = []
    let named = (app: typeof apps[number]) =>
      `${app.space}/${app.slug} (${app.eid})`
    for (let { app, was, owner } of split) {
      app.next = app.space && app.slug
        ? handle({ slug: app.space }, app.slug, app.eid)
        : null
      notes.push(
        `${named(app)}: ${was} -> ${app.next ?? 'no handle'}; ` +
          `previous rows stay in ${was}, kept by ${named(owner)}; ` +
          'the new handle opens an empty store; no data copied',
      )
    }
    let held = apps.filter((a) => a.next != null).length
    let distinct = new Set(
      apps.map((a) => a.next).filter((s) => s != null),
    ).size
    moved.push({
      table: 'app',
      from: apps.length,
      to: held,
      note: [`${held} handles planned, ${split.length} disambiguated`, ...notes]
        .join('\n'),
    })
    if (held != apps.length || distinct != apps.length) {
      throw new Refused(report(
        false,
        `${apps.length} apps, ${held} with a handle and ${distinct} distinct: one ` +
          'would open the wrong store or none',
      ))
    }
    for (let app of apps) {
      if (app.store != null) continue
      d.query({
        t: 'update',
        table: 'app',
        set: { store: val(app.next) },
        where: eq(col('entity'), val(app.id)),
      })
    }
    let [counts] = d.query(select({
      cols: [
        as(count(), 'apps'),
        as(fn('count', col('store')), 'held'),
        as(
          { t: 'fn', name: 'count', args: [col('store')], distinct: true },
          'names',
        ),
      ],
      from: table('app'),
    }))
    if (
      counts.apps != apps.length || counts.held != apps.length ||
      counts.names != apps.length
    ) {
      throw new Refused(report(false, 'the written handles did not reconcile'))
    }
    d.query({
      t: 'create index',
      name: 'app_store',
      on: 'app',
      cols: [col('store')],
      unique: true,
      ifNot: true,
    })
    // The unique index the old name was decided by. It stands on `former.slug`,
    // and that column is address history now — two apps may hold one address a
    // year apart, which is the whole point of freeing one (T-34659) — so the
    // index has to come down or the second app could never be born. Its name is
    // the vocabulary's own (@yaks/sqlite `indexDdl`), which is why it can be
    // named here at all.
    d.query({ t: 'drop', kind: 'index', name: 'former_slug', ifExists: true })
    // The addresses, unqualified. `former` is the app's history within its space
    // now, so the space's name has no business in it: leave it and a space rename
    // strands every redirect the space's apps ever earned.
    let rows = stands(d, 'former')
      ? d.query(select({
        cols: [col('entity'), col('slug'), col('slugs')],
        from: table('former'),
      }))
      : []
    let stripped = 0
    for (let r of rows) {
      let slug = r.slug == null ? null : bare(String(r.slug))
      let slugs = r.slugs == null
        ? null
        : String(r.slugs).split(/\s+/).filter(Boolean).map(bare).join(' ')
      if (slug == r.slug && slugs == r.slugs) continue
      stripped++
      d.query({
        t: 'update',
        table: 'former',
        set: { slug: val(slug), slugs: val(slugs) },
        where: eq(col('entity'), val(r.entity as number)),
      })
    }
    moved.push({
      table: 'former',
      from: rows.length,
      to: rows.length,
      note:
        `${stripped} address histories now read in the space's own namespace`,
    })
    return report(true)
  } catch (e) {
    if (e instanceof Refused) throw e
    // Keep the assignment report even if an index or trigger refuses a write.
    throw new Refused(report(false, e instanceof Error ? e.message : String(e)))
  }
}

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

  // `space.home` → `home{}` on the app it named (T-34227). A store carrying now
  // arrives at version 2 in the same breath, so {@link homed} has nothing left
  // to do for it — and the column is not among the ones `space` copies across,
  // since the new vocabulary does not declare it.
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

  // The app addresses → `former` (T-34390). A store carrying now arrives at
  // version 3 in the same breath, so {@link addressed} has nothing left to do
  // for it: the rows land under the new word and the old table goes with the
  // rest of the ones set aside.
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
  // which is what joins the two. A store carrying now arrives at version 4 in
  // the same breath, so {@link served} has nothing left to do for it.
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
