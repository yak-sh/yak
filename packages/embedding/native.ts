// Exact sqlite-vector scans over canonical vectors. Native distance work
// stays inside the engine; no derived index is rebuilt under the graph lock.
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
import { BUILD, DIRTY, TABLE } from './ddl.ts'
import { pack } from './vector.ts'

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

// The shape registered on one connection.
type Conn = { dim: number }
let conns = new WeakMap<Statements, Conn>()

// This connection's state, loading the extension the first time, or null
// where it cannot: statements with no vector facility, or a database it was
// never installed on.
let conn = (db: Statements): Conn | null => {
  let had = conns.get(db)
  if (had) return had
  if (!db.facilities?.vector || !installed(db)) return null
  install(db)
  let made = { dim: 0 }
  conns.set(db, made)
  return made
}

let ask = (db: Statements, name: string, ...args: (string | number)[]) =>
  db.query(select({
    cols: [as(fn(name, lit(TABLE), lit('vec'), ...args.map(lit)), 'out')],
  }))[0]?.out

// The table set up on this connection at a dimension, once: sqlite-vector
// reads its metadata then, and a connection cannot take a second dimension.
let init = (db: Statements, c: Conn, dim: number): boolean => {
  if (!c.dim) {
    ask(
      db,
      'vector_init',
      `type=FLOAT32,dimension=${dim},distance=COSINE`,
    )
    c.dim = dim
  }
  return c.dim == dim
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

/** How many entities a screen may admit and still be read whole: its vectors
 * cost less to score directly than to scan the whole corpus. */
export let FEW = 5000

// Whether the screen admits at most FEW entities, counting no further.
let few = (db: Statements, within: Raw): boolean =>
  Number(
    db.query(select({
      cols: [as(count(), 'n')],
      from: from(
        select({
          cols: [lit(1)],
          from: from(within, 's'),
          limit: lit(FEW + 1),
        }),
        'f',
      ),
    }))[0].n,
  ) <= FEW

/** Exact native candidates, screened before the result is limited. Small
 * screens use the ordinary vector reader to avoid scanning the whole corpus. */
export let candidates = (
  db: Statements,
  query: Float32Array,
  opts: { model: string; need: number; within?: Raw },
): number[] | null => {
  let c = conn(db)
  if (!c || (opts.within && few(db, opts.within))) return null
  if (only(db) != opts.model || !init(db, c, query.length)) return null
  let v = (name: string) => col(name, 'v')
  return db.query(select({
    cols: [as(v('id'), 'owner')],
    from: call('vector_full_scan', [
      lit(TABLE),
      lit('vec'),
      val(pack(query)),
    ], 'v'),
    where: and(
      not(exists(select({
        cols: [lit(1)],
        from: table('tombstone', 't'),
        where: eq(col('entity', 't'), v('id')),
      }))),
      ...opts.within ? [admitted(opts.within, v('id'))] : [],
    ),
    order: [v('distance'), v('id')],
    limit: val(pool(opts.need)),
  })).map((r) => Number(r.owner))
}
