/**
 * @yaks/effects — what a graph does about the data it commits, kept out of the
 * write path and out of the writer.
 *
 * A write is settled by {@link https://jsr.io/@yaks/graph | @yaks/graph}'s
 * `apply()`. An effect is the other half: work a commit owes, run after the
 * transaction commits. When a letter is written, send it. When an order is
 * paid, print a receipt.
 *
 * A batch, here and throughout, is a list of changes applied in one
 * transaction: the array passed to `apply()`, written in full or not at all.
 *
 * ## Declared, then handled
 * An effect is declared in a vocabulary, beside the components it is about,
 * so every process that loads the vocabulary knows what a write owes:
 *
 * ```json
 * { "$defs": { "send_receipt": { "effect": true, "changed": ["order.paid"] } } }
 * ```
 *
 * and the code that runs it is registered by name, by a process that runs
 * effects:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { effects } from '@yaks/effects'
 *
 * let fx = effects(vocab)
 * let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
 * fx.handle({ send_receipt: (e) => print(e.entity.eid) })
 * ```
 *
 * Where the vocabulary also loads {@link effectDoc}, a commit writes every run
 * it owes into the graph, in its own transaction, and any number of processes
 * work the pool ({@link Effects.work}): each claims a run, runs it, and retries
 * it on the terms its declaration set. Where it does not, a handled effect
 * runs in the process that committed, at most once.
 *
 * ## Observers
 * A process can also watch its own commits, for as long as it runs:
 *
 * ```ts
 * fx.created('post', (e) => redraw(e.entity.eid))
 * fx.on('$call .call, !results', (e) => show(e.entity.eid))
 * ```
 *
 * An observer is known only to the process that registered it, so it runs
 * there, after that process's commits, and is never written down.
 *
 * ## The promises
 * - **Post-commit only.** A handler cannot reject a write; by the time it runs,
 *   the write is durable. A batch that was refused owes nothing.
 * - **Isolated.** A handler that throws is passed to `report` and the next
 *   handler still runs.
 * - **Written with the write.** Where the pool is kept, a run is committed with
 *   the change that owes it, so no crash between the two can lose it.
 *
 * ## Writing back
 * An effect that writes has one route, and it is the graph's own `apply()`:
 *
 * ```ts
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * ```
 *
 * So the write is admitted, stamped, journaled and broadcast like any other. A
 * write from an effect could trigger an effect; that loop is stopped in one
 * place: every batch carries its {@link generation} — 0 when it came from a
 * client, 1 for an effect's write — and a batch past `depth` (default 1) owes
 * nothing.
 *
 * It imports no platform API, so the same registry runs on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './trace.ts'
export * from './write.ts'
export * from './registry.ts'
export * from './pool.ts'
export * from './lease.ts'
export * from './provisional.ts'
