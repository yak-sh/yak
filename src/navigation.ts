// One graph-backed navigation vocabulary for every surface. A favorite is a
// facet so marking a task never changes its kind, id, or renderer.
import type { Change, Ent } from './types.ts'

export let navigationQuery = '.favorite!'

export let favoriteChange = (e: Ent): Change => ({
  eid: e.eid,
  name: 'favorite',
  comp: e.favorite ? null : {},
})

export let favoriteLabel = (e: Ent) =>
  e.favorite ? 'remove from navigation' : 'show in navigation'
