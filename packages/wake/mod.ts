/**
 * @yaks/wake — a scheduling component domain for a yaks graph.
 *
 * This plugin contributes a `wake` component: a promise to revisit an entity at
 * a time, on an interval, or when a condition next holds. It is how a graph
 * carries work that should happen later — a reminder, a recurring sweep, a
 * deferred retry — as data rather than an out-of-band timer.
 *
 * The package owns the component's vocabulary and the wake policy (when a due
 * wake fires, and how a recurring one reschedules). Firing a wake is an effect
 * a host arranges; this plugin says WHEN, not HOW. It plugs into
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} like any other domain.
 *
 * @module
 */

import type { Eid, Plugin } from '@yaks/graph'

/** How a wake recurs, if at all. */
export type Every = 'once' | 'hourly' | 'daily' | 'weekly'

/**
 * The `wake` component: a scheduled revisit of the entity that carries it.
 */
export type Wake = {
  /** when the wake is next due (an ISO instant) */
  at: string
  /** how it recurs after firing */
  every: Every
  /** the entity to revisit when it fires (defaults to the carrier) */
  target?: Eid
}

/** The plugin that contributes the `wake` component to a graph. */
export type plugin = () => Plugin
