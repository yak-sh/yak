// A prototype, not for landing: component rows kept as versions in their own
// tables, so a store has history, as-of reads and branches without a journal.
//
// A versioned table keeps every version of a component as a row keyed
// (entity, $branch, $to): the open version has `$to = 0`, a closed one the
// transaction that closed it, and every row the transaction that opened it in
// `$from`. The `$` names are the store's, as `$entity` already is, so no
// component property can take them. A store's transactions are rows of `tx`
// (at, by, via, branch).
//
// Nothing here changes how the rest of @yaks/sqlite writes: `versioned()`
// wraps the driver and rewrites each statement on its way to SQLite (an update
// archives the open row before changing it, a delete closes it), and `reads()`
// patches the SQLite dialect so every compiled read sees only the versions its
// mode asks for. Both are attached by hand for ./history_bench.ts; there is no
// plugin hook for either yet.
import { isRaw, raw, type Stmt } from '../sql/ast.ts'
import { sqlite } from '../sql/sqlite.ts'
import { render } from '../sql/render.ts'
import type { Driver, Row } from '@yaks/sql'

/** What a read sees: the open versions, the versions open at a transaction,
 * or a branch over its parent as of the fork. */
export type Mode =
  | { at?: undefined; branch?: undefined }
  | { at: number; branch?: undefined }
  | { branch: number; fork: number; at?: undefined }

let mode: Mode = {}

/** Let go of everything the store's memory holds (./memo.ts), whose keys know
 * nothing of modes. By default a no-op drop, which as DDL also ends the schema
 * revision; a caller with a second connection can commit there instead, which
 * moves only the `outside` revision, as any other writer's commit does. */
export let forgetting = {
  run: (d: Driver): void =>
    void d.query({
      t: 'drop',
      kind: 'view',
      name: '__history',
      ifExists: true,
    }),
}
export let forget = (d: Driver): void => forgetting.run(d)
let held: Driver | undefined

/** Run `f` with reads and writes in `m`, restoring the mode after it settles. */
export let within = async <R>(m: Mode, f: () => R | Promise<R>): Promise<R> => {
  let was = mode
  mode = m
  if (held) forget(held)
  try {
    return await f()
  } finally {
    mode = was
    if (held) forget(held)
  }
}

let q = (name: string) => `"${name.replaceAll('"', '""')}"`
let BR = '"$branch"', FROM = '"$from"', TO = '"$to"'
let TX = '(select max("id") from "tx")'
let OPEN = `${TO} = 0 and ${BR} = 0`

/** The rows of table `t` (read as `a`) the current mode sees. */
let visible = (t: string, a = t, m: Mode = mode): string => {
  let r = (c: string) => `${q(a)}.${c}`
  let at = (x: number) =>
    `${r(BR)} = 0 and coalesce(${r(FROM)}, 0) <= ${x}` +
    ` and (${r(TO)} = 0 or ${r(TO)} > ${x})`
  if (m.branch != null) {
    return `((${r(BR)} = ${m.branch} and ${r(TO)} = 0) or (${at(m.fork)}` +
      ` and not exists (select 1 from ${q(t)} as "__br" where` +
      ` "__br"."entity" = ${r('"entity"')} and "__br".${BR} = ${m.branch}` +
      ` and "__br".${TO} = 0)))`
  }
  if (m.at != null) return `(${at(m.at)})`
  return `(${r(TO)} = 0 and ${r(BR)} = 0)`
}

let derived = (t: string, hint = '') =>
  `(select * from ${q(t)}${hint} where ${visible(t)})`

// The SQLite dialect's table sources, as the binder asks for them.
let base = {
  table: sqlite.table,
  source: sqlite.source,
  indexed: sqlite.indexed,
  owned: sqlite.owned,
}

/** Make every compiled read of a table in `tables` see only the versions the
 * mode asks for, or undo that with `undefined`. */
export let reads = (tables: Set<string> | undefined): void => {
  if (!tables) return void Object.assign(sqlite, base)
  Object.assign(sqlite, {
    table: (c: string) =>
      tables.has(c) ? `${derived(c)} as ${q(c)}` : base.table(c),
    source: (c: string) =>
      tables.has(c) ? derived(c) : base.source?.(c) ?? q(c),
    indexed: (c: string, i: string) =>
      tables.has(c)
        ? `${derived(c, ` indexed by ${q(i)}`)} as ${q(c)}`
        : base.indexed!(c, i),
    owned: (c: string) =>
      tables.has(c)
        ? `${derived(c, ' not indexed')} as ${q(c)}`
        : base.owned!(c),
  })
}

// Every `{t: 'table'}` source naming a versioned table, anywhere in a
// statement, becomes the derived table of its visible rows.
// A statement this package already rendered keeps the tree it came from
// (`origin`), which is rewritten and rendered again when it names one.
let plain = (x: object) => Object.getPrototypeOf(x) === Object.prototype
let named = new WeakMap<Set<string>, RegExp>()
let mentions = (sql: string, tables: Set<string>) => {
  let re = named.get(tables)
  if (!re) {
    let alt = [...tables].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    named.set(tables, re = new RegExp(`"(${alt.join('|')})"`))
  }
  return re.test(sql)
}
let sources = (x: unknown, tables: Set<string>): unknown => {
  if (Array.isArray(x)) return x.map((y) => sources(y, tables))
  if (isRaw(x)) {
    if (!x.origin || !mentions(x.sql, tables)) return x
    // The origin's values are placeholders; the derived tables bind nothing,
    // so the rendered statement's own parameters still line up.
    return raw(render(sources(x.origin, tables) as Stmt).sql, x.params)
  }
  if (!x || typeof x != 'object' || !plain(x)) return x
  let n = x as Record<string | symbol, unknown>
  if (n.t == 'val') return x
  if (n.t == 'table' && typeof n.name == 'string' && tables.has(n.name)) {
    let hint = n.indexed === false
      ? ' not indexed'
      : typeof n.indexed == 'string'
      ? ` indexed by ${q(n.indexed)}`
      : ''
    return raw(`${derived(n.name, hint)} as ${q(String(n.as ?? n.name))}`)
  }
  let out: Record<string | symbol, unknown> = {}
  for (let k of Reflect.ownKeys(n)) out[k] = sources(n[k], tables)
  return out
}

/** Who the next transaction row names, set by the caller before an apply. */
export let actor: { by?: number; via?: number } = {}

// One expression as text: a select around it, the condition cut back out.
let rendered = (w: unknown): { sql: string; params: never[] } => {
  let s = render({ t: 'select', cols: [raw('1')], where: w } as Stmt)
  let at = s.sql.search(/\swhere\s/i)
  return {
    sql: s.sql.slice(at).replace(/^\swhere\s/i, ''),
    params: s.params as never[],
  }
}

/**
 * Over a store whose `history_tables` lists versioned tables, make each
 * statement that changes one of them change versions instead of rows. Changes
 * `d.query` in place, so every holder of the driver goes through it.
 */
export let versioned = (d: Driver): { tables: Set<string> } => {
  let native = d.query.bind(d)
  // HISTORY_SLOW=<ms> reports each statement slower than that, as SQLite ran it.
  let slow = Number(Deno.env.get('HISTORY_SLOW') ?? 0)
  let inner = !slow ? native : (s: Stmt): Row[] => {
    let t = performance.now()
    let rows = native(s)
    let ms = performance.now() - t
    if (ms > slow) {
      console.error(`SLOW ${ms.toFixed(1)}ms ${render(s).sql}`)
    }
    return rows
  }
  let run = (sql: string, params: unknown[] = []) =>
    inner(raw(sql, params as never[]))
  let names = run(
      `select "name" from "sqlite_master" where "type" = 'table'` +
        ` and "name" = 'history_tables'`,
    ).length
    ? run('select "name" from "history_tables"').map((r) => String(r.name))
    : []
  let tables = new Set(names)
  let cols = new Map(names.map((t) => [
    t,
    run(`select "name" from pragma_table_info(?)`, [t])
      .map((r) => String(r.name))
      .filter((c) => !c.startsWith('$') || c == '$entity'),
  ]))
  let opened = false
  // The transaction row, written by the first versioned write of a unit.
  let begin = () => {
    if (opened) return
    opened = true
    run(`insert into "tx" ("at", "by", "via", "branch") values (?, ?, ?, ?)`, [
      new Date().toISOString(),
      actor.by ?? null,
      actor.via ?? null,
      mode.branch ?? 0,
    ])
  }
  let cond = (s: { where?: unknown }) =>
    rendered(s.where ? sources(s.where, tables) : raw('1'))
  let writes = () => {
    if (mode.at != null) throw new Error('an as-of read cannot write')
    begin()
  }
  let query = (s: Stmt): Row[] => {
    let t = (s as { t: string }).t
    let name = (s as { name?: string }).name
    if (
      t == 'begin' || t == 'commit' || t == 'rollback' ||
      (t == 'savepoint' || t == 'release') && name == 'yaks_tx_0'
    ) opened = false
    if (t == 'insert') {
      let i = s as Extract<Stmt, { t: 'insert' }>
      if (!tables.has(i.into)) return inner(sources(s, tables) as Stmt)
      writes()
      let extra = [raw(String(mode.branch ?? 0)), raw(TX)]
      return inner({
        ...i,
        cols: [...i.cols ?? [], '$branch', '$from'],
        q: i.q
          ? sources({
            ...i.q,
            cols: [...(i.q as { cols?: unknown[] }).cols ?? [], ...extra],
          }, tables)
          : undefined,
        rows: i.rows?.map((r) => [...r, ...extra]),
        upsert: i.upsert?.map((u) => ({
          ...u,
          on: [raw('"entity"'), raw(BR), raw(TO)],
          set: u.set ? { ...u.set, $from: raw(`"excluded".${FROM}`) } : u.set,
        })),
      } as Stmt)
    }
    if (t == 'update') {
      let u = s as Extract<Stmt, { t: 'update' }>
      if (!tables.has(u.table)) return inner(sources(s, tables) as Stmt)
      writes()
      let w = cond(u)
      let list = cols.get(u.table)!.map(q).join(', ')
      let into = `insert or ignore into ${
        q(u.table)
      } (${list}, ${BR}, ${FROM}, ${TO})`
      if (mode.branch != null) {
        // Copy-on-write: the parent's row as of the fork becomes the branch's
        // own open row, which the update then changes.
        run(
          `${into} select ${list}, ${mode.branch}, ${TX}, 0 from ${
            q(u.table)
          }` +
            ` where (${w.sql}) and ${visible(u.table)} and ${BR} = 0`,
          w.params,
        )
        return inner({
          ...u,
          where: raw(
            `(${w.sql}) and ${BR} = ${mode.branch} and ${TO} = 0`,
            w.params,
          ),
        } as Stmt)
      }
      // Archive the open row as a closed version, unless this transaction
      // opened it, then change the open row in place.
      run(
        `${into} select ${list}, 0, ${FROM}, ${TX} from ${q(u.table)}` +
          ` where (${w.sql}) and ${OPEN} and coalesce(${FROM}, -1) <> ${TX}`,
        w.params,
      )
      return inner({
        ...u,
        set: { ...u.set, $from: raw(TX) },
        where: raw(`(${w.sql}) and ${OPEN}`, w.params),
      } as Stmt)
    }
    if (t == 'delete') {
      let x = s as Extract<Stmt, { t: 'delete' }>
      if (!tables.has(x.from)) return inner(sources(s, tables) as Stmt)
      if (mode.branch != null) {
        throw new Error('the prototype deletes on main only')
      }
      writes()
      let w = cond(x)
      // A version this transaction opened never existed for anyone else.
      let gone = inner({
        t: 'delete',
        from: x.from,
        where: raw(`(${w.sql}) and ${OPEN} and ${FROM} = ${TX}`, w.params),
        returning: x.returning,
      } as Stmt)
      let closed = inner({
        t: 'update',
        table: x.from,
        set: { $to: raw(TX) },
        where: raw(`(${w.sql}) and ${OPEN}`, w.params),
        returning: x.returning,
      } as Stmt)
      return [...gone, ...closed]
    }
    let o = t == 'raw'
      ? (s as {
        origin?: { t: string; into?: string; table?: string; from?: unknown }
      }).origin
      : undefined
    if (
      o && (o.t == 'insert' && tables.has(o.into!) ||
        o.t == 'update' && tables.has(o.table!) ||
        o.t == 'delete' && typeof o.from == 'string' && tables.has(o.from))
    ) throw new Error(`the prototype cannot version a rendered ${o.t}`)
    if (t == 'select' || t == 'compound' || t == 'values' || t == 'raw') {
      return inner(sources(s, tables) as Stmt)
    }
    return inner(s)
  }
  d.query = query
  held = d
  return { tables }
}

/** Start a branch of main at the newest transaction. */
export let branch = (d: Driver): { branch: number; fork: number } => {
  let [r] = d.query(raw(
    `insert into "branch" ("parent", "fork", "at") values (0, ${TX}, ?)` +
      ` returning "id", "fork"`,
    [new Date().toISOString()],
  ))
  return { branch: Number(r.id), fork: Number(r.fork) }
}

/** The newest transaction's id. */
export let tip = (d: Driver): number =>
  Number(d.query(raw(`select ${TX} as "id"`))[0].id)
