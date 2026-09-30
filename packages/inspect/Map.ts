/**
 * `/inspect`, the map: a query bar and, under it, the listings, each a saved
 * query in the page's own graph. The map is an entity there too (`map`,
 * ./front.json), naming its listings in order, and what is typed in its bar
 * is the same entity's `filter` (@yaks/filter), so a host's bar and its key
 * loop write the one row the map reads.
 *
 * Sending the bar runs its line in the first listing, `Query`, and opens it.
 * `opened` is the change that sets the map up in a page's graph, with a
 * query in it when the address carried one.
 *
 * @module
 */

import { h } from 'preact'
import { parse } from '@yaks/query'
import type { Bundle, Props, View } from './host.ts'
import { comp } from './read.ts'

/** The map's entity in the page's own graph: its `map`, and its bar's
 * `filter`. */
export let MAP = 'inspect'
/** The listing the bar runs its line in. */
export let QUERY = 'inspect:query'

/** The listings a map starts with, in order. */
export let LISTINGS: Bundle[] = [
  { entity: { eid: QUERY }, listing: { title: 'Query', of: 'query' } },
  {
    entity: { eid: 'inspect:components' },
    listing: {
      title: 'Components',
      of: 'components',
      query: '._comp',
      open: true,
    },
  },
  {
    entity: { eid: 'inspect:archetypes' },
    listing: { title: 'Archetypes', of: 'archetypes', query: '.archetype' },
  },
  {
    entity: { eid: 'inspect:packages' },
    listing: { title: 'Packages', of: 'packages', query: '._package' },
  },
  {
    entity: { eid: 'inspect:relations' },
    listing: { title: 'Relations', of: 'relations', query: '._comp' },
  },
]

/**
 * Running a line: the `Query` listing asks it, open. An empty line folds it
 * away.
 *
 * ```ts
 * import { ran } from './Map.ts'
 * ran('.task&.count') // [{ entity: { eid: 'inspect:query' }, listing: { query: '.task&.count', open: true } }]
 * ```
 */
export let ran = (line: string): Bundle[] => [{
  entity: { eid: QUERY },
  listing: { query: line.trim(), open: !!line.trim() },
}]

/**
 * What sets the map up in a page's own graph, given what it holds (`ent`):
 * each listing it lacks, the map naming them, and the address's query run.
 *
 * ```ts
 * import { opened } from './Map.ts'
 * opened(() => undefined).length // 6
 * let held = (eid: string) => ({ entity: { eid }, listing: {}, map: {} })
 * opened(held, '.task').length // 1
 * ```
 */
export let opened = (
  ent: (eid: string) => Bundle | undefined,
  query?: string,
): Bundle[] => [
  ...LISTINGS.filter((l) => !ent(l.entity.eid)?.listing),
  ...ent(MAP)?.map ? [] : [{
    entity: { eid: MAP },
    map: { listings: LISTINGS.map((l) => l.entity.eid) },
  }],
  ...query != null ? ran(query) : [],
]

// The map: its bar, then each listing it names.
let MapPage = ({ e, io }: Props) => {
  let ids = (comp(e, 'map').listings as string[] | undefined) ?? []
  return h(
    'div',
    { class: 'Inspect Inspect-map' },
    h(io.Bar, {
      id: e.entity.eid,
      run: (line: string) => io.set(ran(line)),
    }),
    ids.map((id) => {
      let l = io.state(id)
      return l ? io.show(l, 'Inspect.List') : null
    }),
  )
}

/** The map, as a page. */
export let mapViews: View[] = [
  { view: 'Inspect.Full', match: parse('.map'), Render: MapPage },
]
