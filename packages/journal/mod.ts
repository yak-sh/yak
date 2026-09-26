/**
 * @yaks/journal — who wrote what, and when: attribution and history for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}, with undo and a feed of
 * changes falling out of the same record.
 *
 * Take a page several people edit. Somebody renames it, somebody else rewrites
 * a paragraph, somebody deletes a note attached to it. Afterwards the page
 * holds only where it ended up — which is the question a graph answers well,
 * and not the question being asked. This package writes the other one down.
 *
 * Throughout, a transaction is one call to `graph.apply()`: a list of bundles
 * that all commit or none do. The type for a recorded one is {@link Batch},
 * and its `seq` is its position in the total order.
 *
 * ## What it records
 * Three append-only tables beside the graph's own. They hold no entities of
 * their own — no eid, no minted id, never in a bundle or a client cache: they
 * are the record of what was applied, not part of it.
 *
 * - `journal_tx` — one row per committed transaction: its id is both the total
 *   order and the cursor, with the timestamp and the actor from the
 *   transaction's `$actor`;
 * - `journal_change` — one ordered row per component that transaction patched
 *   or removed;
 * - `journal_field` — one ordered after-image per property that row wrote.
 *
 * After-images only. The before-value a history read needs is rebuilt from the
 * entity's own rows in the log, a read bounded to one entity and never a table
 * scan, which is what keeps the log about a third of the size of one that
 * stores both sides. The rows go in inside the caller's transaction: a
 * transaction that was refused leaves no trace, and one that committed always
 * has a row.
 *
 * ## What it returns
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { storage } from '@yaks/sqlite'
 * import { ddl, journal, log, undo } from '@yaks/journal'
 *
 * for (let s of ddl()) db.query(s)
 * let j = log({ rows: (s) => db.query(s) })
 * let g = graph({ storage: store, vocab, plugins: [journal(j)] })
 *
 * g.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' },
 *           $actor: { by: 'ada' } }])
 *
 * j.history('p1')   // every transaction that touched the page, oldest first
 * j.since(0)        // the feed: the transactions after a cursor, oldest first
 * undo(g, j)(1)     // the inverse, applied — and journaled in its turn
 * ```
 *
 * - {@link Log.history} — the changes to one entity, in order, each with the
 *   identity that wrote it and when it committed.
 * - {@link undo} — the inverse of a transaction, applied through the graph, so
 *   an undo is a write like any other and undoing it is a redo. A transaction
 *   that deleted an entity is refused ({@link Final}): a deletion is final.
 * - {@link Log.since} — the transactions after a cursor, oldest first.
 *   {@link applied} turns one back into the bundles it committed; a consumer
 *   that stores the cursor before it does the work runs effects at most once.
 * - {@link follow} — the feed as one host sees it: every transaction another
 *   host committed to the same store since the last look, as the patches it
 *   applied ({@link recast}). Each log writes as one host
 *   ({@link LogOpts.host}), so a graph's subscribers can be told of the commits
 *   its own `effect` phase never saw: another process's, another thread's.
 *
 * ## What it is not
 * It is not a backup and not a state machine: it records what moved, not the
 * whole entity, so a graph journaled from its first write can answer anything
 * about its past and one that started journaling later answers only from there
 * on. It imports no platform API — the caller hands in one function,
 * `rows(sql, params)` — so the same journal runs on a server, in a worker, and
 * over an embedded database.
 *
 * @module
 */

export * from './value.ts'
export * from './batch.ts'
export * from './log.ts'
export * from './undo.ts'
export * from './feed.ts'
