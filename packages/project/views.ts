/**
 * The `./views` facet: the pages this package offers a browsing app's
 * sidebar, each a list of what its query finds (@yaks/browse destinations):
 * the projects work is filed under, and the boards that are saved searches
 * over it.
 *
 * ```ts
 * import { destinations } from '@yaks/project/views'
 * destinations.map((d) => d.name) // ['Projects', 'Saved searches']
 * ```
 *
 * @module
 */

/** The sidebar's pages: a key for the address, a name, an icon, a query. */
export let destinations = [
  {
    key: 'projects',
    name: 'Projects',
    icon: 'folder',
    query: '.project !archived * .order=doc.title',
  },
  {
    key: 'searches',
    name: 'Saved searches',
    icon: 'bookmark',
    query: '.board *',
  },
]
