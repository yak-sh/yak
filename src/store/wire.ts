// The wire seam between the fleet's flat Change batches and @yaks/graph's
// entity bundles. This module owns only shape conversion, not admission or
// fleet policy. Lift one change at a time to preserve batch order; lower the
// committed answer (including minted identity and deletion) back to changes.
// Reserved pipeline metadata is not a component in that answer.

import type { Bundle } from '@yaks/graph'
import type { Change } from '../types.ts'

// A change is the app's wire shape; a bundle is @yaks/graph's. One bundle per
// change keeps the order identical, which is what a batch's semantics rest on.
export let asBundle = (c: Change): Bundle =>
  c.name == 'entity' && c.comp == null
    ? { entity: { eid: c.eid }, $delete: true }
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
  if (b.entity.num != null) {
    out.push({ eid, name: 'entity', comp: { eid, num: b.entity.num } })
  }
  for (let [name, comp] of Object.entries(b)) {
    if (name == 'entity' || name.startsWith('$')) continue
    out.push({ eid, name, comp: comp as Record<string, unknown> | null })
  }
  return out
}
