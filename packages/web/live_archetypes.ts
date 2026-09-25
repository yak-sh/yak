// Renderer descriptors are content-addressed, not a global boot working set.
// Complete local table sets prove their identity by hash; a projection that
// cannot do so learns just its descriptor through the existing one-shot door.
import { Archetypes, eidOf, tablesOf } from '@yaks/archetype'
import { config, oneShot, row } from './live.ts'

let sets = new Archetypes()
let checked = new WeakSet<object>()
let asked = new Set<string>()
let queued = new Set<string>()
let serial = 0
let request = (eid: string) => {
  if (asked.has(eid)) return
  asked.add(eid)
  if (!queued.size) {
    setTimeout(() => {
      let ids = [...queued]
      queued.clear()
      oneShot(
        `archetypes:${++serial}`,
        `id=${ids.join(',')}&.fields=archetype.tables`,
        () => {
          // A view may have unmounted while the read was in flight. Keep valid
          // content even then; do not strand its asked marker after eviction.
          for (let id of ids) {
            let value = row(id).peek()?.archetype?.tables
            if (value === undefined) continue
            try {
              descriptor(id, value)
            } catch (error) {
              console.error(error)
              asked.delete(id)
            }
          }
        },
        () => {
          for (let id of ids) asked.delete(id)
        },
      )
    })
  }
  queued.add(eid)
}

// Use the raw cache row, never Ent's derived fields or component bodies. A
// partial/stale union is safe ONLY if its names hash to the authoritative spine.
export let rememberArchetype = (
  value:
    | { entity?: { archetype?: string }; [name: string]: unknown }
    | undefined,
): void => {
  let id = value?.entity?.archetype
  if (!value || !id || sets.get(id) || checked.has(value)) return
  checked.add(value)
  let names = Object.keys(value).filter((n) =>
    n != 'entity' && value[n] != null
  )
  if (eidOf(names) == id) sets.intern(names)
}

let descriptor = (eid: string, value: unknown): readonly string[] => {
  let names = tablesOf(value)
  if (eidOf(names) != eid) {
    throw new Error(`Invalid archetype descriptor: ${eid}`)
  }
  return sets.intern(names).tables
}

export let archetypeTables = (eid: string): readonly string[] | undefined => {
  let known = sets.get(eid)
  if (known) return known.tables
  // This narrow signal wakes a projected renderer when its descriptor arrives.
  // Once learned, immutable content survives eviction, retirement and reconnect.
  let value = row(eid).value?.archetype?.tables
  if (value !== undefined) return descriptor(eid, value)
  if (config.host) request(eid)
}
