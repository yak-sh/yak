/**
 * The inspector's addresses: the map at `/inspect` (`?q=` a line run in its
 * bar) and each entity's page at `/inspect/<id>`, by any id the graph
 * resolves. `at` reads one back, the same from a browser's location and a
 * terminal's link; a page that links to the inspector links here.
 *
 * @module
 */

/** Where the map is, with `query` in its bar. */
export let mapPath = (query = ''): string =>
  query ? `/inspect?q=${encodeURIComponent(query)}` : '/inspect'

/** Where an entity's page is, by any id the graph resolves. */
export let pagePath = (id: string): string =>
  `/inspect/${encodeURIComponent(id)}`

/** What an address in the inspector names: the map, and the line in its bar,
 * or an entity's page. */
export type At = { query?: string } | { id: string }

/**
 * The address `href` read back; undefined for one outside the inspector.
 *
 * ```ts
 * import { at, mapPath, pagePath } from './where.ts'
 * at('/inspect') // {}
 * at(mapPath('._comp&.count')) // { query: '._comp&.count' }
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
