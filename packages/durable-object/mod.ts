/**
 * @yaks/durable-object — a yaks graph inside a Cloudflare **Durable Object**:
 * its embedded SQLite is the storage, and its hibernatable WebSockets are the
 * live-sync fan-out.
 *
 * A Durable Object is a single-threaded, strongly-consistent home for one
 * graph. `ctx.storage.sql` is a synchronous SQLite engine, so
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}'s `apply()` stays
 * synchronous here; `ctx.storage.transactionSync` is the transaction it runs
 * its in-transaction phases inside.
 *
 * ## Two halves
 * {@link storage} is the `Storage` seam — and it is one line of composition:
 * {@link driver} turns the object's SQLite into a
 * {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite} `Driver`, and that package
 * owns the schema, the compiled reads, the patches and the death cascade. No
 * SQL is written twice.
 *
 * {@link sockets} is the plumbing between the object's WebSockets and
 * {@link https://jsr.io/@yaks/api | @yaks/api}'s subscriptions — accept a
 * socket for hibernation, hand its frames to the registry, and rebuild the
 * subscriptions of a woken object from what its sockets hold. What a
 * subscription MEANS lives in @yaks/api; only the wire is here.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { api, subscriptions } from '@yaks/api'
 * import { sockets, storage } from '@yaks/durable-object'
 *
 * // let store = storage(ctx.storage, vocab)
 * // store.install()
 * // let g = graph({ storage: store, vocab })
 * // let subs = subscriptions(g)
 * // let live = sockets(subs, ctx)
 * // let handler = api({ graph: g, subs })
 * ```
 *
 * See the README for the whole object as a class — `fetch`,
 * `webSocketMessage`, `webSocketClose` — which is the one place a class is the
 * platform's requirement.
 *
 * @module
 */

export {
  driver,
  type DurableSql,
  type DurableStorage,
  prohibited,
  reserved,
  type SqlCursor,
  type SqlValue,
} from './sql.ts'
export { storage, type Store } from './store.ts'
export {
  type Hibernation,
  type Sockets,
  sockets,
  type Wire,
} from './sockets.ts'
