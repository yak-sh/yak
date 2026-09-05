/**
 * @yaks/effects — what a graph DOES about the data it commits, kept out of the
 * write path.
 *
 * A write is settled by {@link https://jsr.io/@yaks/graph | @yaks/graph}'s
 * `apply()`. An EFFECT is the other half: an observer that runs AFTER the
 * transaction commits and acts on what changed. When a post is published,
 * notify its subscribers. When an order is paid, print a receipt. When an
 * account is deleted, close its sessions.
 *
 * This package is the MECHANISM only — a registry, a phase, and the rules for
 * running a handler safely. It ships no effect of its own and knows no
 * components; the components are your vocabulary's and the handlers are yours.
 *
 * ## Use
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { memory } from '@yaks/memory'
 * import { effects } from '@yaks/effects'
 *
 * let fx = effects(vocab)
 * let g = graph({ storage: memory(vocab), vocab, plugins: [fx] })
 *
 * fx.created('post', (e) => index(e.entity.eid, e.comp?.title))
 * fx.changed('post', 'published', (e) => notify(e.entity.eid))
 * fx.removed('post', (e) => unindex(e.entity.eid))
 * ```
 *
 * Three things happen to a component, and they are three registrations:
 * {@link Effects.created} when an entity gains it, {@link Effects.changed}
 * when it is patched (for one column, or for any), {@link Effects.removed}
 * when it goes — by its own deletion, or with an entity that died, including
 * every casualty a cascade took.
 *
 * ## The promises
 * - **Post-commit only.** A handler cannot veto a write; by the time it runs,
 *   the write is durable. A batch that was refused fires nothing at all.
 * - **Isolated.** A handler that throws is passed to `report` and the next
 *   handler still runs. A broken observer never breaks the batch.
 * - **At most once.** A crash between the commit and the handler loses the
 *   run. Where that is not acceptable, the optional durability tier
 *   ({@link ledger}, {@link effectDoc}) writes each run down and finishes what
 *   an interrupted process left — once.
 * - **Sync stays sync.** Synchronous handlers keep `apply()` synchronous; the
 *   first handler that returns a promise makes that call's answer a promise.
 *
 * ## Writing back
 * An effect that writes gets one door, and it is the graph's own `apply()`:
 *
 * ```ts
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 *
 * fx.changed('order', 'paid', (e, tx, write) =>
 *   write([{ entity: { eid: receipt }, receipt: { order: e.entity.eid } }]))
 * ```
 *
 * So the write is admitted, stamped, journaled, cast to subscribers and seen by
 * the other effects — everything a write through `tx.patch` is not. It is a NEW
 * batch, after the commit that woke the handler, never a row smuggled into the
 * finished transaction. `trusted` is what lets an effect stamp a server-owned
 * column, which is most of what effects write.
 *
 * A write from an effect could of course wake an effect. That loop is stopped
 * by the door, not by a rule in each handler: every batch carries its
 * {@link generation} — 0 at the door, 1 for an effect's write — and a batch
 * past `depth` (default 1) commits and casts like any other while waking
 * nobody.
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
