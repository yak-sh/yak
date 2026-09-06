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
 * A `journal` plugin hooks two phases of `apply()`. Before the batch writes it
 * reads the state it is about to change; inside the same transaction, after
 * the batch has written, it records what moved as two components of its own:
 *
 * - `batch{seq, at, by, via}` — one per committed batch: its place in the
 *   total order, the moment, and the actor from the batch's `$actor`;
 * - `delta{seq, target, comp, column, before, after}` — one per column that
 *   moved, or per component that appeared or went.
 *
 * They are ordinary components, so the log is queryable with the same grammar
 * as everything else, stored by whatever adapter the graph is bound to, and
 * carried by the same bundles. It is written INSIDE the transaction: a batch
 * that was refused leaves no trace, and a batch that committed always has one.
 *
 * ## What it answers
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { history, journal, journalDoc, since, undo } from '@yaks/journal'
 *
 * let vocab = loadVocab([journalDoc, pages])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [journal(vocab)] })
 *
 * g.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' },
 *           $actor: { by: 'ada' } }])
 *
 * history(g)('p1')     // every batch that touched the page, oldest first
 * undo(g)(1)           // the inverse batch, applied — and journaled in turn
 * since(g)({ seq: 0 }) // { batches, cursor } — the feed
 * ```
 *
 * - {@link history} — the changes to one entity, in order, each with its
 *   actor and its moment.
 * - {@link undo} — the inverse of a batch, applied through the graph, so an
 *   undo is a write like any other and undoing it is a redo. A batch that
 *   deleted an entity is refused ({@link Final}): a death is final.
 * - {@link since} — the batches after a cursor and the cursor that follows.
 *   {@link applied} turns one back into the bundles it committed, which is
 *   what a server recasts to its subscribers, and a consumer that stores the
 *   cursor before it works drives effects at most once.
 *
 * ## What it is not
 * It is not a backup and not a state machine: it records what moved, not the
 * whole entity, so a graph that was journaled from its first write can answer
 * anything and one that started journaling later answers from there on. It
 * imports no platform API, so the same journal runs on a server, in a worker,
 * and in a browser tab.
 *
 * @module
 */

export * from './vocab.ts'
export * from './value.ts'
export * from './record.ts'
export * from './read.ts'
export * from './undo.ts'
