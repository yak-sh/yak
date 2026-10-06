// The places the sidebar offers, as data: home, the destinations, and the
// schema. A destination is a page listing what a query finds, at `/?<key>`.
// Browse offers the ones that read its own words (favorites, recent opens,
// sessions); a package offers its own from its `./views` facet as
// `destinations`, so a tracker lists its bugs without Browse knowing a bug.
// A favorite is a facet, so marking a task never changes its kind, id, or
// renderer.
import type { Vocab } from '@yaks/vocab'
import type { Change, Ent } from './types.ts'
import { searchAt } from './url.ts'

/** A page the sidebar lists: what `query` finds, at `/?<key>`. */
export type Destination = {
  /** its address, `/?<key>` */
  key: string
  /** what the sidebar and the page's bar call it */
  name: string
  /** a Lucide icon's name */
  icon: string
  /** the rows it lists */
  query: string
}

/** A line in the sidebar. */
export type Place = { name: string; icon: string; path: string }

export let favoriteChange = (e: Ent): Change => ({
  eid: e.eid,
  name: 'favorite',
  comp: e.favorite ? null : {},
})

export let favoriteLabel = (e: Ent) =>
  e.favorite ? 'remove from favorites' : 'add to favorites'

/** The destinations, in the sidebar's order: Browse's own personal ones
 * (favorites, then what this person opened lately), each package's in config
 * order, then the sessions; a key once, the first offer kept. */
export let destinations = (
  vocab: Vocab,
  actor: string | undefined,
  sessions: string,
  contributed: Destination[],
): Destination[] => {
  let seen = new Set<string>()
  return [
    ...vocab.comp('favorite')
      ? [{
        key: 'favorites',
        name: 'Favorites',
        icon: 'star',
        query: '.favorite *',
      }]
      : [],
    ...actor && vocab.prop('opened', 'by')
      ? [{
        key: 'recent',
        name: 'Recent',
        icon: 'clock',
        query: `.opened.by=${actor} * .order=-opened.at .limit=50`,
      }]
      : [],
    ...contributed,
    ...sessions
      ? [{ key: 'sessions', name: 'Sessions', icon: 'bot', query: sessions }]
      : [],
  ].filter((d) => !seen.has(d.key) && !!seen.add(d.key))
}

/** The destination an address is: `/?<key>` and nothing else. */
export let destinationAt = (
  at: string,
  all: Destination[],
): Destination | undefined => {
  let url = new URL(at, 'http://x')
  let keys = [...url.searchParams.keys()]
  return url.pathname == '/' && keys.length == 1 &&
      !url.searchParams.get(keys[0])
    ? all.find((d) => d.key == keys[0])
    : undefined
}

/** The schema: the inspector's map of how the data is made. */
export let schemaPath = '/?map'
export let schemaAt = (at: string): boolean => {
  let url = new URL(at, 'http://x')
  return url.pathname == '/' && url.searchParams.has('map')
}

/** Every line in the sidebar: home, the destinations, the schema. */
export let places = (
  home: Place,
  all: Destination[],
  schema: boolean,
): Place[] => [
  home,
  ...all.map((d) => ({ name: d.name, icon: d.icon, path: `/?${d.key}` })),
  ...schema ? [{ name: 'Schema', icon: 'database', path: schemaPath }] : [],
]

/** The sidebar line an address lights: its own, or none for a search. */
export let placeAt = (at: string, all: Place[]): Place | undefined => {
  if (searchAt(at) != null) return undefined
  let url = new URL(at, 'http://x')
  let path = url.pathname + (url.search == '?' ? '' : url.search)
  return all.find((p) => p.path == path)
}
