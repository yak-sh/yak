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
 * A handler receives a detached transaction — `tx.patch([...])` writes a
 * bundle straight through storage, post-commit — and a handler registered
 * after the graph exists can simply close over it and call `g.apply()` for the
 * full pipeline. Either way the write is a new batch, so an effect that writes
 * the component it watches will wake itself: watch a different component, or a
 * different column, than you write.
 *
 * It imports no platform API, so the same registry runs on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './trace.ts'
export * from './registry.ts'
export * from './durable.ts'
