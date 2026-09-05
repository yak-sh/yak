/**
 * @yaks/graph — the entity/component graph core: the data model every yaks
 * package shares, the wire that carries writes, and the phased, pluggable
 * `apply()` that commits them.
 *
 * ## The model
 * Everything is an ENTITY, identified by an {@link Entity} — a client-minted
 * `eid`, plus the `num` storage mints on first touch. An entity carries
 * COMPONENTS: a named bag of columns, one per component it wears. An entity
 * has no type of its own; it IS whatever components it carries. A book is a
 * `doc` plus a `book`; a review is a `doc` plus a `review`. Adding a component
 * adds a facet.
 *
 * ## The wire
 * A {@link Bundle} is one entity plus components. The identity rides IN the
 * bundle, under the `entity` key. A write is a PATCH — an omitted column is
 * untouched, a `null` column is cleared, a `null` component is dropped — and a
 * {@link Change} is a flat array of bundles applied atomically.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * // let g = graph({ storage, vocab })
 * // g.apply([
 * //   { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } },
 * //   { entity: { eid: 'b2' }, $delete: true },
 * // ])
 * ```
 *
 * Reserved keys ride beside the components as components of their own, read by
 * `apply()` rather than written as columns: `$delete` (delete the entity, also
 * spelled as a `tombstone` component), `$was` (a per-column precondition — see
 * {@link Was}), and `$actor` (who is writing — see {@link Actor}).
 *
 * ## Apply is pluggable, in fixed phases
 * A change runs through an ordered list of {@link Phase}s — normalize, admit,
 * precondition, mutate, cascade, stamp, journal, commit, effect, audit. The
 * order is load-bearing, so a {@link Plugin} registers a {@link Hook} against
 * a NAMED phase; the hook takes the batch and returns the batch the next phase
 * sees, which is how a hook rewrites, adds, or (by throwing) refuses. Every
 * registry is per graph instance.
 *
 * This package ships ZERO components — a vocabulary is described with
 * {@link https://jsr.io/@yaks/vocab | @yaks/vocab} and contributed by plugins
 * — and has no `snapshot()`: reads are queries answered by a {@link Storage}
 * adapter, never a whole-graph dump. It imports no platform API, so the same
 * core runs on a server, in a worker, and in a browser tab.
 *
 * @module
 */

export * from './bundle.ts'
export * from './storage.ts'
export * from './plugin.ts'
export * from './pipe.ts'
export * from './sha256.ts'
export * from './state.ts'
export * from './admit.ts'
export * from './guard.ts'
export * from './mutate.ts'
export * from './cascade.ts'
export * from './stamp.ts'
export * from './graph.ts'
