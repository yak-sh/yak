/**
 * @yaks/effects — what a graph does about the data it commits, kept out of the
 * write path.
 *
 * A write is settled by {@link https://jsr.io/@yaks/graph | @yaks/graph}'s
 * `apply()`. An effect is the other half: a function registered per component
 * that runs after the transaction commits and acts on what changed. When a post
 * is published, notify its subscribers. When an order is paid, print a receipt.
 * When an account is deleted, close its sessions.
 *
 * This package is the mechanism only — a registry, a write phase, and the rules
 * for running a handler safely. It ships no effect of its own and declares no
 * components; the components are your vocabulary's and the handlers are yours.
 *
 * A batch, here and throughout, is a list of changes applied in one
 * transaction: the array passed to `apply()`, written in full or not at all.
 *
 * ## Use
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { effects } from '@yaks/effects'
 *
 * let fx = effects(vocab)
 * let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
 *
 * fx.created('post', (e) => index(e.entity.eid, e.comp?.title))
 * fx.changed('post', 'published', (e) => notify(e.entity.eid))
 * fx.removed('post', (e) => unindex(e.entity.eid))
 * ```
 *
 * Three things happen to a component: {@link Effects.created} when an entity
 * gains it, {@link Effects.changed} when it is patched (for one column, or for
 * any), {@link Effects.removed} when it goes — by its own deletion, or with an
 * entity that died, including every casualty a cascade took. The last of those
 * is `on('-comp', run)` written shortly; the first two describe what changed,
 * and what changed is not a query about what is now true.
 *
 * ## Or a pattern
 * Those three are the narrow question. The wide one is any query, run
 * wherever this batch just made it true:
 *
 * ```ts
 * fx.on('$call .call, !results', (e) => run(e.entity.eid))
 * ```
 *
 * Nothing has to be derived into the graph to trigger that — "a call with no
 * result" is a query the storage can already answer, so the query itself is the
 * registration, with no flag column and no second write to record the first.
 * Only a batch that moved a component the query reads is asked, and a result
 * row counts only where the batch touched the entity it bound.
 *
 * ## The promises
 * - **Post-commit only.** A handler cannot reject a write; by the time it runs,
 *   the write is durable. A batch that was refused fires nothing at all.
 * - **Isolated.** A handler that throws is passed to `report` and the next
 *   handler still runs. A broken handler never breaks the batch.
 * - **At most once.** A crash between the commit and the handler loses the
 *   run. Where that is not acceptable, the optional durability tier
 *   ({@link ledger}, {@link effectDoc}) writes each run down and finishes what
 *   an interrupted process left — once.
 * - **Sync stays sync.** Synchronous handlers keep `apply()` synchronous; the
 *   first handler that returns a promise makes that call's return value a
 *   promise.
 *
 * ## Writing back
 * An effect that writes has one route, and it is the graph's own `apply()`:
 *
 * ```ts
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 *
 * fx.changed('order', 'paid', (e, tx, write) =>
 *   write([{ entity: { eid: receipt }, receipt: { order: e.entity.eid } }]))
 * ```
 *
 * So the write is admitted, stamped, journaled, broadcast to subscribers and
 * seen by the other effects — everything a write through `tx.patch` is not. It
 * is a new batch, applied after the commit that triggered the handler, never a
 * row inserted into the finished transaction. `trusted` is what lets an effect
 * write a server-owned column, which is most of what effects write.
 *
 * A write from an effect could of course trigger an effect. That loop is
 * stopped in one place rather than by a rule in each handler: every batch
 * carries its {@link generation} — 0 when it came from a client, 1 for an
 * effect's write — and a batch past `depth` (default 1) commits and broadcasts
 * like any other while triggering nothing.
 *
 * It imports no platform API, so the same registry runs on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './trace.ts'
export * from './write.ts'
export * from './registry.ts'
export * from './durable.ts'
export * from './lease.ts'
