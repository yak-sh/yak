// sqlite-vector's quantized index over the stored vectors: which few hundred
// are worth scoring exactly. Every vector is kept as 2-bit TurboQuant codes,
// held in memory per connection; one scan of the codes names the nearest
// candidates, and ./near.ts scores those by cosine over their full vectors. A
// scan of the codes is a fraction of a scan of the vectors, and the exact
// score puts the candidates back in the order the full scan would have. The
// answer is the exact one wherever the true nearest are among the candidates,
// which is what {@link pool} is sized for (on the live graph, the top 4, 9 and
// 21 of 60 queries each matched the exact ranking).
//
// Filter, then rank. A query that also filters (`.near=x .task`) passes its
// screen, and the candidates are the nearest codes the screen admits: the scan
// runs wider and each candidate is tested against the screen, a primary-key
// read, until the pool is full or the whole index has been read.
//
// Built, not maintained: `vector_quantize` rebuilds the whole index, a few
// seconds under the write lock, so it is not done per write. The process that
// runs the sweep builds it ({@link build}, from ./service.ts) once enough
// vectors have changed. Between builds, every vector written or deleted since
// is in the dirty set (./ddl.ts), and a search scores those beside the
// candidates, so a stale build costs a search time, never an answer.
//
// Each connection keeps its own copy of the codes: sqlite-vector's metadata
// and preloaded data live on the connection that loaded them. A connection
// notices a newer build by its number and loads it again. The quantizer is
// TurboQuant because its codebook depends only on the dimension and the bit
// width, never on the data, so a connection initialized before a build reads
// that build's codes correctly.
//
// Loading the extension creates its metadata table, so a database uses the
// index only once it has been installed explicitly ({@link install}).

import {
  as,
  at,
  call,
  col,
  count,
  type Driver,
  eq,
  exists,
  type Expr,
  fn,
  from,
  lit,
  op,
  type Raw,
  select,
  table,
  val,
} from '@yaks/sql'
import { BUILD, DIRTY, TABLE } from './ddl.ts'
import { pack } from './vector.ts'

let binary = (): string | null => {
  let names: Record<string, string> = {
    'linux-x86_64': '@sqlite-vector-linux-x86_64',
    'linux-aarch64': '@sqlite-vector-linux-aarch64',
    'darwin-x86_64': '@sqlite-vector-darwin-x86_64',
    'darwin-aarch64': '@sqlite-vector-darwin-aarch64',
    'windows-x86_64': '@sqlite-vector-windows-x86_64',
  }
  let name = names[`${Deno.build.os}-${Deno.build.arch}`]
  if (!name) return null
  let ext = Deno.build.os == 'windows'
    ? 'dll'
    : Deno.build.os == 'darwin'
    ? 'dylib'
    : 'so'
  return new URL(`./vector.${ext}`, import.meta.resolve(name)).pathname
}

/** Explicit one-time installation: back up the database before calling this
 * on a file. Loading the extension adds its metadata table to the database. */
export let install = (db: Driver): void => {
  if (!db.extension) throw new Error('SQL driver cannot load sqlite-vector')
  let path = binary()
  if (!path) throw new Error('sqlite-vector has no binary for this platform')
  db.extension(path)
}

/** The quantization: 2-bit TurboQuant codes. */
export let QTYPE = 'TURBO2'

/** How many vectors may change before the sweep's process builds again. Each
 * is scored exactly by every search until then. */
export let REBUILD = 1024

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

/** The current build, as any connection reads it. */
export let current = (db: Driver): Build => {
  let row = db.query(select({ from: table(BUILD) }))[0] ?? {}
  return {
    n: Number(row.n ?? 0),
    model: (row.model as string | null) ?? null,
    dim: Number(row.dim ?? 0),
    rows: Number(row.rows ?? 0),
  }
}

let tally = (db: Driver, name: string): number =>
  Number(db.query(select({ cols: [as(count(), 'n')], from: table(name) }))[0].n)

let installed = (db: Driver): boolean =>
  !!db.query(select({
    cols: [col('name')],
    from: table('sqlite_master'),
    where: eq(col('name'), val('_sqliteai_vector')),
  }))[0]

// The one model every stored vector is under, or null while two spaces share
// the table: an index over both would rank vectors of different lengths.
let only = (db: Driver): string | null => {
  let row = db.query(select({
    cols: [
      as(fn('min', col('model')), 'lo'),
      as(fn('max', col('model')), 'hi'),
    ],
    from: table(TABLE),
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

/** The index's state. */
export let state = (db: Driver): State => ({
  installed: installed(db),
  build: current(db),
  model: only(db),
  dirty: tally(db, DIRTY),
})

/** Whether the index is behind the vectors and wants a build: installed, one
 * model under every vector, and never built, built from another model, or
 * {@link REBUILD} vectors changed since. */
export let behind = (s: State): boolean =>
  s.installed && !!s.model &&
  (!s.build.n || s.build.model != s.model || s.dirty >= REBUILD)

// What one connection has done with the extension: loaded it, initialized
// the table at a dimension, and loaded a build's codes into memory.
type Conn = { dim: number; n: number }
let conns = new WeakMap<Driver, Conn>()

// This connection's state, loading the extension the first time, or null
// where it cannot: a driver with no extensions, no binary for this platform,
// or a database it was never installed on.
let conn = (db: Driver): Conn | null => {
  let had = conns.get(db)
  if (had) return had
  if (!db.extension || !binary() || !installed(db)) return null
  install(db)
  let made = { dim: 0, n: 0 }
  conns.set(db, made)
  return made
}

let ask = (db: Driver, name: string, ...args: (string | number)[]) =>
  db.query(select({
    cols: [as(fn(name, lit(TABLE), lit('vec'), ...args.map(lit)), 'out')],
  }))[0]?.out

// The table set up on this connection at a dimension, once: sqlite-vector
// reads its metadata then, and a connection cannot take a second dimension.
let init = (db: Driver, c: Conn, dim: number): boolean => {
  if (!c.dim) {
    ask(
      db,
      'vector_init',
      `type=FLOAT32,dimension=${dim},distance=COSINE,qtype=${QTYPE}`,
    )
    c.dim = dim
  }
  return c.dim == dim
}

/**
 * Build the index again if it is {@link behind}. The codes, the cleared
 * dirty set and the new build number commit together, under the write lock,
 * so no vector is written between the codes being made and the set being
 * cleared. Only the process that runs the sweep calls this; returns whether
 * it built.
 */
export let build = (db: Driver): boolean => {
  let c = conn(db)
  let now = c && state(db)
  if (!c || !now || !behind(now)) return false
  let [row] = db.query(select({
    cols: [as(fn('length', col('vec')), 'bytes')],
    from: table(TABLE),
    limit: lit(1),
  }))
  let dim = Number(row.bytes) / 4
  if (!init(db, c, dim)) return false
  db.query({ t: 'begin', mode: 'immediate' })
  try {
    let rows = Number(ask(db, 'vector_quantize', `qtype=${QTYPE}`))
    db.query({ t: 'delete', from: DIRTY })
    db.query({
      t: 'update',
      table: BUILD,
      set: {
        n: op('+', col('n'), lit(1)),
        model: val(now.model),
        dim: lit(dim),
        rows: lit(rows),
      },
    })
    db.query({ t: 'commit' })
  } catch (e) {
    db.query({ t: 'rollback' })
    // What this connection had loaded may be ahead of the table now.
    c.n = 0
    throw e
  }
  // A connection that had loaded codes has them reloaded by the build.
  if (c.n) c.n = current(db).n
  return true
}

// Whether a candidate is one the screen admits: a primary-key read of its row,
// never the whole screen made first.
let admitted = (within: Raw, owner: Expr) =>
  exists(select({
    cols: [lit(1)],
    from: from(within, 's'),
    where: eq(col('id', 's'), owner),
  }))

/** How many entities a screen may admit and still be read whole: its vectors
 * cost less to score than to find among every code in the index. */
export let FEW = 5000

// Whether the screen admits at most FEW entities, counting no further.
let few = (db: Driver, within: Raw): boolean =>
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

/**
 * The owners worth scoring exactly for the `need` nearest to `query`: the
 * index's nearest {@link pool} among what `within` admits, and every vector
 * written since the build. Null where every vector `within` admits is to be
 * scored: the index cannot say (not installed, not built, built from another
 * model or dimension), or the screen admits {@link FEW} enough to read whole.
 */
export let candidates = (
  db: Driver,
  query: Float32Array,
  opts: { model: string; need: number; within?: Raw },
): number[] | null => {
  let c = conn(db)
  if (!c || (opts.within && few(db, opts.within))) return null
  let now = current(db)
  if (!now.n || now.model != opts.model || now.dim != query.length) return null
  if (!init(db, c, now.dim)) return null
  if (c.n != now.n) {
    ask(db, 'vector_quantize_preload')
    c.n = now.n
  }
  let size = pool(opts.need)
  let v = (name: string) => col(name, 'v')
  let scan = (k: number) =>
    db.query(select({
      cols: [as(v('id'), 'owner')],
      from: call('vector_quantize_scan', [
        lit(TABLE),
        lit('vec'),
        val(pack(query)),
        val(k),
      ], 'v'),
      where: opts.within ? admitted(opts.within, v('id')) : undefined,
      limit: val(size),
    })).map((r) => Number(r.owner))
  // Unscreened, the nearest `size` codes are the pool. Screened, the scan
  // reads further, and again further by how thinly the screen admitted, until
  // the pool is full or nothing is left unread.
  let k = opts.within ? size * 32 : size
  let owners = scan(k)
  while (owners.length < size && k < now.rows) {
    k = Math.min(
      now.rows,
      Math.ceil(k * size / Math.max(owners.length, 1) * 1.5),
    )
    owners = scan(k)
  }
  let d = at(DIRTY)
  let fresh = db.query(select({
    cols: [as(d('entity'), 'owner')],
    from: table(DIRTY),
    where: opts.within ? admitted(opts.within, d('entity')) : undefined,
  })).map((r) => Number(r.owner))
  return [...new Set([...owners, ...fresh])]
}
