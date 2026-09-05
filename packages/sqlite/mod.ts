// @yaks/sqlite — a storage adapter that turns the yaks query/vocabulary/SQL
// stack into a working SQLite-backed store. It composes three sibling packages:
//
//   @yaks/query   parses a query string into an AST
//   @yaks/vocab   describes a component vocabulary and interrogates it
//   @yaks/sql     compiles an AST + a vocabulary into SQL + bound params
//
// and adds the two halves those packages leave to a backend: DDL (the schema a
// vocabulary implies) and WRITES (a patch applied to that schema). The reads it
// gets for free — it runs @yaks/sql's compiled statement and gathers the rows.
//
// The model is the yaks entity graph: everything is an ENTITY (a string id)
// wearing COMPONENTS (a row per component table). An entity is what its
// components make it — a blog post is a `doc` plus a `post`; a product is a
// `doc` plus a `price`. A component adds a facet; the set of components an
// entity carries is its identity. A read hands back a BUNDLE (an entity with
// its components gathered); a write takes a batch of bundles and PATCHES them
// in — omitted columns untouched, a null column cleared, a null component
// dropped.
//
// It implements @yaks/graph's `Storage`, which is where the seam is drawn:
// this package owns the BYTES (schema, rows, identity, transactions) and
// @yaks/graph owns the DECISIONS (admission, preconditions, which entities a
// delete takes with it, provenance). Point `graph()` at a store from here and
// the two halves are the whole thing.
//
// The adapter is bound to a driver and a vocabulary once, by `storage()`, and
// speaks bundles from then on. The driver is any object with `query`/`exec`
// (see ./driver.ts) — an in-process SQLite for a test, a pooled handle for a
// server — so nothing here names a concrete SQLite library.

import type { Vocab } from '@yaks/vocab'
import type { BindOpts } from '@yaks/sql'
import type { Bundle, Entity, ReadOpts } from '@yaks/graph'
import type { Driver, Row } from './driver.ts'
import type { Query } from './read.ts'
import { schema } from './ddl.ts'
import { get, read, rows } from './read.ts'
import { patch, remove } from './write.ts'

export * from './driver.ts'
export * from './bundle.ts'
export { schema } from './ddl.ts'
export { compSql, get, type Query, read, rows } from './read.ts'
export { buried, patch, remove } from './write.ts'
export type { Storage } from '@yaks/graph'

/**
 * A transaction over an embedded database: the same shape @yaks/graph's `Tx`
 * has, with every answer immediate. Naming the synchronous form is what lets
 * `apply()` stay synchronous over SQLite — and lets a caller of this package
 * read a bundle without awaiting one.
 */
export type Tx = {
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** identity, not search: these entities as they stand, whole */
  get: (eids: string[]) => Bundle[]
  /** patch the bundles in → the entities this patch minted */
  patch: (bundles: Bundle[]) => Entity[]
  /** remove these entities: rows gone, identity tombstoned */
  remove: (entities: Entity[]) => void
}

/**
 * A bound store: @yaks/graph's {@link Storage}, answered synchronously. It is
 * the same five members, each narrowed to what an embedded database can
 * promise — so it satisfies `Storage` wherever one is wanted, and a caller
 * holding a `Store` directly never has to await a row.
 */
// A read here takes the compiler's whole options, not just @yaks/graph's
// `ReadOpts`: a caller of this package may hand a query a derived-column
// registry or an @yaks/sql EXTENSION — the seam @yaks/fts and @yaks/embedding
// register through — and it would be unreachable if the door only took `now`.
// `ReadOpts` is assignable to `BindOpts`, so the wider door still satisfies
// `Storage` wherever the generic contract is what is wanted.
export type Store = {
  /** the schema statements the bound vocabulary implies */
  ddl: () => string[]
  /** run them — create the tables and indexes the vocabulary needs */
  install: () => void
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: BindOpts) => Bundle[]
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: BindOpts) => Row[]
  /** run `body` in a transaction: commit on return, roll back on throw */
  tx: <R>(body: (tx: Tx) => R) => R
}

// SQLite has one transaction per connection, so nesting is done with
// SAVEPOINTs: a store used inside a transaction the host already opened (an
// application's own, or another store's) still gets its own all-or-nothing
// unit. The counter names each one uniquely — it only ever goes up, so an
// outer savepoint can never be released by an inner one's name.
let seq = 0

// One all-or-nothing unit of work. A driver that owns its own transactions
// (see `Driver.tx`) is asked for one; otherwise it is a SAVEPOINT in plain
// SQL. An async body is settled before the savepoint closes, so a batch that
// went async is still rolled back by a rejection.
let unit = <R>(driver: Driver, body: () => R): R => {
  if (driver.tx) return driver.tx(body)
  let name = `yaks_tx_${seq++}`
  driver.exec(`savepoint ${name}`)
  let undo = (e: unknown): never => {
    driver.exec(`rollback to ${name}`)
    driver.exec(`release ${name}`)
    throw e
  }
  let done = <T>(out: T): T => {
    driver.exec(`release ${name}`)
    return out
  }
  try {
    let out = body()
    return (out instanceof Promise ? out.then(done, undo) : done(out)) as R
  } catch (e) {
    return undo(e)
  }
}

/**
 * Bind a store to a driver and a vocabulary — a {@link Storage} @yaks/graph
 * can apply changes to. `base` options (a derived-column registry, a fixed
 * `now` for time phrases) ride every read; a per-call `opts` merges over them.
 */
export let storage = (
  driver: Driver,
  vocab: Vocab,
  base: BindOpts = {},
): Store => {
  let tx: Tx = {
    read: (query, opts) => read(driver, vocab, query, { ...base, ...opts }),
    get: (eids) => get(driver, vocab, eids, base),
    patch: (bundles) => patch(driver, vocab, bundles),
    remove: (entities) => remove(driver, vocab, entities),
  }
  return {
    ddl: () => schema(vocab),
    install: () => {
      for (let stmt of schema(vocab)) driver.exec(stmt)
    },
    read: (query, opts) => read(driver, vocab, query, { ...base, ...opts }),
    rows: (query, opts) => rows(driver, vocab, query, { ...base, ...opts }),
    tx: (body) => unit(driver, () => body(tx)),
  }
}
