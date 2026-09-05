/**
 * @yaks/edge — links between entities, as a component.
 *
 * A relationship in a yaks graph is not a foreign-key column; it is an
 * {@link Edge} component: `{ from, to }`, optionally typed, carried by an
 * entity like any other component. Because an edge is a component it patches,
 * tombstones, and travels over the {@link https://jsr.io/@yaks/graph | @yaks/graph}
 * wire exactly like the rest of the model — no special table, no special
 * write.
 *
 * This package owns that component and the traversal built on it: follow an
 * entity's edges forward, gather what points back, and walk a typed path to a
 * bounded depth. It contributes the `edge` component as a plugin; it evaluates
 * nothing on its own — a {@link Storage} adapter answers the underlying reads.
 *
 * @module
 */

import type { Eid, Plugin } from '@yaks/graph'

/**
 * A link from one entity to another. `type` names the relationship (so an
 * entity may carry many edges of different kinds); an untyped edge is a plain
 * association.
 */
export type Edge = {
  /** the source entity */
  from: Eid
  /** the target entity */
  to: Eid
  /** the relationship's name, if the link is typed */
  type?: string
}

/** One hop of a traversal: which direction, and an optional type filter. */
export type Hop = {
  /** follow `from → to` (out) or `to → from` (in) */
  dir: 'out' | 'in'
  /** restrict to edges of this type */
  type?: string
}

/**
 * The traversal seam: an entity's neighbours one hop away, and the reachable
 * set within a bounded depth. The implementation lands with the package; this
 * is the shape it satisfies.
 */
export type Traversal = {
  /** the entities one hop from `entity` along `hop` */
  neighbours: (entity: Eid, hop: Hop) => Promise<Eid[]>
  /** every entity reachable from `entity` within `depth` hops */
  reach: (entity: Eid, hop: Hop, depth: number) => Promise<Eid[]>
}

/** The plugin that contributes the `edge` component to a graph. */
export type plugin = () => Plugin
