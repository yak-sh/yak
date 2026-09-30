/**
 * The inspector's addresses. The page is a stack of panes (@yaks/ux
 * `Stack`), and its address says the whole stack, bottom first, a path
 * segment a pane: `/inspect/<pane>/<pane>/…`. A pane is an entity's page by
 * any id the graph resolves (`T-9`), or a query's page, `q=` and its line
 * (`q=.task&.count`); `q=` alone is the first page, whose address alone is
 * `/inspect`. Back, forward and a shared link restore the stack from it.
 *
 * `stackOf` reads an address back, the same from a browser's location and a
 * terminal's link; a page that links to the inspector links to one pane of
 * it (`pagePath`, `queryPath`).
 *
 * @module
 */

/** What a pane shows: the first page, a query's page, or an entity's. */
export type At = { query?: string } | { id: string }

/** The pane that shows the first page. */
export let HOME = 'q='

/** The pane that shows `where`. */
export let paneOf = (where: At): string =>
  'id' in where ? where.id : `q=${where.query ?? ''}`

/**
 * What a pane shows.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { at } from './where.ts'
 *
 * assertEquals(at('q='), {})
 * assertEquals(at('q=.task&.count'), { query: '.task&.count' })
 * assertEquals(at('T-9'), { id: 'T-9' })
 * ```
 */
export let at = (pane: string): At =>
  pane == HOME
    ? {}
    : pane.startsWith('q=')
    ? { query: pane.slice(2) }
    : { id: pane }

// A pane as a path segment: what a path must escape escaped, and the rest of
// a query line (`&`, `=`, `,`, `:`) as it is typed.
let segment = (pane: string) =>
  encodeURIComponent(pane).replace(
    /%(26|3D|2C|3A|40|3B|2B|24)/g,
    (s) => decodeURIComponent(s),
  )

/**
 * The address of a stack of panes, bottom first.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { stackPath } from './where.ts'
 *
 * assertEquals(stackPath(['q=']), '/inspect')
 * assertEquals(stackPath(['q=', 'T-9']), '/inspect/q=/T-9')
 * assertEquals(
 *   stackPath(['q=.task&.tally=filed.priority']),
 *   '/inspect/q=.task&.tally=filed.priority',
 * )
 * assertEquals(stackPath(['q=a b/c#d']), '/inspect/q=a%20b%2Fc%23d')
 * ```
 */
export let stackPath = (panes: string[]): string =>
  !panes.length || panes.length == 1 && panes[0] == HOME
    ? '/inspect'
    : `/inspect/${panes.map(segment).join('/')}`

/** Where the page for `query` is; with none, the first page. */
export let queryPath = (query = ''): string => stackPath([paneOf({ query })])

/** Where an entity's page is, by any id the graph resolves. */
export let pagePath = (id: string): string => stackPath([id])

/** The query that holds one entity whole, by any id the graph resolves. */
export let entityLine = (id: string): string => `entity.eid=${id}&*`

// A segment as it was before it was escaped; one that was never escaped
// right, as it stands.
let decoded = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * The panes an address stacks, bottom first; undefined for one outside the
 * inspector.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { stackOf, stackPath } from './where.ts'
 *
 * assertEquals(stackOf('/inspect'), ['q='])
 * let panes = ['q=', 'q=.a&.b=c,d', 'q=a b/c?#%', 'T-9']
 * assertEquals(stackOf(stackPath(panes)), panes)
 * assertEquals(stackOf('https://tasks.yak.sh' + stackPath(panes)), panes)
 * assertEquals(stackOf('/T-9'), undefined)
 * ```
 */
export let stackOf = (href: string): string[] | undefined => {
  let { pathname } = new URL(href, 'http://inspect.invalid')
  if (pathname != '/inspect' && !pathname.startsWith('/inspect/')) return
  let panes = pathname.split('/').slice(2).filter(Boolean).map(decoded)
  return panes.length ? panes : [HOME]
}
