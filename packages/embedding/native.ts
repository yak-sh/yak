// Exact sqlite-vector scans over stored vectors, or over their int8 codes once
// every vector has them (./coded.ts), the pool then scored from the floats
// (./near.ts). Native distance work stays inside the engine; no derived index
// is rebuilt under the graph lock.
import {
  and,
  as,
  call,
  col,
  count,
  eq,
  exists,
  fn,
  from,
  lit,
  member,
  not,
  type Raw,
  select,
  type Statements,
  sub,
  table,
  val,
} from '@yaks/sql'
import { BUILD, CODE, DIRTY, TABLE } from './ddl.ts'
import { coded, pack } from './vector.ts'
import { complete } from './coded.ts'
import { sparse } from './sparse.ts'

/** Explicit one-time installation: back up the database before calling this
 * on shared storage. The adapter loads its vector facility, which adds the
 * extension's metadata table to the database. */
export let install = (db: Statements): void => {
  if (!db.facilities?.vector) {
    throw new Error('sqlite-vector extension is unavailable on this storage')
  }
  db.facilities.vector()
}

/** How many candidates a search scores exactly, for the `need` nearest. */
export let pool = (need: number): number => Math.max(128, 32 * need)

/** Which build of the index is current: its number (0 before the first), and
 * the model, dimension and count of the vectors it was built from. */
export type Build = {
  n: number
  model: string | null
  dim: number
  rows: number
}

/** Shared generation metadata, as any connection reads it. */
export let current = (db: Statements): Build => {
  let row = db.query(select({ from: table(BUILD) }))[0] ?? {}
  return {
    n: Number(row.n ?? 0),
    model: (row.model as string | null) ?? null,
    dim: Number(row.dim ?? 0),
    rows: Number(row.rows ?? 0),
  }
}

let tally = (db: Statements, name: string): number =>
  Number(db.query(select({ cols: [as(count(), 'n')], from: table(name) }))[0].n)

/** Whether sqlite-vector metadata already exists on this database. */
let installations = new WeakMap<
  Statements,
  { version: number; installed: boolean }
>()

export let installed = (db: Statements): boolean => {
  let version = db.revision('schema')
  let kept = installations.get(db)
  if (kept?.version == version) return kept.installed
  let found = !!db.query(select({
    cols: [col('name')],
    from: table('sqlite_master'),
    where: eq(col('name'), val('_sqliteai_vector')),
  }))[0]
  installations.set(db, { version, installed: found })
  return found
}

// One model means one vector width. Mixed spaces use the ordinary reader.
// Separate aggregates each seek an edge of the model index. Together SQLite
// scans every model, even when the answer has not changed.
let only = (db: Statements): string | null => {
  let edge = (f: string) =>
    sub(select({ cols: [fn(f, col('model'))], from: table(TABLE) }))
  let row = db.query(select({
    cols: [as(edge('min'), 'lo'), as(edge('max'), 'hi')],
  }))[0]
  return row?.lo != null && row.lo == row.hi ? String(row.lo) : null
}

/** What a health check reads, from plain tables any connection can read. */
export type State = {
  /** whether sqlite-vector was installed on this database */
  installed: boolean
  build: Build
  /** the model every vector is under, or null while there are two (or none) */
  model: string | null
  /** how many vectors changed since the build */
  dirty: number
}

/** Vector space and generation metadata for diagnostics. */
export let state = (db: Statements): State => ({
  installed: installed(db),
  build: current(db),
  model: only(db),
  dirty: db.ownership == 'exclusive' ? tally(db, DIRTY) : 0,
})

// The shapes registered on one connection: the floats', and the codes'.
type Conn = { dim: number; codes: number }
let conns = new WeakMap<Statements, Conn>()

// This connection's state, loading the extension the first time, or null
// where it cannot: statements with no vector facility, or a database it was
// never installed on.
let conn = (db: Statements): Conn | null => {
  let had = conns.get(db)
  if (had) return had
  if (!db.facilities?.vector || !installed(db)) return null
  install(db)
  let made = { dim: 0, codes: 0 }
  conns.set(db, made)
  return made
}

let ask = (
  db: Statements,
  name: string,
  ...args: (string | number)[]
) =>
  db.query(select({
    cols: [as(fn(name, ...args.map(lit)), 'out')],
  }))[0]?.out

// The table set up on this connection at a dimension, once: sqlite-vector
// reads its metadata then, and a connection cannot take a second dimension.
let init = (db: Statements, c: Conn, dim: number): boolean => {
  if (!c.dim) {
    ask(
      db,
      'vector_init',
      TABLE,
      'vec',
      `type=FLOAT32,dimension=${dim},distance=COSINE`,
    )
    c.dim = dim
  }
  return c.dim == dim
}

// The codes' table set up the same way, at the floats' dimension.
let initCodes = (db: Statements, c: Conn, dim: number): boolean => {
  if (!c.codes) {
    ask(
      db,
      'vector_init',
      CODE,
      'code',
      `type=INT8,dimension=${dim},distance=COSINE`,
    )
    c.codes = dim
  }
  return c.codes == dim
}

/** Register the vector shape once, before read-only connections use it. */
export let prepare = (db: Statements, dim?: number): boolean => {
  let c = conn(db)
  if (!c || c.dim) return false
  if (dim == null) {
    let [row] = db.query(select({
      cols: [as(fn('length', col('vec')), 'bytes')],
      from: table(TABLE),
      limit: lit(1),
    }))
    dim = Number(row?.bytes ?? 0) / 4
  }
  return !!dim && init(db, c, dim)
}

/** Whether this owner is admitted by the selection's keyed predicate. */
export let admitted = member

/** How many entities a screen may admit and still be read whole, rather than
 * scanning the whole corpus. */
export let FEW = 5000

// Whether a bounded screen is small absolutely or relative to the corpus.
let few = (db: Statements, within: Raw): boolean => {
  // A sparse screen stays cheaper than reading unrelated vector payloads,
  // even when the matching set has outgrown the small-corpus threshold.
  let limit = Math.max(FEW, Math.floor(tally(db, TABLE) / 8))
  return Number(
    db.query(select({
      cols: [as(count(), 'n')],
      from: from(
        select({
          cols: [lit(1)],
          from: from(within, 's'),
          limit: lit(limit + 1),
        }),
        'f',
      ),
    }))[0].n,
  ) <= limit
}

/** How many more of the nearest a native search draws when a screen is asked
 * of them: about one in eight of the drawn has to be admitted. */
export let WIDEN = 8

/** Native candidates: the nearest pool the screen admits, by the floats or by
 * the codes, which the floats then rank. Small screens rank only admitted
 * codes, or read their floats when the codes are incomplete. */
export let candidates = (
  db: Statements,
  query: Float32Array,
  opts: { model: string; need: number; within?: Raw },
): number[] | null => {
  let c = conn(db)
  if (!c) return null
  if (only(db) != opts.model || !init(db, c, query.length)) return null
  let codes = complete(db) && initCodes(db, c, query.length)
  if (opts.within && few(db, opts.within)) {
    return codes ? sparse(db, query, opts.within, pool(opts.need)) : null
  }
  // The codes, where every vector has them: a fifth of the bytes to read.
  let [name, column, probe] = codes
    ? [CODE, 'code', coded(query)]
    : [TABLE, 'vec', pack(query)]
  let v = (name: string) => col(name, 'v')
  let r = (name: string) => col(name, 'r')
  let nearest = (draw: number) =>
    select({
      cols: [as(v('id'), 'owner'), as(v('distance'), 'distance')],
      from: call('vector_full_scan', [lit(name), lit(column), val(probe)], 'v'),
      order: [v('distance'), v('id')],
      limit: val(draw),
    })
  let alive = not(exists(select({
    cols: [lit(1)],
    from: table('tombstone', 't'),
    where: eq(col('entity', 't'), r('owner')),
  })))
  // The screen and the tombstones are probed after the scan's cut, on the
  // nearest few hundred rather than on every stored vector: a screen asked of
  // each of 310k vectors spent 2.7 s on a CPU and 7.6 s reading the pages its
  // probes touched. Filtering keeps the scan's order, so the first `cut`
  // admitted are the screened scan's own. Too few admitted (a thin screen, a
  // deleted neighbour) draws WIDEN times as many, up to the whole corpus.
  let cut = pool(opts.need)
  let corpus = tally(db, TABLE)
  for (let draw = opts.within ? cut * WIDEN : cut;; draw *= WIDEN) {
    let rows = db.query(select({
      cols: [r('owner')],
      from: from(nearest(Math.min(draw, corpus)), 'r'),
      where: and(
        alive,
        ...opts.within ? [admitted(opts.within, r('owner'))] : [],
      ),
      order: [r('distance'), r('owner')],
      limit: val(cut),
    }))
    if (rows.length == cut || draw >= corpus) {
      return rows.map((row) => Number(row.owner))
    }
  }
}
