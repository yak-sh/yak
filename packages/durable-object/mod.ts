/**
 * @yaks/durable-object — a storage adapter that backs a yaks graph with a
 * Cloudflare Durable Object's embedded SQLite, and keeps every connected client
 * in sync over the object's WebSockets.
 *
 * A Durable Object is a single-threaded, strongly-consistent home for one
 * graph: its `SqlStorage` handle is a synchronous SQLite engine, and its
 * hibernatable WebSockets are the live-sync fan-out. This package composes the
 * yaks query/vocabulary/SQL stack over that handle to satisfy the
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} {@link Storage} seam:
 * queries in as bundles out, a change patched into rows, and — its own job —
 * every committed change broadcast to the other sockets so open tabs converge.
 *
 * It is a sibling of `@yaks/d1` (the async D1 adapter) and
 * {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite} (the in-process adapter);
 * all three implement the same seam, so a graph is portable across them.
 *
 * @module
 */

import type { Storage } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

/**
 * The synchronous SQLite surface this adapter needs from a Durable Object —
 * the shape of `DurableObjectState.storage.sql`. Naming just this keeps the
 * adapter free of any concrete Workers types.
 */
export type DurableSql = {
  /** run a parameterized statement and yield its rows */
  exec: <T = Record<string, unknown>>(
    sql: string,
    ...bindings: unknown[]
  ) => Iterable<T>
}

/**
 * A live-sync fan-out: the adapter hands each committed change to `broadcast`,
 * which relays it to every connected client except its origin. A Durable
 * Object supplies this over its hibernatable WebSockets.
 */
export type LiveSync = {
  /** relay a committed change to the other connected clients */
  broadcast: (message: string, except?: unknown) => void
}

/**
 * Bind a store to a Durable Object's SQLite handle and a vocabulary, optionally
 * wiring live-sync. Returns the {@link Storage} seam whose `write` also
 * broadcasts. The implementation lands with the package; this is the shape it
 * satisfies.
 */
export type openStore = (
  sql: DurableSql,
  vocab: Vocab,
  live?: LiveSync,
) => Storage
