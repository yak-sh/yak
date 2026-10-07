// What a Store's own storage is brought to at each wake (graph.ts): the schema
// its vocabulary implies, raised over whatever the object holds ({@link
// install}), changed definitions installed when that schema moves, a column
// its vocabulary stopped naming dropped ({@link shed}), and each slot the object remembers rewritten into the one shape a
// deploy takes now ({@link documented}, {@link unholed}, {@link unworded},
// {@link respelled}). {@link BOUNDARIES} names the stored shapes this code
// reads, for `yak admin deploys`.
import { adopt, fields } from '@yaks/fts'
import { rekey, schema as vectorSchema } from '@yaks/embedding'
import { reserved } from '@yaks/durable-object'
import {
  and,
  col,
  type Derived,
  type Driver,
  eq,
  type Expr,
  isNull,
  lit,
  notNull,
  select,
  table,
  tally,
  val,
} from '@yaks/sql'
import {
  backfill,
  epoch,
  epochAt,
  fit,
  indexed,
  retabled,
  retired,
} from '@yaks/sqlite'
import type { Index, Vocab } from '@yaks/vocab'

import { type Bundle, type Comp, token } from '@yaks/graph'
import type { Rule } from './mover.ts'

// T-65228: app stores never composed mail_inbox. T-65357 stopped owing new
// runs and ignores these old ones when arming alarms. The owner invokes
// the live mover explicitly; reading an app never runs cleanup.
// Restrict it to the reported archive-change shape, never-started/unclaimed,
// recorded before the owner-confirmed T-65357 deployment on October 4, 2026.
let DEAD_MAIL_BEFORE = '2026-10-04T19:07:36.000Z'
let deadMailFind = '.effect.handler=mail_inbox&.effect.state=pending' +
  '&.effect.kind=changed&.effect.comp=archived&.effect.attempts=0' +
  `&.effect.at<${DEAD_MAIL_BEFORE}` +
  '&!effect.lease_owner&!effect.lease_token&!effect.lease_expiry'

/** Remove only the dead run component, not its entity or its target/archive.
 * Guards also protect an attempt/claim made after selection. Keeping other
 * components avoids deleting unrelated data attached to the run entity. */
export let deadMailInboxMove = (row: Bundle): Bundle[] => {
  let e = row.effect as Comp | undefined
  if (
    !e || e.handler != 'mail_inbox' || e.state != 'pending' ||
    e.kind != 'changed' || e.comp != 'archived' || e.attempts !== 0 ||
    typeof e.at != 'string' || e.at >= DEAD_MAIL_BEFORE ||
    ['lease_owner', 'lease_token', 'lease_expiry'].some((p) => e[p] != null)
  ) return []
  return [{
    entity: row.entity,
    effect: null,
    $was: {
      effect: Object.fromEntries([
        'handler',
        'state',
        'kind',
        'comp',
        'at',
        'attempts',
        'lease_owner',
        'lease_token',
        'lease_expiry',
      ].map((p) => [p, token(e[p] ?? null)])),
    },
  }]
}

/** Dead unhandled runs; the owner activates the app mover explicitly. */
export let deadMailInboxRule: Rule & { find: string } = {
  mark: 'yak/store/dead-mail-inbox/1',
  live: 'apps',
  find: deadMailFind + '&*',
  move: deadMailInboxMove,
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
 * became (c0ca24d4). A deploy refuses the hole (@yaks/tools/declared `parseTools`),
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
 * each was shown to a host as (@yaks/tools/declared `schemaOf` before T-38021) —
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
 * serve rows the build before it cannot read. One-time passes leave their names
 * after their rules are deleted. A retained capability such as app lenses also
 * names the first shape its rules can produce, even though only declaring apps
 * move. Code without the name is code from before it could read that shape. */
export let BOUNDARIES = [
  'yak/store/dead-mail-inbox/1',
  'yak/store/lens/1',
  'yak/store/lens-contract/1',
  'yak/store/lens-view/1',
  'yak/store/interruption-contract/1',
  'yak/store/interruption-contract/2',
  'yak/store/interruption-contract/3',
  'yak/store/interruption/1',
  'yak/store/interruption/2',
  'yak/store/interruption/3',
  'yak/store/interruption/4',
  'yak/store/builder-takes/18',
  'yak/store/builder-takes/19',
  'yak/store/refusal/1',
  'yak/store/refusal-imported/1',
  'yak/store/packages/1',
  'yak/store/home/2',
  'yak/store/former/3',
  'yak/store/serves/4',
  'yak/store/handle/5',
  'yak/store/filed/6',
  'yak/store/tool/7',
  'yak/store/args/11',
  'yak/store/for/12',
  'yak/store/build_of/13',
  'yak/store/output_of/14',
  'yak/store/vale-creature-prompt/16',
  'yak/store/vale-figure-prompt/17',
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

/** Keep request ids filed before exception's property took its wire name. */
export let requestIds = (d: Driver, vocab: Vocab) => {
  let cols = columns(d, 'exception')
  if (!cols.includes('requestId')) return
  if (!cols.includes('request_id')) {
    d.query({
      t: 'alter table',
      table: 'exception',
      rename: { column: 'requestId', to: 'request_id' },
    })
    return
  }
  d.query({
    t: 'update',
    table: 'exception',
    set: { request_id: col('requestId') },
    where: isNull(col('request_id')),
  })
  shed(d, vocab, vocab, 'exception', 'requestId')
}

/**
 * Every definition this object stands on, dropped: its views, its triggers and
 * its full-text indexes.
 *
 * They hold no rows of their own — a view is a query, a trigger is a rule, and
 * an external-content FTS5 index is an inverted copy of rows that live
 * somewhere else — and `create ... if not exists` says nothing about one that is
 * already standing. This is only for explicit column contraction: definitions
 * may still name the column being shed. Installation recreates the missing
 * definitions and refills affected indexes. Ordinary release fitting keeps
 * unchanged definitions. Dropping a virtual table takes its shadow tables.
 */
export let recut = (d: Driver) => {
  let drop = (kind: 'table' | 'index' | 'view' | 'trigger', name: string) =>
    d.query({ t: 'drop', kind, name, ifExists: true })
  for (let t of named(d, 'trigger')) drop('trigger', t.name)
  for (let v of named(d, 'view')) drop('view', v.name)
  for (let f of shadowed(d)) drop('table', f)
}

let sameIndex = (a: Index, b: Index) =>
  a.unique == b.unique &&
  a.props.join('\0') == b.props.join('\0') &&
  (a.present ?? []).join('\0') == (b.present ?? []).join('\0')

/** Retire indexes whose declaring vocabulary changed before raising the next
 * schema. A release candidate calls this inside a transaction it rolls back;
 * the serving store calls it when the directory selects that release. */
export let retire = (d: Driver, before: Vocab, after: Vocab) => {
  for (let comp of before.all) {
    let kept = after.indexes(comp)
    for (let old of before.indexes(comp)) {
      if (kept.some((now) => sameIndex(old, now))) continue
      d.query({
        t: 'drop',
        kind: 'index',
        name: `${comp}_${old.props.join('_')}`,
        ifExists: true,
      })
    }
  }
}

/**
 * A column its vocabulary stopped naming, dropped (vocab.ts `grew`). SQLite
 * refuses to drop a column an index, a trigger or a view names, so `recut()`
 * runs first and indexes no longer declared, changed, or naming the column go
 * with it. The vocabularies say which indexes remain; `install()` must not
 * mistake an unchanged unique constraint for a new one after this column is
 * shed.
 */
export let shed = (
  d: Driver,
  before: Vocab,
  after: Vocab,
  name: string,
  prop: string,
) => {
  if (!columns(d, name).includes(prop)) return
  recut(d)
  let indexes = d.query(catalogued(
    'index',
    and(eq(col('tbl_name'), val(name)), notNull(col('sql'))),
  ))
  let kept = new Set(
    before.indexes(name)
      .filter((old) =>
        ![...old.props, ...(old.present ?? [])].includes(prop) &&
        after.indexes(name).some((now) => sameIndex(old, now))
      )
      .map((i) => `${name}_${i.props.join('_')}`),
  )
  for (let i of indexes) {
    if (kept.has(String(i.name))) continue
    d.query({ t: 'drop', kind: 'index', name: String(i.name), ifExists: true })
  }
  d.query(unseat(name, prop))
}

/** The schema a vocabulary implies, raised over whatever the object holds.
 * Only the tables that stood before it can be behind their vocabulary
 * (@yaks/sqlite `fit`), so a fresh object is asked nothing about its columns,
 * keys or checks. What `fit` had to leave as it stood comes back, for the
 * caller to report. A unique index can be added while it has no complete keys
 * to index, even if its table has older rows. Otherwise existing rows need a
 * preparing migration, unless the same index stood before a rebuild. */
export let install = (
  d: Driver,
  vocab: Vocab,
  derived: Derived = {},
): Error[] => {
  let stood = new Set(named(d, 'index').map((i) => i.name))
  for (let stmt of retabled(d, vocab, derived)) d.query(stmt)
  let unfit = fit(d, vocab)
  for (let stmt of retired(d, vocab)) d.query(stmt)
  let held = new Set(named(d, 'index').map((i) => i.name))
  let ready = {
    ...vocab,
    indexes: (table: string) =>
      vocab.indexes(table).filter((i) => {
        let name = `${table}_${i.props.join('_')}`
        if (held.has(name)) return false
        if (stood.has(name) || !i.unique || !tally(d, table)) return true
        // Rows without a complete key occupy no slot in a unique index. A
        // newly added nullable property therefore leaves the index empty even
        // when its component already has rows.
        let key = [...i.props, ...(i.present ?? [])]
        if (!tally(d, table, and(...key.map((p) => notNull(col(p)))))) {
          return true
        }
        throw new Error(
          `skipped unique index ${name}: existing rows require a preparing migration`,
        )
      }),
  }
  for (let stmt of indexed(ready)) d.query(stmt)
  // Search is app composition, after all indexed columns have been raised:
  // the full-text indexes, and the table the vectors are kept in beside the
  // triggers that note which of them changed (@yaks/embedding). The triggers
  // that queue text to embed are the sweep's own (graph.ts `#embedding`).
  adopt(d, fields(vocab), derived, { heal: false })
  rekey(d)
  for (let stmt of vectorSchema()) d.query(stmt)
  if (vocab.comp('archetype')) {
    backfill(d, false)
  }
  // The physical schema stamp establishes the adapter's readiness. Mint
  // lineage on installation only; later reads can trust the stamp without
  // asking the adapter to inspect signatures or write missing metadata.
  if (!unfit.length && !epochAt(d)) epoch(d)
  return unfit
}

// A full-text index is several tables — the virtual one and its shadows — and
// the shadows are derived bytes nobody restores from. The virtual table's own
// name prefixes every one of them, which is how they are told apart.
let shadowed = (d: Driver): string[] =>
  named(d, 'table').filter((t) => /using\s+fts\d/i.test(t.sql)).map((t) =>
    t.name
  )

/** The interruption contract emptied these cells before making them computed. */
export let lifecycleColumns = (d: Driver, vocab: Vocab) => {
  for (let name of ['attempt', 'execution']) {
    if (
      !vocab.prop(name, 'state')?.computed ||
      !columns(d, name).includes('state')
    ) continue
    let [held] = d.query(
      select({
        cols: [lit(1)],
        from: table(name),
        where: notNull(col('state')),
        limit: lit(1),
      }),
    )
    if (held) throw new Error(`${name}.state contract has not completed`)
    shed(d, vocab, vocab, name, 'state')
  }
}
