// One graph-backed navigation vocabulary for every surface. A favorite is a
// facet so marking a task never changes its kind, id, or renderer.
import type { Change, Ent } from './types.ts'

export let navigationQuery = '.favorite'
export let navigationView = 'Navigation.List.Tile'

export let favoriteChange = (e: Ent): Change => ({
  eid: e.eid,
  name: 'favorite',
  comp: e.favorite ? null : {},
})

export let favoritePin = (e: Ent): Change | undefined =>
  e.favorite ? undefined : { eid: e.eid, name: 'favorite', comp: {} }

export let favoriteLabel = (e: Ent) =>
  e.favorite ? 'remove from navigation' : 'show in navigation'

// Narrowing is local text over the sidebar's own loaded entries, not a private
// query language. Enter sends the untouched line through the ordinary query door.
export let sidebarMatches = (e: Ent, text: string): boolean => {
  let line = text.trim().toLowerCase()
  return !line ||
    [
      e.doc?.title,
      (e._package as { name?: string })?.name,
      (e._comp as { name?: string })?.name,
      e.board?.query,
      e.session?.id,
    ].some((v) => typeof v == 'string' && v.toLowerCase().includes(line))
}

export let sidebarQueries = (
  vocab: import('@yaks/vocab').Vocab,
  actor?: string,
) => ({
  favorites: vocab.comp('favorite') ? '.favorite *' : '',
  packages: vocab.comp('_package') ? '._package * .order=_package.name' : '',
  components: vocab.comp('_comp') ? '._comp * .order=_comp.name' : '',
  searches: vocab.comp('board') ? '.board *' : '',
  recent: actor && vocab.prop('opened', 'by')
    ? `.opened.by=${actor} * .order=-opened.at .limit=20`
    : '',
  running: vocab.prop('session', 'status')
    ? '.session.status=pending,running * .order=-created.at .limit=30'
    : '',
  sessions: actor && vocab.prop('created', 'by') && vocab.comp('session')
    ? `.session .created.by=${actor} * .order=-created.at .limit=20`
    : '',
})

export let sidebarComponent = (e: Ent) =>
  e._comp as { name?: string; package?: string } | undefined
