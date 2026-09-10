// The wire seam between the fleet's flat Change batches and @yaks/graph's
// entity bundles. This module owns only shape conversion, not admission or
// fleet policy. Lift one change at a time to preserve batch order; lower the
// committed answer (including minted identity and deletion) back to changes.
// Reserved pipeline metadata is not a component in that answer.

import { type Bundle, composed, dead } from '@yaks/graph'
import type { Change } from '../types.ts'

// A change is the app's wire shape; a bundle is @yaks/graph's. One bundle per
// change keeps the order identical, which is what a batch's semantics rest on.
export let asBundle = (c: Change): Bundle =>
  c.name == 'entity' && c.comp == null
    ? { entity: { eid: c.eid }, $delete: true }
    : c.name == 'entity'
    ? {
      entity: { eid: c.eid, ...c.comp },
      ...(c.was ? { $was: { entity: c.was } } : {}),
    }
    : {
      entity: { eid: c.eid },
      [c.name]: c.comp,
      ...(c.was ? { $was: { [c.name]: c.was } } : {}),
    }

// A bundle lowered back to the flat spelling, so the two returns compare.
export let asChanges = (b: Bundle): Change[] => {
  let eid = b.entity.eid
  if (b.$delete || b.tombstone) return [{ eid, name: 'entity', comp: null }]
  let out: Change[] = []
  if (b.entity.num !== undefined) {
    out.push({ eid, name: 'entity', comp: { eid, num: b.entity.num } })
  }
  for (let [name, comp] of Object.entries(b)) {
    if (name == 'entity' || name.startsWith('$')) continue
    out.push({ eid, name, comp: comp as Record<string, unknown> | null })
  }
  return out
}

// The fleet answer uses the core's final-state composition, but retains an
// explicit spine for unnumbered births (blobs, entries, etc.). In this store
// num:null is meaningful; an omitted number makes no claim about it. Keep
// explicit spines even when a flat caller did not name a number.
export let composedChanges = (changes: Change[]): Change[] => {
  let identities = new Map(
    changes.filter((c) => c.name == 'entity' && c.comp != null)
      .map((c) => [c.eid, c.comp!]),
  )
  return composed(changes.map(asBundle)).flatMap((b) => {
    let out = asChanges(b)
    let identity = identities.get(b.entity.eid)
    if (!dead(b) && b.entity.num === undefined && identity) {
      out.unshift({ eid: b.entity.eid, name: 'entity', comp: identity })
    }
    return out
  })
}

// Input conversion, unlike the answer, retains guards and explicit bare births.
export let inputChanges = (b: Bundle): Change[] => {
  let out = asChanges(b)
  if (!out.length) out.push({ eid: b.entity.eid, name: 'entity', comp: {} })
  return out.map((c) => ({
    ...c,
    ...(b.$was?.[c.name] ? { was: b.$was[c.name] } : {}),
  }))
}
