// Durable intent lives on the child. This graph-local scheduler only owns running
// callbacks; restarting it replays queued intent, never a second spawn write.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import type { ChildLimits } from './children.ts'

export type Pool = {
  limits: ChildLimits
  stopping?: () => boolean
  resume?: (id: Eid) => Promise<void>
  changed?: () => void
  suspended: Set<Eid>
}
let pools = new WeakMap<Graph, Pool>()
export let pool = (g: Graph): Pool => {
  let p = pools.get(g)
  if (!p) pools.set(g, p = { limits: {}, suspended: new Set() })
  return p
}
export let configurePool = (g: Graph, limits: ChildLimits) => {
  Object.assign(pool(g).limits, limits)
}
export let dispatch = (b: Bundle) => b.dispatch as Comp | undefined
