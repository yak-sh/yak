/**
 * @yaks/d1 — a storage adapter that backs a yaks graph with Cloudflare D1.
 *
 * D1 is a serverless SQLite offered only over an async API, so this adapter is
 * async end to end: every read and write returns a promise. It composes the
 * yaks query/vocabulary/SQL stack over a D1 binding to satisfy the
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} {@link Storage} seam —
 * queries in as bundles out, a change patched into rows.
 *
 * It is a sibling of `@yaks/durable-object` (a Durable Object's embedded,
 * synchronous SQLite) and {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite}
 * (the in-process adapter). All three implement the same seam; the seam is
 * async-or-sync, so this adapter returns promises while a synchronous one does
 * not, and a graph stays portable across them.
 *
 * @module
 */

import type { Storage } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

/**
 * The async surface this adapter needs from a D1 binding — the subset of
 * Cloudflare's `D1Database` it calls. Naming just this keeps the adapter free
 * of any concrete Workers types.
 */
export type D1Like = {
  /** prepare a parameterized statement for binding and running */
  prepare: (sql: string) => D1Stmt
  /** run a batch of prepared statements as one unit */
  batch: <T = unknown>(statements: D1Stmt[]) => Promise<T[]>
}

/** A prepared D1 statement: bind params, then run for rows. */
export type D1Stmt = {
  /** bind positional parameters, returning the bound statement */
  bind: (...params: unknown[]) => D1Stmt
  /** run the statement and resolve its result rows */
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>
}

/**
 * Bind a store to a D1 binding and a vocabulary. Returns the {@link Storage}
 * seam, whose methods resolve asynchronously. The implementation lands with the
 * package; this is the shape it satisfies.
 */
export type openStore = (db: D1Like, vocab: Vocab) => Storage
