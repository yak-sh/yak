// What a Store's own storage is brought to at each wake (graph.ts): the schema
// its vocabulary implies, raised over whatever the object holds ({@link
// install}), the definitions re-cut when that schema moves ({@link recut},
// {@link rebuild}), a column its vocabulary stopped naming dropped ({@link
// shed}), and each slot the object remembers rewritten into the one shape a
// deploy takes now ({@link documented}, {@link unholed}, {@link unworded},
// {@link respelled}). {@link BOUNDARIES} names the stored shapes this code
// reads, for `yak admin deploys`.
import { fields, schema as ftsSchema } from '@yaks/fts'
import { driver, type DurableStorage, reserved } from '@yaks/durable-object'
import {
  and,
  col,
  type Derived,
  type Driver,
  eq,
  type Expr,
  lit,
  notNull,
  select,
  table,
  tally,
  val,
} from '@yaks/sql'
import { backfill, grown, indexed, tabled } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'

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

/** The stored shapes this code reads, each named by the pass that moved stores
 * into it, read per commit by `yak admin deploys`: a rollback across one would
 * serve rows the build before it cannot read. Every pass ran on every store and
 * was deleted, so only its name is left here. The shape it made is the one
 * this code reads, and code without the name is code from before it. */
export let BOUNDARIES = [
  'yak/store/packages/1',
  'yak/store/home/2',
  'yak/store/former/3',
  'yak/store/serves/4',
  'yak/store/handle/5',
  'yak/store/filed/6',
  'yak/store/tool/7',
  'yak/store/args/11',
]

/** The schema's own catalogue, narrowed to one type of object. */
let catalogued = (type: string, also?: Expr) =>
  select({
    cols: [col('name'), col('sql')],
    from: table('sqlite_master'),
    where: and(eq(col('type'), lit(type)), ...(also ? [also] : [])),
  })

/** A column dropped from a table. */
let unseat = (name: string, column: string) => ({
  t: 'alter table' as const,
  table: name,
  drop: column,
})

/**
 * Every definition of one type that is this object's — the single place this
 * file learns what tables there are.
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

/** The schema a vocabulary implies, raised over whatever the object holds.
 * Only the tables that stood before it can be missing a column (@yaks/sqlite
 * `grown`), so a fresh object is asked nothing about its columns. Existing rows
 * need a preparing migration before gaining a unique constraint; empty tables
 * can acquire it now without changing what old rows must satisfy. */
export let install = (
  storage: DurableStorage,
  vocab: Vocab,
  derived: Derived = {},
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
  if (vocab.comp('archetype')) backfill(d, false)
}

// A full-text index is several tables — the virtual one and its shadows — and
// the shadows are derived bytes nobody restores from. The virtual table's own
// name prefixes every one of them, which is how they are told apart.
let shadowed = (d: Driver): string[] =>
  named(d, 'table').filter((t) => /using\s+fts\d/i.test(t.sql)).map((t) =>
    t.name
  )
