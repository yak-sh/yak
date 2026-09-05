/**
 * @yaks/d1 — the storage adapter that backs a yaks graph with Cloudflare D1.
 *
 * ## What it is
 * D1 is a serverless SQLite reachable only over an async API, so this adapter
 * is async end to end: every read and every write returns a promise. It
 * composes the yaks query → vocabulary → SQL stack over a D1 binding to satisfy
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}'s `Storage` seam — a query
 * in, whole bundles out; a change patched into rows.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { storage } from '@yaks/d1'
 *
 * // let store = storage(env.DB, vocab)
 * // await store.install()
 * // let g = graph({ storage: store, vocab })
 * // await g.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
 * // await g.read('.kind=doc')
 * ```
 *
 * Because the seam is async-OR-sync and @yaks/graph threads either (its `then`
 * awaits a promise and passes a plain value straight through), the SAME
 * `apply()` is synchronous over @yaks/sqlite and asynchronous here. Nothing in
 * between has to know which.
 *
 * ## The transaction, stated plainly
 * D1 has no interactive transaction — no call opens one, lets your code read
 * and decide inside it, and commits at the end. What it has is `batch()`, which
 * runs a list of statements sequentially in one implicit transaction and rolls
 * the whole list back if any fails. So {@link storage}'s `tx` defers: reads run
 * immediately against the committed database, writes are gathered as
 * statements, returning flushes them as ONE atomic batch, and throwing discards
 * them unsent. Reads inside the transaction see its own pending writes through
 * an in-memory overlay judged by {@link https://jsr.io/@yaks/match | @yaks/match}.
 *
 * The write is atomic; the transaction is NOT serializable, because the reads
 * cannot be enrolled in a batch that has not been sent. See the README's
 * "The transaction" for exactly what that costs and when it matters.
 *
 * ## Where it sits
 * One of three interchangeable adapters behind the same seam:
 * **@yaks/d1** (this package, async), {@link
 * https://jsr.io/@yaks/durable-object | @yaks/durable-object} (a Durable
 * Object's embedded SQLite, synchronous) and {@link
 * https://jsr.io/@yaks/sqlite | @yaks/sqlite} (in-process, synchronous — and
 * the reference every adapter is held to).
 *
 * @module
 */

export {
  bind,
  type D1Like,
  type D1Result,
  type D1Stmt,
  type D1Value,
  type Row,
  type Sql,
  type Stmt,
  unbind,
} from './d1.ts'
export { bundles, comps, gatherSql, type Query, spineSql, sql } from './read.ts'
export { drop, mint, patch, remove, upsert } from './write.ts'
export { storage, type Store } from './store.ts'
export type { Storage, Tx } from '@yaks/graph'
