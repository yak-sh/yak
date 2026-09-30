/**
 * The inspector's addresses: its first page at `/inspect`, a query's page at
 * `/inspect?q=<line>`, and each entity's page at `/inspect/<id>`, by any id
 * the graph resolves. `at` reads one back, the same from a browser's location
 * and a terminal's link; a page that links to the inspector links here.
 *
 * @module
 */

/** Where the page for `query` is; with none, the first page. */
export let queryPath = (query = ''): string =>
  query ? `/inspect?q=${encodeURIComponent(query)}` : '/inspect'

/** Where an entity's page is, by any id the graph resolves. */
export let pagePath = (id: string): string =>
  `/inspect/${encodeURIComponent(id)}`

/** The query that holds one entity whole, by any id the graph resolves. */
export let entityLine = (id: string): string => `entity.eid=${id}&*`

/** What an address in the inspector names: the first page, a query's page,
 * or an entity's. */
export type At = { query?: string } | { id: string }

/**
 * The address `href` read back; undefined for one outside the inspector.
 *
 * ```ts
 * import { at, pagePath, queryPath } from './where.ts'
 * at('/inspect') // {}
 * at(queryPath('._comp&.count')) // { query: '._comp&.count' }
 * at(pagePath('T-9')) // { id: 'T-9' }
 * at('/T-9') // undefined
 * ```
 */
export let at = (href: string): At | undefined => {
  let url = new URL(href, 'http://inspect.invalid')
  if (url.pathname.replace(/\/$/, '') == '/inspect') {
    let query = url.searchParams.get('q')
    return query == null ? {} : { query }
  }
  let page = url.pathname.match(/^\/inspect\/([^/]+)$/)
  return page ? { id: decodeURIComponent(page[1]) } : undefined
}
