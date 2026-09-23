// How an effect writes back, and what stops it looping.
//
// A handler that only reads is served by the detached transaction it already
// holds. A handler that writes is a different matter: `tx.patch` puts rows
// straight into storage, underneath the whole pipeline — no admission, no
// stamped properties, no journal row, no subscriber notified, and no other
// effect ever hearing about it. That is how the outcome of a letter became a
// row a page only found on its next query, instead of an update it was pushed
// (T-34044). So an effect's write is a new batch — a list of changes applied in
// one transaction — through the graph's own `apply()`, after the commit that
// triggered the handler.
//
// That invites a loop, and the loop is stopped here rather than by a rule in
// every handler. Each batch records how many effect-written generations deep it
// is, under `$effect`: a `$`-prefixed key, so it belongs to `apply()`'s
// pipeline and is never a property — the same mechanism `$before` uses to carry
// a reading from one phase to a later one. The registry triggers nothing for a
// batch past the depth it allows, so an effect that writes the component it
// watches runs a bounded number of times and stops, whatever it writes and
// however it is registered.

import type { Bundle } from '@yaks/graph'

/**
 * A write from inside an effect: one new batch through the graph's own
 * `apply()`, post-commit, returning the batch as applied.
 *
 * The application supplies it ({@link Opts.write}), because only it knows which
 * graph and in whose name. It writes as the kernel — the server itself, not the
 * client whose batch triggered the effect — so it must be applied `trusted`: an
 * outcome an effect records (`delivered`, `bounced`) is a server-owned
 * property, and an untrusted apply would drop exactly the properties the effect
 * exists to write.
 *
 * ```ts
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * ```
 */
export type Write = (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>

/** The key a batch's generation rides under. Not a component: `$`-prefixed
 * keys are `apply()`'s pipeline, never properties, so no storage adapter sees
 * it. */
export let ORIGIN = '$effect'

/** How deep in effect-written batches this one is: `0` for a batch that came
 * from a client, `1` for an effect's own write, one more for each write an
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
