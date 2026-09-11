// One permanent, small descriptor subscription for both browser and terminal.
// Hold it before first paint and learn new sets as they arrive. A missing set
// is never inferred from a partial entity projection.
import { effect, signal } from '@preact/signals'
import { Archetypes, eidOf, tablesOf } from '@yaks/archetype'
import { cache, subscribe, subscriptionState } from './live.ts'

let sets = new Archetypes()
let version = signal(0)
export let archetypeTables = (eid: string): readonly string[] | undefined => {
  version.value
  return sets.get(eid)?.tables
}

let booting: Promise<void> | undefined
export let bootArchetypes = (): Promise<void> => {
  if (booting) return booting
  booting = new Promise<void>((resolve, reject) => {
    let sub = 'archetypes'
    subscribe(sub, '.archetype!')
    // The effect stays alive for the subscription's lifetime. Content is
    // immutable and safe across reconnects; readiness gates only first paint.
    effect(() => {
      let state = subscriptionState(sub)
      if (state.status == 'failed') return reject(new Error(state.reason))
      if (state.status != 'ready') return
      let rows = cache.peek()
      let added = false
      try {
        for (let eid of state.eids) {
          if (sets.get(eid)) continue
          let tables = tablesOf(rows[eid]?.archetype?.tables)
          if (eidOf(tables) != eid) {
            throw new Error(`Invalid archetype descriptor: ${eid}`)
          }
          sets.intern(tables)
          added = true
        }
      } catch (error) {
        reject(error)
        return
      }
      if (added) version.value = version.peek() + 1
      resolve()
    })
  })
  return booting
}
