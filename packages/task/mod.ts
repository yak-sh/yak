/**
 * @yaks/task — a task component domain for a yaks graph.
 *
 * This plugin contributes a `task` component: a status, a priority, and an
 * optional project, that any entity can wear. An entity carrying a `doc`
 * (title and body) plus a `task` IS a to-do item; the same entity can carry
 * other components too, so a task is never a closed record — it is a facet.
 *
 * The package ships the component's vocabulary and the small amount of logic
 * that belongs to the domain (the status set and its transitions). It plugs
 * into {@link https://jsr.io/@yaks/graph | @yaks/graph} exactly as any other
 * domain does; storage, querying, and history come from the core and its
 * adapters, not from here.
 *
 * @module
 */

import type { Eid, Plugin } from '@yaks/graph'

/** The lifecycle a task moves through. */
export type Status = 'open' | 'doing' | 'done' | 'dropped'

/**
 * The `task` component: what makes an entity a task. `priority` orders a queue
 * (lower is more urgent); `project` groups tasks under an owning entity.
 */
export type Task = {
  /** where the task sits in its lifecycle */
  status: Status
  /** queue order — lower is more urgent */
  priority: number
  /** the project entity this task belongs to, if any */
  project?: Eid
}

/** The plugin that contributes the `task` component to a graph. */
export type plugin = () => Plugin
