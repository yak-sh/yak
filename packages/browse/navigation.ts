// The places the sidebar offers, as data: home, the destinations, and the
// schema. A destination is a page at `/?page=<key>`: a list of what a query
// finds, a package's page part above it, or that part alone.
// Browse offers the ones that read its own words (favorites, recent edits,
// sessions); a package offers its own from its `./views` facet as
// `destinations`, so a tracker lists its bugs without Browse knowing a bug.
// A favorite is a facet, so marking a task never changes its kind, id, or
// renderer.
import { queryAt, querySearch } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Change, Ent } from './types.ts'

/** A page the sidebar lists, at `/?page=<key>`: what `query` finds, under the
 * page part `view` draws, or that part alone. */
export type Destination = {
  /** its address, `/?page=<key>` */
  key: string
  /** what the sidebar and the page's bar call it */
  name: string
  /** a Lucide icon's name */
  icon: string
  /** the rows it lists, filtered from the page's bar; none where its view
   * is the whole page */
  query?: string
  /** a page part drawn above its list, by the name of its view */
  view?: string
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
  _actor: string | undefined,
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
    ...vocab.comp('updated')
      ? [{
        key: 'recent',
        name: 'Recent',
        icon: 'clock',
        query: '.updated * .order=-updated.at .limit=50',
      }]
      : [],
    ...contributed,
    ...sessions
      ? [{
        key: 'sessions',
        name: 'Sessions',
        icon: 'bot',
        query: sessions,
        view: 'Sessions.Controls',
      }]
      : [],
  ].filter((d) => !seen.has(d.key) && !!seen.add(d.key))
}

/** The destination an address is: `/?page=<key>` and nothing else. */
export let destinationAt = (
  at: string,
  all: Destination[],
): Destination | undefined => {
  let page = pageAt(at)
  return page ? all.find((d) => d.key == page.get('page')) : undefined
}

// Page selectors are plain parameters; query clauses carry a sigil.
// Entity-page view parameters remain on their path.
let pageAt = (at: string): URLSearchParams | undefined => {
  let url = new URL(at, 'http://x')
  let { query, state } = queryAt(url.search)
  return url.pathname == '/' && query == null ? state : undefined
}
export let destinationPath = (key: string) =>
  `/${querySearch('', { page: key })}`

/** The schema: the inspector's map of how the data is made. */
export let schemaPath = destinationPath('map')
export let configPath = destinationPath('config')
export let configAt = (at: string): boolean =>
  pageAt(at)?.get('page') == 'config'
export let schemaAt = (at: string): boolean => pageAt(at)?.get('page') == 'map'

/** New entities, made in an entity or like one, each named by human id or eid. */
/// newAt('/?page=new') -> {}
/// newAt('/?page=new&in=T-1&like=T-2') -> {in: 'T-1', like: 'T-2'}
/// newAt('/?page=map') -> undefined
export let newAt = (at: string): { in?: string; like?: string } | undefined => {
  let state = pageAt(at)
  if (state?.get('page') != 'new') return undefined
  return Object.fromEntries(
    ['in', 'like'].flatMap((k) => state.get(k) ? [[k, state.get(k)!]] : []),
  )
}
/// newPath({in: 'T-1', like: undefined}) -> '/?page=new&in=T-1'
export let newPath = (at: { in?: string; like?: string } = {}): string =>
  `/${
    querySearch('', {
      page: 'new',
      ...Object.fromEntries(Object.entries(at).filter(([, v]) => v)),
    })
  }`

/** Every line in the sidebar: home, new, the destinations, the schema. */
export let places = (
  home: Place,
  all: Destination[],
  schema: boolean,
  configuration = false,
): Place[] => [
  home,
  { name: 'New', icon: 'plus', path: newPath() },
  ...all.map((d) => ({
    name: d.name,
    icon: d.icon,
    path: destinationPath(d.key),
  })),
  ...schema ? [{ name: 'Schema', icon: 'database', path: schemaPath }] : [],
  ...configuration
    ? [{ name: 'Configuration', icon: 'settings', path: configPath }]
    : [],
]

/** The sidebar line an address lights: its own, or none for a search. */
export let placeAt = (at: string, all: Place[]): Place | undefined => {
  let url = new URL(at, 'http://x')
  let path = url.pathname + (url.search == '?' ? '' : url.search)
  return all.find((p) => p.path == path)
}
