// Waiting component patches: keep only their newest value, but retain a
// clear before a later partial patch so an older property cannot return.

import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps } from './bundle.ts'

/** Accumulate unsent patches without re-reading the whole batch on each add. */
export let coalescer = (): {
  add: (bundles: Bundle[]) => void
  read: () => Bundle[]
} => {
  let clears = new Map<Eid, Bundle>()
  let values = new Map<Eid, Bundle>()
  let order = new Set<Eid>()
  let add = (bundles: Bundle[]) => {
    for (let b of bundles) {
      let eid = b.entity.eid
      order.add(eid)
      for (let [name, patch] of comps(b)) {
        if (patch == null) {
          let clear = clears.get(eid) ?? { entity: { eid } }
          clear[name] = null
          clears.set(eid, clear)
          let value = values.get(eid)
          if (value) delete value[name]
        } else {
          let value = values.get(eid) ?? { entity: { eid } }
          value[name] = { ...value[name] as Comp | undefined, ...patch }
          values.set(eid, value)
        }
      }
    }
  }
  let read = (): Bundle[] => {
    let out: Bundle[] = []
    for (let eid of order) {
      let clear = clears.get(eid)
      let value = values.get(eid)
      if (clear) out.push(clear)
      if (value && comps(value).length) out.push(value)
    }
    return out
  }
  return { add, read }
}

/** Fold unsent patches by entity and component, preserving clear-then-write. */
export let coalesced = (bundles: Bundle[]): Bundle[] => {
  let batch = coalescer()
  batch.add(bundles)
  return batch.read()
}
