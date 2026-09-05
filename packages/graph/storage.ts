// The storage seam: the one thing this package does not implement. A `Storage`
// owns the bytes — it turns a vocabulary into schema, answers queries as
// bundles, and hands out transactions. `apply()` never writes a row itself; it
// decides what should happen and tells a transaction.
//
// Two rules keep the seam thin. First, every method is async-OR-sync: an
// embedded database answers immediately, a remote one answers with a promise,
// and `apply()` threads either (see ./pipe.ts). Second, IDENTITY BELONGS TO
// STORAGE: `patch` mints whatever spine an eid needs and reports the entities
// it created, including the `num` if the adapter mints one.

import type { Query as Ast } from '@yaks/query'
import type { Bundle, Eid, Entity } from './bundle.ts'

/** One raw result row from a storage read — column name → value. */
export type Row = Record<string, unknown>

/** A query, as text (parsed by @yaks/query) or an already-built AST. */
export type Query = string | Ast

/** Options that ride a read, such as a fixed `now` for relative time phrases. */
export type ReadOpts = { now?: number }

/**
 * An open transaction. Every phase of `apply()` between `precondition` and
 * `commit` runs against one of these, so a guard reads what the batch will
 * write against and a cascade sees the rows it is about to remove. The adapter
 * commits when the body returns and rolls back if it throws.
 */
export type Tx = {
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** identity, not search: these entities as they stand, whole. A dead one
   * comes back wearing `tombstone`; an unknown one is simply absent. */
  get: (eids: Eid[]) => Bundle[] | Promise<Bundle[]>
  /** patch the bundles in → the entities this patch MINTED, with their `num`
   * when the adapter mints one */
  patch: (bundles: Bundle[]) => Entity[] | Promise<Entity[]>
  /** remove these entities: their component rows go, their identity is
   * tombstoned so the id can never be reused */
  remove: (entities: Entity[]) => void | Promise<void>
}

/**
 * A storage adapter. `@yaks/sqlite` implements this over an embedded database;
 * an in-memory map, a Durable Object and a remote SQL service implement the
 * same five members. `tx` is the transaction door: it runs the body against a
 * {@link Tx} and returns whatever the body returned, so a synchronous adapter
 * keeps `apply()` synchronous and an asynchronous one turns it into a promise.
 */
export type Storage = {
  /** the schema statements the bound vocabulary implies */
  ddl: () => string[]
  /** run them — create the tables and indexes the vocabulary needs */
  install: () => void | Promise<void>
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: ReadOpts) => Row[] | Promise<Row[]>
  /** run `body` in a transaction: commit on return, roll back on throw. Like
   * every other member it is async-OR-sync — an embedded adapter hands back
   * whatever the body returned, an adapter over a network hands back a promise
   * that settles once the transaction has committed. */
  tx: <R>(body: (tx: Tx) => R) => R | Promise<Awaited<R>>
}

/**
 * A transaction that is not one: each call is its own unit of work against the
 * storage. This is what a hook receives in the phases that run OUTSIDE the
 * batch's transaction — `normalize` before it opens, `effect` after it
 * commits, `audit` after it rolled back — where writing into the batch's
 * transaction is either impossible or exactly the wrong thing.
 */
export let detached = (storage: Storage): Tx => ({
  read: (query, opts) => storage.read(query, opts),
  get: (eids) => storage.tx((tx) => tx.get(eids)),
  patch: (bundles) => storage.tx((tx) => tx.patch(bundles)),
  remove: (entities) => storage.tx((tx) => tx.remove(entities)),
})
