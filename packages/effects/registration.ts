import type { Plugin } from '@yaks/graph'
import type { Handler, Report, Slot } from './registry.ts'

/** Routing and reconciliation policy shared by a registration's hooks. */
export type Policy = {
  /** Process class that owns this observer (default: `do`). Names are the
   * application's; inline dispatch accepts all classes. */
  where?: string
  /** Pending-row query understood by the caller's sweep reader. Declaring it
   * promises an idempotent created handler: boot reconciliation is at-least-once. */
  sweep?: { pending: string }
  /** What this observer does, available from registry introspection. */
  doc?: string
  /** Additional reads to gather for this observer in graph-plugin mode. */
  wants?: Plugin['wants']
}

/** A component's related hooks, registered and documented together. */
export type Registration = Policy & {
  /** The component appeared. */
  created?: Handler
  /** A patch carried one of these columns. */
  changed?: Record<string, Handler>
  /** The component went away. */
  removed?: Handler
}

/** Selection and telemetry for one consumer of an external journal. */
export type Dispatch = {
  /** Only run slots belonging to a process class this consumer owns. */
  want?: (where: string) => boolean
  /** Override the registry's failure reporter for this pass. */
  report?: Report
}

/** Fetch the pending rows for one created slot. The registry does not speak
 * SQL or own a connection; the consumer interprets the pending query. */
export type SweepRows = (
  comp: string,
  pending: string,
) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>

/** One entry in the registry's documentation, derived from its actual slots. */
export type Description = {
  comp: string
  hooks: string[]
  sweep?: string
  doc?: string
}

/** Read grouped hooks back from the slots, not from a second effect list. */
export let describe = (slots: Slot[]): Description[] => {
  let groups = new Map<string, Description>()
  for (let s of slots) {
    let key = s.group ?? s.id
    let d = groups.get(key)
    if (!d) {
      d = { comp: s.comp, hooks: [], sweep: s.sweep?.pending, doc: s.doc }
      groups.set(key, d)
    }
    d.hooks.push(s.column ? `changed(${s.column})` : s.kind)
  }
  return [...groups.values()]
}
