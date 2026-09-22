/**
 * @yaks/graph — the entity/component graph core: the data model every yaks
 * package shares, the write format that carries changes, and the phased,
 * pluggable `apply()` that commits them.
 *
 * ## The model
 * Everything is an entity, identified by an {@link Entity} — an `eid` the
 * client generates. An entity has components: a named object of columns, one
 * per component. An entity has no type of its own; it is whatever components it
 * has. A book is a `doc` plus a `book`; a review is a `doc` plus a `review`.
 * Adding a component adds an aspect to the entity, not a subtype.
 *
 * ## The write format
 * A {@link Bundle} is one entity plus its components. The identity is part of
 * the bundle, under the `entity` key. A write is a PATCH — an omitted column is
 * left alone, a `null` column is cleared, a `null` component is removed — and a
 * {@link Change} is a flat array of bundles applied in one transaction.
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
 * A few reserved keys sit beside the components and look like components, but
 * `apply()` acts on them rather than storing them as columns: `$delete` (delete
 * the entity, which can also be written as a `tombstone` component), `$was` (a
 * per-column precondition — see {@link Was}), and `$actor` (who is writing —
 * see {@link Actor}). A plugin declares requests of its own the same way it
 * declares components, and a `$` key nothing declared is refused (see
 * {@link requested}). They belong to the write pipeline and stop there: what
 * `apply()` returns is the transaction as applied, {@link composed} into one
 * bundle per entity, carrying the components, the columns the server set and
 * the `$alias` the caller referred to it by — and no other `$` key.
 *
 * ## Apply is pluggable, in fixed phases
 * A change runs through an ordered list of {@link Phase}s — normalize, admit,
 * precondition, mutate, cascade, stamp, journal, commit, effect, audit. The
 * order matters, so a {@link Plugin} registers a {@link Hook} against a named
 * phase; the hook takes the list of changes and returns the list the next phase
 * sees, which is how a hook rewrites it, adds to it, or (by throwing) refuses
 * it. Every registry is per graph instance.
 *
 * A plugin can express the same thing as data: a {@link Rule} is a query over
 * one bundle in the transaction plus what it produces (`produce` a template, or
 * `run` a function), and the sigils in the query are what make it a rule —
 * `+comp` ensures the component exists, `+!comp` also requires that it did not
 * already, so the rule fires once, and `*comp` declares what the rule writes. A
 * phase evaluates all of its rules against the same state before any of them
 * writes; the core's own `created`/`updated` stamps are two such rules.
 *
 * A plugin also declares what its hooks are going to read — `wants(bundles)`,
 * returning {@link Ask}s — and `apply()` satisfies every plugin's asks and its
 * own in one read when the transaction opens, so the phases that run before the
 * write read from memory instead of making a round trip each (see ./gather.ts).
 *
 * This package ships zero components — a vocabulary is described with
 * {@link https://jsr.io/@yaks/vocab | @yaks/vocab} and contributed by plugins
 * — and has no `snapshot()`: reads are queries answered by a {@link Storage}
 * adapter, never a whole-graph dump. It imports no platform API, so the same
 * core runs on a server, in a worker, and in a browser tab.
 *
 * @module
 */

export * from './bundle.ts'
export * from './mint.ts'
export * from './storage.ts'
export * from './plugin.ts'
export * from './pipe.ts'
export * from './sha256.ts'
export * from './state.ts'
export * from './alias.ts'
export * from './identity.ts'
export * from './admit.ts'
export * from './request.ts'
export * from './gather.ts'
export * from './guard.ts'
export * from './mutate.ts'
export * from './cascade.ts'
export * from './rules.ts'
export * from './stamp.ts'
export * from './compose.ts'
export * from './graph.ts'
export * from './said.ts'
export * from './meant.ts'

export * from './edit.ts'

export * from './preflight.ts'

export * from './transient.ts'

export {
  addressed,
  type NamedTool,
  namedTool,
  type ToolId,
  toolName,
} from './tool.ts'

export * from './join.ts'
export * from './declared.ts'
// The vocabulary described as plain data: what `graph_schema` builds its
// result from. No runtime of its own, so a browser tab that wants the index
// pays nothing for it.
export * from './words.ts'
