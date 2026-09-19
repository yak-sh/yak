/**
 * @yaks/journal — who wrote what, when: attribution and history for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}, with undo and a delta feed
 * falling out of the same record.
 *
 * Take a page several people edit. Somebody renames it, somebody else rewrites
 * a paragraph, somebody deletes a note attached to it. Afterwards the page
 * holds only where it ENDED UP — which is exactly the question a graph answers
 * well and the question nobody is asking. This package writes the other one
 * down.
 *
 * ## What it records
 * Three append-only tables beside the graph's own, OFF the spine — no entity,
 * no minted id, never in a bundle or a client cache: the record OF the wire,
 * not part of it.
 *
 * - `journal_tx` — one row per committed batch: its id is the total order and
 *   the cursor, with the moment and the actor from the batch's `$actor`;
 * - `journal_change` — one ordered row per component the batch patched or
 *   removed;
 * - `journal_field` — one ordered AFTER-IMAGE per column that row wrote.
 *
 * After-images only. The before-value a history read wants is derived from the
 * entity's own slice of the log, bounded to one entity and never a scan, which
 * is what keeps the log a third of the size of one that stores both sides. It
 * is written INSIDE the caller's transaction: a batch that was refused leaves
 * no trace, and a batch that committed always has a row.
 *
 * ## What it answers
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { storage } from '@yaks/sqlite'
 * import { ddl, journal, log, undo } from '@yaks/journal'
 *
 * db.exec(ddl())
 * let j = log({ rows: (sql, p) => db.query(sql, p) })
 * let g = graph({ storage: store, vocab, plugins: [journal(j)] })
 *
 * g.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' },
 *           $actor: { by: 'ada' } }])
 *
 * j.history('p1')   // every batch that touched the page, oldest first
 * j.since(0)        // the feed: the batches after a cursor, oldest first
 * undo(g, j)(1)     // the inverse batch, applied — and journaled in turn
 * ```
 *
 * - {@link Log.history} — the changes to one entity, in order, each with its
 *   actor and its moment.
 * - {@link undo} — the inverse of a batch, applied through the graph, so an
 *   undo is a write like any other and undoing it is a redo. A batch that
 *   deleted an entity is refused ({@link Final}): a death is final.
 * - {@link Log.since} — the batches after a cursor, oldest first.
 *   {@link applied} turns one back into the bundles it committed, which is
 *   what a server recasts to its subscribers, and a consumer that stores the
 *   cursor before it works drives effects at most once.
 *
 * ## What it is not
 * It is not a backup and not a state machine: it records what moved, not the
 * whole entity, so a graph that was journaled from its first write can answer
 * anything and one that started journaling later answers from there on. It
 * imports no platform API — the host is one function wide, `rows(sql,
 * params)` — so the same journal runs on a server, in a worker, and over an
 * embedded database.
 *
 * @module
 */

export * from './value.ts'
export * from './batch.ts'
export * from './log.ts'
export * from './undo.ts'
