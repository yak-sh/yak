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
 * {@link storage} implements the `Storage` interface — in one line of
 * composition:
 * {@link driver} turns the object's SQLite into a
 * {@link https://jsr.io/@yaks/sql | @yaks/sql} `Driver`, and @yaks/sqlite over it
 * owns the schema, the compiled reads, the patches and the cascading deletes.
 * No SQL is written twice.
 *
 * {@link sockets} is the plumbing between the object's WebSockets and
 * {@link https://jsr.io/@yaks/api | @yaks/api}'s subscriptions — accept a
 * socket for hibernation, pass its frames to the registry, and rebuild the
 * subscriptions of a woken object from what its sockets hold. What a
 * subscription means lives in @yaks/api; only the Cloudflare-specific plumbing
 * is here.
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
 * {@link Durable} is the whole object as a class, the one place a class is
 * the platform's requirement: a spec opens its graph, door and sockets, and
 * {@link clock} works everything it does on its own time from its one alarm.
 *
 * And from the caller's side, the door to an object: {@link stubOf} takes a
 * namespace's stub by name, placed where a hint says; {@link doorOf} builds
 * every request through it from scratch; and {@link resending} sends a call
 * again when the runtime reset the object or lost the call, while that is
 * safe.
 *
 * @module
 */

export {
  driver,
  type DurableSql,
  type DurableStorage,
  freely,
  type Measure,
  type Observe,
  prohibited,
  reserved,
  type Sample,
  type SqlCursor,
  type SqlValue,
} from './sql.ts'
export {
  arrived,
  type Cell,
  type Chunk,
  chunks,
  type Copied,
  copied,
  ending,
  overwritten,
  page,
  type Plan,
  plan,
  raised,
  reread,
  stale,
  tallied,
} from './copy.ts'
export { storage, type Store } from './store.ts'
export {
  type Alarms,
  BACKSTOP,
  type Clock,
  clock,
  RETRY,
  SLICE,
  type Work,
} from './alarm.ts'
export { Durable, type Opened, type Spec, type State } from './object.ts'
export {
  type Assembling,
  composed,
  type Composing,
  type Kind,
  lent,
  planned,
  ROLES,
} from './compose.ts'
export {
  type Call,
  type Door,
  doorOf,
  IDEMPOTENCY,
  type Namespace,
  type Resend,
  resending,
  reset,
  type Send,
  type Stub,
  stubOf,
  thrown,
} from './door.ts'
export {
  backoff,
  evicted,
  jittered,
  killed,
  LOOK,
  moved,
  opaque,
  type Own,
  replaced,
  retried,
  starved,
  vacating,
} from './resets.ts'
export { profile, type Summary } from './profile.ts'
export {
  bounded,
  type Ceiling,
  ceiling,
  FAR,
  type Kv,
  type Report,
  Runaway,
  SCAN,
  Scan,
  type Spent,
  Stopped,
  stopped,
  type Told,
  type Window,
  WINDOWS,
} from './ceiling.ts'
export {
  type Hibernation,
  type Sockets,
  sockets,
  type Wire,
} from './sockets.ts'
