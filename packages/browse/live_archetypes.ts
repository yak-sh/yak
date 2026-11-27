// Renderer descriptors are content-addressed, not a global boot working set.
// Complete local table sets prove their identity by hash; a projection that
// cannot do so learns just its descriptor through the existing one-shot door.
import {
  Archetypes,
  descriptorOf,
  eidOf,
  type Naming,
  namingOf,
} from '@yaks/archetype/sets'
import { config, oneShot, row } from './live.ts'
import { vocab } from './types.ts'

let sets = new Archetypes()
let named: Naming | undefined

// The sets, named by the vocabulary the page holds now: a descriptor holds
// its components' identities, and a reloaded vocabulary may name them anew.
let current = () => {
  let naming = namingOf(vocab)
  if (naming != named) {
    named = naming
    sets = new Archetypes(naming)
  }
  return sets
}
let checked = new WeakSet<object>()
let asked = new Set<string>()
let queued = new Set<string>()
let serial = 0
let pending: ReturnType<typeof setTimeout> | undefined

// A fresh test fixture has learned no descriptors. Production keeps immutable
// content across eviction and reconnect, so it never calls this reset.
export let resetArchetypesForTest = () => {
  clearTimeout(pending)
  pending = undefined
  sets = new Archetypes()
  named = undefined
  checked = new WeakSet()
  asked.clear()
  queued.clear()
}

let request = (eid: string) => {
  if (asked.has(eid)) return
  asked.add(eid)
  if (!queued.size) {
    pending = setTimeout(() => {
      pending = undefined
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
  let sets = current()
  if (!value || !id || sets.get(id) || checked.has(value)) return
  checked.add(value)
  let names = Object.keys(value).filter((n) =>
    n != 'entity' && value[n] != null
  )
  // A store whose descriptors predate identities points at its labels' set.
  if (eidOf(names.map(named!.id)) == id) sets.intern(names)
  else if (eidOf(names) == id) sets.decode(names)
}

let descriptor = (eid: string, value: unknown): readonly string[] => {
  if (eidOf(descriptorOf(value)) != eid) {
    throw new Error(`Invalid archetype descriptor: ${eid}`)
  }
  return current().decode(value).tables
}

export let archetypeTables = (eid: string): readonly string[] | undefined => {
  let known = current().get(eid)
  if (known) return known.tables
  // This narrow signal wakes a projected renderer when its descriptor arrives.
  // Once learned, immutable content survives eviction, retirement and reconnect.
  let value = row(eid).value?.archetype?.tables
  if (value !== undefined) return descriptor(eid, value)
  if (config.host) request(eid)
}
