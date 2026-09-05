// The door an effect writes back through, and the thing that stops it looping.
//
// A handler that only READS is served by the detached transaction it already
// holds. A handler that WRITES is a different animal: `tx.patch` puts rows
// straight into storage, under the whole pipeline — no admission, no stamps,
// no journal row, no subscriber told, and no other effect ever hearing about
// it. The outcome of a letter became a row a page found on its next query
// instead of a frame it was handed (T-34044). So an effect's write is a NEW
// BATCH through the graph's own `apply()`, after the commit that woke it.
//
// That is a loop waiting to happen, and it is stopped HERE rather than by a
// rule in every handler. Each batch carries how deep in effect-written
// GENERATIONS it is, under `$effect`: a `$`-key, so it is `apply()`'s pipeline
// and never a column — the same trick `$before` uses to carry a reading from
// one phase to a later one. The registry wakes nobody for a batch past the
// depth it allows, so an effect that writes what it watches runs a bounded
// number of times and stops, whatever it writes and however it is registered.

import type { Bundle } from '@yaks/graph'

/**
 * A write from inside an effect: one new batch through the graph's own
 * `apply()`, post-commit, answering with the batch as applied.
 *
 * The host supplies it ({@link Opts.write}), because only the host knows which
 * graph and in whose name. It writes as the KERNEL — the server itself, not the
 * client whose batch woke the effect — so it must be applied `trusted`: an
 * outcome an effect stamps (`delivered`, `bounced`) is a server-owned column,
 * and an untrusted apply would drop exactly the columns the effect exists to
 * write.
 *
 * ```ts
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * ```
 */
export type Write = (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>

/** The key a batch's generation rides under. Not a component: `$`-prefixed
 * keys are `apply()`'s pipeline, never columns, so no storage adapter sees
 * it. */
export let ORIGIN = '$effect'

/** How deep in effect-written batches this one is: `0` for a batch that
 * arrived at a door, `1` for an effect's own write, one more for each write an
 * effect makes about that one. */
export let generation = (bundles: Bundle[]): number =>
  Number(bundles.find((b) => b[ORIGIN] != null)?.[ORIGIN] ?? 0)

/** The same batch, marked as an effect's own at generation `gen`. Copies, so
 * the handler's own bundles are never edited under it. */
export let marked = (bundles: Bundle[], gen: number): Bundle[] =>
  bundles.map((b) => ({ ...b, [ORIGIN]: String(gen) }))

/** Take the mark back off, so what a caller gets back is the batch as applied
 * and nothing else. In place, like {@link strip} — the bundles it edits are
 * the copies this package made. */
export let unmark = (bundles: Bundle[]): Bundle[] => {
  for (let b of bundles) if (ORIGIN in b) delete b[ORIGIN]
  return bundles
}
